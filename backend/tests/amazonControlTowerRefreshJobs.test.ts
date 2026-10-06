'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createMemoryRefreshStore } = require('../src/services/amazonControlTower/refreshRunStore.ts')
const { createRefreshRunner, REFRESH_ALL_STEPS, REFRESH_HEALTH_STEPS } = require('../src/services/amazonControlTower/refreshRunner.ts')
const { startControlTowerScheduler, isSchedulerEnabled } = require('../src/services/amazonControlTower/refreshScheduler.ts')

const quietLog = { info() {}, error() {} }

function deferred() {
  let resolve: (v?: unknown) => void = () => {}
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeRunner(handlers: Record<string, any>, extra: Record<string, unknown> = {}) {
  const store = createMemoryRefreshStore()
  let n = 0
  const runner = createRefreshRunner({
    store,
    handlers,
    processTag: 'test:1',
    heartbeatMs: 5,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    log: quietLog,
    ...extra,
  })
  return { store, runner }
}

describe('Control Tower refresh runner', () => {
  it('manual trigger: queues, runs, records records/step/duration and succeeds', async () => {
    const { runner } = makeRunner({
      listings: async (ctx: any) => {
        ctx.progress('Downloading', 0, 2)
        ctx.progress('Saving', 2, 2)
        return { recordsProcessed: 42, metadata: { activeListings: 42 } }
      },
    })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'listings', requestedBy: 'user:1' })
    assert.equal(started.status, 'queued')
    assert.equal(started.alreadyRunning, false)
    assert.equal(started.runIds.length, 1)
    await runner.drain()
    const run = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(run.status, 'succeeded')
    assert.equal(run.recordsProcessed, 42)
    assert.equal(run.currentStep, 'Completed')
    assert.equal(run.metadata.activeListings, 42)
    assert.equal(run.triggerSource, 'manual')
    assert.equal(run.requestedBy, 'user:1')
    assert.ok(run.startedAt && run.finishedAt)
    assert.equal(typeof run.durationMs, 'number')
  })

  it('duplicate claim returns the active run instead of starting a second one', async () => {
    const gate = deferred()
    let calls = 0
    const { runner } = makeRunner({
      sales: async () => {
        calls += 1
        await gate.promise
        return { recordsProcessed: 1 }
      },
    })
    const first = await runner.start({ marketplaceKey: 'ksa', jobType: 'sales' })
    const second = await runner.start({ marketplaceKey: 'ksa', jobType: 'sales' })
    assert.equal(second.alreadyRunning, true)
    assert.deepEqual(second.runIds, first.runIds)
    gate.resolve()
    await runner.drain()
    assert.equal(calls, 1)
  })

  it('unrelated job types and marketplaces do not block each other', async () => {
    const gate = deferred()
    const { runner } = makeRunner({
      sales: async () => {
        await gate.promise
      },
      fba_inventory: async () => ({ recordsProcessed: 3 }),
    })
    const a = await runner.start({ marketplaceKey: 'ksa', jobType: 'sales' })
    const b = await runner.start({ marketplaceKey: 'ksa', jobType: 'fba_inventory' })
    const c = await runner.start({ marketplaceKey: 'uae', jobType: 'sales' })
    assert.equal(b.alreadyRunning, false)
    assert.equal(c.alreadyRunning, false)
    assert.notEqual(a.runIds[0], b.runIds[0])
    gate.resolve()
    await runner.drain()
  })

  it('failed handler → failed run with error and the step it failed in', async () => {
    const { runner } = makeRunner({
      fba_inventory: async (ctx: any) => {
        ctx.progress('Reading FBA inventory (page 2)')
        const err: any = new Error('Amazon said 429')
        err.code = 'AMAZON_SPAPI_THROTTLED'
        throw err
      },
    })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'fba_inventory' })
    await runner.drain()
    const run = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(run.status, 'failed')
    assert.match(run.errorMessage, /AMAZON_SPAPI_THROTTLED.*429/)
    assert.equal(run.currentStep, 'Failed during: Reading FBA inventory (page 2)')
    const again = await runner.start({ marketplaceKey: 'ksa', jobType: 'fba_inventory' })
    assert.equal(again.alreadyRunning, false, 'a failed run does not block the next one')
    await runner.drain()
  })

  it('handler can finish as skipped', async () => {
    const { runner } = makeRunner({ rollup: async () => ({ skippedReason: 'nothing to do' }) })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'rollup' })
    await runner.drain()
    const run = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(run.status, 'skipped')
    assert.equal(run.errorMessage, 'nothing to do')
  })

  it('heartbeat keeps a long run fresh', async () => {
    const gate = deferred()
    const { runner, store } = makeRunner({ sales: async () => gate.promise })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'sales' })
    await new Promise((r) => setTimeout(r, 5))
    const before = (await store.getRun(started.runIds[0])).heartbeatAt
    await new Promise((r) => setTimeout(r, 40))
    const after = (await store.getRun(started.runIds[0])).heartbeatAt
    assert.ok(before && after && after > before, `heartbeat advanced (${before} → ${after})`)
    gate.resolve()
    await runner.drain()
  })

  it('stale cleanup marks abandoned runs interrupted and frees the slot', async () => {
    const store = createMemoryRefreshStore()
    await store.claimRun({ id: 'stale-1', marketplaceKey: 'ksa', jobType: 'listings' })
    await store.markRunning('stale-1', 'dead:1')
    store._setHeartbeat('stale-1', new Date(Date.now() - 10 * 60_000))
    const runner = createRefreshRunner({ store, handlers: { listings: async () => ({}) }, log: quietLog, heartbeatMs: 20_000 })
    assert.equal(await runner.recoverInterruptedRuns(), 1)
    const stale = await store.getRun('stale-1')
    assert.equal(stale.status, 'interrupted')
    assert.match(stale.errorMessage, /Interrupted/)
    const next = await runner.start({ marketplaceKey: 'ksa', jobType: 'listings' })
    assert.equal(next.alreadyRunning, false)
    await runner.drain()
  })

  it('polling a run orphaned by a restart reports it interrupted (UI is not locked forever)', async () => {
    const store = createMemoryRefreshStore()
    await store.claimRun({ id: 'orphan-1', marketplaceKey: 'ksa', jobType: 'sales' })
    await store.markRunning('orphan-1', 'old-process:1')
    store._setHeartbeat('orphan-1', new Date(Date.now() - 6 * 60_000))
    const runner = createRefreshRunner({ store, handlers: { sales: async () => ({}) }, log: quietLog })
    const polled = await runner.getRunWithChildren('orphan-1')
    assert.equal(polled.status, 'interrupted')
    assert.ok(!(await store.findActiveRun('ksa', 'sales')), 'slot is free again')
  })

  it('a live run is not interrupted by the cleanup', async () => {
    const gate = deferred()
    const { runner, store } = makeRunner({ sales: async () => gate.promise })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'sales' })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(await store.markStaleRunsInterrupted({ staleMs: 60_000 }), 0)
    gate.resolve()
    await runner.drain()
    assert.equal((await store.getRun(started.runIds[0])).status, 'succeeded')
  })

  it('rejects unknown job types', async () => {
    const { runner } = makeRunner({})
    await assert.rejects(() => runner.start({ marketplaceKey: 'ksa', jobType: 'create_shipment' }), /Unknown Control Tower job type/)
  })

  it('refresh_all runs every step in order, records each child, then freshness', async () => {
    const order: string[] = []
    const handlers: Record<string, any> = {}
    for (const step of REFRESH_ALL_STEPS) {
      handlers[step.key] = async () => {
        order.push(step.key)
        return { recordsProcessed: 1 }
      }
    }
    const { runner } = makeRunner(handlers, { computeFreshness: async () => ({ sources: [{ key: 'listings', status: 'FRESH' }] }) })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'refresh_all' })
    assert.equal(started.runIds.length, 1 + REFRESH_ALL_STEPS.length)
    await runner.drain()
    assert.deepEqual(order, ['listings', 'listing_status', 'sales', 'rollup', 'fba_inventory', 'warehouse_stock'])
    const parent = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(parent.status, 'succeeded')
    assert.equal(parent.recordsProcessed, 6)
    assert.equal(parent.children.length, 6)
    assert.ok(parent.children.every((c: any) => c.status === 'succeeded' && c.triggerSource === 'parent'))
    const steps = parent.metadata.steps
    assert.deepEqual(steps.map((s: any) => s.key), ['listings', 'listing_status', 'sales', 'rollup', 'fba_inventory', 'warehouse_stock', 'freshness'])
    assert.ok(steps.every((s: any) => s.status === 'succeeded'))
    assert.equal(parent.metadata.freshness.sources[0].status, 'FRESH')
  })

  it('refresh_all keeps going after a failed step and reports it', async () => {
    const order: string[] = []
    const handlers: Record<string, any> = {}
    for (const step of REFRESH_ALL_STEPS) {
      handlers[step.key] = async () => {
        order.push(step.key)
        if (step.key === 'sales') throw new Error('report FATAL')
      }
    }
    const { runner } = makeRunner(handlers)
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'refresh_all' })
    await runner.drain()
    assert.equal(order.length, REFRESH_ALL_STEPS.length)
    const parent = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(parent.status, 'failed')
    assert.match(parent.errorMessage, /Sales \(order report\) sync: report FATAL/)
    assert.equal(parent.metadata.steps.find((s: any) => s.key === 'sales').status, 'failed')
    assert.equal(parent.metadata.steps.find((s: any) => s.key === 'rollup').status, 'succeeded')
  })

  it('refresh_all skips a step already running standalone (never runs it twice)', async () => {
    const gate = deferred()
    let fbaCalls = 0
    const handlers: Record<string, any> = {
      listings: async () => {},
      listing_status: async () => {},
      sales: async () => {},
      rollup: async () => {},
      warehouse_stock: async () => {},
      fba_inventory: async () => {
        fbaCalls += 1
        await gate.promise
      },
    }
    const { runner } = makeRunner(handlers)
    const standalone = await runner.start({ marketplaceKey: 'ksa', jobType: 'fba_inventory' })
    const all = await runner.start({ marketplaceKey: 'ksa', jobType: 'refresh_all' })
    const afterSecondClick = await runner.start({ marketplaceKey: 'ksa', jobType: 'refresh_all' })
    assert.equal(afterSecondClick.alreadyRunning, true)
    assert.equal(afterSecondClick.runIds[0], all.runIds[0])
    gate.resolve()
    await runner.drain()
    assert.equal(fbaCalls, 1)
    const parent = await runner.getRunWithChildren(all.runIds[0])
    const fbaStep = parent.metadata.steps.find((s: any) => s.key === 'fba_inventory')
    assert.equal(fbaStep.status, 'skipped')
    assert.ok(fbaStep.error.includes(standalone.runIds[0]))
    assert.equal(parent.status, 'succeeded')
  })

  it('refresh_health runs listing status, FBA inventory, inventory reports and removals as one composite', async () => {
    const order: string[] = []
    const handlers: Record<string, any> = {}
    for (const step of REFRESH_HEALTH_STEPS) {
      handlers[step.key] = async () => {
        order.push(step.key)
        return { recordsProcessed: 2 }
      }
    }
    const { runner } = makeRunner(handlers)
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'refresh_health' })
    assert.equal(started.runIds.length, 1 + REFRESH_HEALTH_STEPS.length)
    await runner.drain()
    assert.deepEqual(order, ['listing_status', 'fba_inventory', 'inventory_reports', 'removal_orders'])
    const parent = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(parent.jobType, 'refresh_health')
    assert.equal(parent.status, 'succeeded')
    assert.equal(parent.children.length, 4)
    assert.equal(parent.recordsProcessed, 8)
  })

  it('a failed job keeps the error metadata (e.g. Amazon report outcomes with request ids)', async () => {
    const { runner } = makeRunner({
      inventory_reports: async () => {
        const err: any = new Error('No inventory report was usable')
        err.metadata = { reports: { planning: { status: 'FATAL', amazonRequestId: 'req-1' } } }
        throw err
      },
    })
    const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'inventory_reports' })
    await runner.drain()
    const run = await runner.getRunWithChildren(started.runIds[0])
    assert.equal(run.status, 'failed')
    assert.equal(run.metadata.reports.planning.amazonRequestId, 'req-1')
  })
})

describe('Control Tower scheduler', () => {
  it('is disabled by default and when the flag is 0', async () => {
    assert.equal(isSchedulerEnabled({}), false)
    assert.equal(isSchedulerEnabled({ AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '0' }), false)
    assert.equal(isSchedulerEnabled({ AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '1' }), true)
    let started = 0
    const sched = startControlTowerScheduler({
      env: { AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '0' },
      runner: { start: async () => { started += 1; return { runIds: [], alreadyRunning: false } } },
      store: { listSchedules: async () => [], claimDueSchedule: async () => null, recordScheduleRun: async () => {} },
      withLock: async (fn: any) => fn(),
      getSettings: async () => ({ schedulerEnabled: true }),
      log: quietLog,
    })
    assert.equal(sched.enabled, false)
    assert.deepEqual(await sched.tick(), { ran: false, reason: 'disabled', started: [] })
    assert.equal(started, 0)
  })

  it('when enabled, fires only enabled + due schedules on marketplaces that opted in', async () => {
    const store = createMemoryRefreshStore()
    store._putSchedule({ id: 1, marketplaceKey: 'ksa', jobType: 'sales', intervalMinutes: 60, enabled: true, nextRunAt: null, lastRunId: null, lastRunAt: null, lastStatus: null })
    store._putSchedule({ id: 2, marketplaceKey: 'ksa', jobType: 'listings', intervalMinutes: 60, enabled: false, nextRunAt: null, lastRunId: null, lastRunAt: null, lastStatus: null })
    const calls: string[] = []
    const runner = { start: async (p: any) => { calls.push(p.jobType); return { runIds: ['r1'], alreadyRunning: false } } }
    const sched = startControlTowerScheduler({
      env: { AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '1' },
      runner,
      store,
      withLock: async (fn: any) => fn(),
      getSettings: async () => ({ schedulerEnabled: true }),
      tickMs: 60_000_000,
      log: quietLog,
    })
    try {
      const first = await sched.tick()
      assert.deepEqual(first.started, ['ksa/sales'])
      const second = await sched.tick()
      assert.deepEqual(second.started, [], 'not due again until next_run_at')
      assert.deepEqual(calls, ['sales'])
      const s1 = (await store.listSchedules('ksa')).find((s: any) => s.id === 1)
      assert.equal(s1.lastStatus, 'queued')
    } finally {
      sched.stop()
    }
  })

  it('marketplace scheduler_enabled=false keeps schedules silent; lock held elsewhere skips the tick', async () => {
    const store = createMemoryRefreshStore()
    store._putSchedule({ id: 1, marketplaceKey: 'ksa', jobType: 'sales', intervalMinutes: 60, enabled: true, nextRunAt: null, lastRunId: null, lastRunAt: null, lastStatus: null })
    let calls = 0
    const runner = { start: async () => { calls += 1; return { runIds: ['r'], alreadyRunning: false } } }
    const off = startControlTowerScheduler({
      env: { AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '1' },
      runner,
      store,
      withLock: async (fn: any) => fn(),
      getSettings: async () => ({ schedulerEnabled: false }),
      tickMs: 60_000_000,
      log: quietLog,
    })
    const locked = startControlTowerScheduler({
      env: { AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED: '1' },
      runner,
      store,
      withLock: async () => null,
      getSettings: async () => ({ schedulerEnabled: true }),
      tickMs: 60_000_000,
      log: quietLog,
    })
    try {
      assert.deepEqual((await off.tick()).started, [])
      assert.deepEqual(await locked.tick(), { ran: false, reason: 'locked-elsewhere', started: [] })
      assert.equal(calls, 0)
    } finally {
      off.stop()
      locked.stop()
    }
  })
})

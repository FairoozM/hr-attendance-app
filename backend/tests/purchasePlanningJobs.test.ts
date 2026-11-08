'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createJobRunner, summarizeStatus } = require('../src/services/purchasePlanningJobs.ts')

type Row = {
  id: number
  kind: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  attempts: number
  boot_id: string | null
  progress: string | null
  summary: Record<string, unknown> | null
  error: string | null
  requested_at: Date
  started_at: Date | null
  heartbeat_at: Date | null
  finished_at: Date | null
}

/** In-memory twin of the Postgres store: one queued + one running job, heartbeat-based staleness. */
function createMemoryStore(clock: { now: number }) {
  const rows: Row[] = []
  let nextId = 1
  const at = () => new Date(clock.now)
  const find = (id: number) => rows.find((row) => row.id === id)
  const has = (status: Row['status']) => rows.some((row) => row.status === status)

  return {
    rows,
    async enqueue() {
      if (has('queued')) return false
      rows.push({
        id: nextId++, kind: 'k', status: 'queued', attempts: 0, boot_id: null, progress: 'Waiting to start',
        summary: null, error: null, requested_at: at(), started_at: null, heartbeat_at: null, finished_at: null,
      })
      return true
    },
    async claim(bootId: string) {
      if (has('running')) return null
      const job = rows.find((row) => row.status === 'queued')
      if (!job) return null
      Object.assign(job, { status: 'running', boot_id: bootId, attempts: job.attempts + 1, started_at: at(), heartbeat_at: at(), error: null })
      return { ...job }
    },
    async heartbeat(id: number, bootId: string, progress: string | null) {
      const job = find(id)
      if (!job || job.status !== 'running' || job.boot_id !== bootId) return false
      job.heartbeat_at = at()
      if (progress != null) job.progress = progress
      return true
    },
    async finish(id: number, bootId: string, summary: Record<string, unknown> | null) {
      const job = find(id)
      if (!job || job.status !== 'running' || job.boot_id !== bootId) return
      Object.assign(job, { status: 'completed', summary, progress: null, finished_at: at() })
    },
    async fail(id: number, bootId: string | null, error: string) {
      const job = find(id)
      if (!job || job.status !== 'running' || (bootId && job.boot_id !== bootId)) return
      Object.assign(job, { status: 'failed', error, progress: null, finished_at: at() })
    },
    async requeue(id: number, progress: string) {
      const job = find(id)
      if (!job || job.status !== 'running' || has('queued')) return false
      Object.assign(job, { status: 'queued', boot_id: null, heartbeat_at: null, progress })
      return true
    },
    async listStale({ staleMs, maxRuntimeMs, skipId }: { staleMs: number; maxRuntimeMs: number; skipId: number | null }) {
      return rows
        .filter((row) => row.status === 'running' && row.id !== skipId)
        .map((row) => ({ ...row, timed_out: clock.now - (row.started_at?.getTime() || 0) > maxRuntimeMs }))
        .filter((row) => row.timed_out || !row.heartbeat_at || clock.now - row.heartbeat_at.getTime() > staleMs)
    },
    async listRecent(limit: number) {
      return [...rows].sort((a, b) => b.id - a.id).slice(0, limit).map((row) => ({ ...row }))
    },
    async isActive() {
      return has('queued') || has('running')
    },
  }
}

function deferred() {
  let resolve!: (value?: unknown) => void
  let reject!: (err: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const quietLog = { error: () => {}, warn: () => {} }

test('purchasePlanningJobs: a queued job runs, reports progress, and stores its summary', async () => {
  const clock = { now: Date.now() }
  const store = createMemoryStore(clock)
  const gate = deferred()
  const runner = createJobRunner({
    store,
    log: quietLog,
    run: async ({ onProgress }: { onProgress: (text: string) => Promise<void> }) => {
      await onProgress('Matching 3 SKU(s) in Zoho')
      await gate.promise
      return { refreshed: 3, matched: 2, unmatched: 1 }
    },
  })

  const queued = await runner.queue()
  assert.equal(queued.running, true)
  await new Promise((resolve) => setImmediate(resolve))
  const during = await runner.getStatus()
  assert.equal(during.status, 'running')
  assert.equal(during.progress, 'Matching 3 SKU(s) in Zoho')

  gate.resolve()
  await runner.idle()
  const after = await runner.getStatus()
  assert.equal(after.running, false)
  assert.deepEqual(after.lastSummary, { refreshed: 3, matched: 2, unmatched: 1 })
  assert.equal(after.lastError, null)
})

test('purchasePlanningJobs: queueing during a run schedules exactly one follow-up run', async () => {
  const clock = { now: Date.now() }
  const store = createMemoryStore(clock)
  const gates = [deferred(), deferred()]
  let runs = 0
  const runner = createJobRunner({
    store,
    log: quietLog,
    run: async () => {
      const gate = gates[runs]
      runs += 1
      await gate.promise
      return { refreshed: runs, matched: 0, unmatched: 0 }
    },
  })

  await runner.queue()
  await new Promise((resolve) => setImmediate(resolve))
  await runner.queue()
  await runner.queue()
  const status = await runner.getStatus()
  assert.equal(status.queuedAgain, true)
  assert.equal(store.rows.filter((row) => row.status === 'queued').length, 1)

  gates[0].resolve()
  await new Promise((resolve) => setImmediate(resolve))
  gates[1].resolve()
  await runner.idle()
  assert.equal(runs, 2)
  assert.equal(store.rows.filter((row) => row.status === 'completed').length, 2)
})

test('purchasePlanningJobs: a job abandoned by a restart is resumed by the next instance', async () => {
  const clock = { now: Date.now() }
  const store = createMemoryStore(clock)
  await store.enqueue()
  await store.claim('old-boot')

  let ran = false
  const runner = createJobRunner({
    store,
    log: quietLog,
    bootId: 'new-boot',
    staleMs: 60_000,
    run: async () => {
      ran = true
      return { refreshed: 1, matched: 1, unmatched: 0 }
    },
  })

  const fresh = await runner.getStatus()
  assert.equal(fresh.status, 'running', 'a job with a live heartbeat on another instance is left alone')
  assert.equal(ran, false)

  clock.now += 61_000
  await runner.kick()
  assert.equal(ran, true)
  const job = store.rows[0]
  assert.equal(job.status, 'completed')
  assert.equal(job.attempts, 2)
  assert.equal(job.boot_id, 'new-boot')
})

test('purchasePlanningJobs: gives up after repeated interruptions and on timeouts', async () => {
  const clock = { now: Date.now() }
  const store = createMemoryStore(clock)
  await store.enqueue()
  await store.claim('crashed')
  store.rows[0].attempts = 3

  const runner = createJobRunner({ store, log: quietLog, maxAttempts: 3, run: async () => ({}) })
  clock.now += 61_000
  await runner.recover()
  assert.equal(store.rows[0].status, 'failed')
  assert.match(store.rows[0].error || '', /interrupted 3 times/)
  const status = await runner.getStatus()
  assert.match(status.lastError || '', /interrupted 3 times/)

  await store.enqueue()
  await store.claim('slow')
  clock.now += 21 * 60 * 1000
  store.rows[1].heartbeat_at = new Date(clock.now)
  await runner.recover()
  assert.equal(store.rows[1].status, 'failed')
  assert.match(store.rows[1].error || '', /timed out/)
})

test('purchasePlanningJobs: a failing run records the error and clears it on the next success', async () => {
  const clock = { now: Date.now() }
  const store = createMemoryStore(clock)
  let shouldFail = true
  const runner = createJobRunner({
    store,
    log: quietLog,
    run: async () => {
      if (shouldFail) throw new Error('Zoho sales report unavailable')
      return { refreshed: 1, matched: 1, unmatched: 0 }
    },
  })

  await runner.queue()
  await runner.idle()
  assert.equal((await runner.getStatus()).lastError, 'Zoho sales report unavailable')

  shouldFail = false
  clock.now += 1000
  await runner.queue()
  await runner.idle()
  assert.equal((await runner.getStatus()).lastError, null)
})

test('purchasePlanningJobs: summarizeStatus hides an old failure behind a newer success', () => {
  const base = { kind: 'k', attempts: 1, boot_id: null, progress: null, requested_at: null, started_at: null, heartbeat_at: null }
  const status = summarizeStatus([
    { ...base, id: 2, status: 'completed', summary: { refreshed: 5, matched: 5, unmatched: 0 }, error: null, finished_at: '2026-11-08T10:00:00Z' },
    { ...base, id: 1, status: 'failed', summary: null, error: 'old', finished_at: '2026-11-08T09:00:00Z' },
  ])
  assert.equal(status.lastError, null)
  assert.equal(status.lastSummary?.refreshed, 5)
})

'use strict'

/**
 * Control Tower HTTP surface: admin-only, KSA-only, 202 + polling for refreshes, validation of SKU
 * mapping / settings edits (our database only).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const ctrl = require('../src/controllers/amazonControlTowerController.ts')
const router = require('../src/routes/amazonControlTower.routes.ts')
const { createMemoryRefreshStore } = require('../src/services/amazonControlTower/refreshRunStore.ts')
const { createRefreshRunner } = require('../src/services/amazonControlTower/refreshRunner.ts')

const quietLog = { info() {}, error() {} }

type Call = { method: string; args: unknown[] }

function fakeStore(calls: Call[]) {
  const sku = {
    id: 7,
    marketplaceKey: 'ksa',
    sellerSku: 'SKU-A',
    zohoItemId: 'z1',
    zohoItemCode: 'SKU-A',
    zohoItemName: 'A',
    mappingStatus: 'REVIEW_REQUIRED',
    mappingMethod: null,
    mappingCandidates: [{ zohoItemId: 'z1', method: 'EXACT_ITEM_CODE' }, { zohoItemId: 'z2', method: 'EXACT_ITEM_NAME' }],
  }
  const settings = { marketplaceKey: 'ksa', timezone: 'Asia/Riyadh', vatRate: 0.15, targetCoverDays: 45, maxCoverDays: 90 }
  const record = (method: string, value: unknown) => async (...args: unknown[]) => {
    calls.push({ method, args })
    return value
  }
  return {
    getSkuMasterRow: async (_mk: string, id: number) => (id === 7 ? { ...sku } : null),
    findWarehouseItem: async (id: string) => (['z1', 'z2'].includes(id) ? { zohoItemId: id, itemCode: id.toUpperCase(), itemName: id } : null),
    confirmMapping: async (mk: string, id: number, target: any, actor: string) => {
      calls.push({ method: 'confirmMapping', args: [mk, id, target, actor] })
      return { ...sku, mappingStatus: 'CONFIRMED', zohoItemId: target.zohoItemId, mappingMethod: target.method }
    },
    markUnmapped: record('markUnmapped', { ...sku, mappingStatus: 'UNMAPPED' }),
    updateSkuParameters: record('updateSkuParameters', { ...sku, packMultiplier: 2 }),
    listSkuMaster: record('listSkuMaster', { rows: [], total: 0, statusCounts: {} }),
    searchWarehouseItems: record('searchWarehouseItems', [{ zohoItemId: 'z1' }]),
    getSettings: async () => ({ ...settings }),
    updateSettings: record('updateSettings', settings),
  }
}

async function withServer(role: string | null, deps: any, fn: (base: string) => Promise<void>) {
  ctrl.setDeps(deps)
  const app = express()
  app.use(express.json())
  app.use((req: any, _res: any, next: any) => {
    if (role) req.user = { userId: 42, role }
    next()
  })
  app.use('/api/amazon/control-tower', router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const { port } = server.address()
  try {
    await fn(`http://127.0.0.1:${port}/api/amazon/control-tower`)
  } finally {
    await new Promise((r) => server.close(r))
    ctrl.setDeps(null)
  }
}

async function call(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

function makeDeps(calls: Call[] = []) {
  const refreshStore = createMemoryRefreshStore()
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const ok = async () => { await gate; return { recordsProcessed: 1 } }
  const runner = createRefreshRunner({
    store: refreshStore,
    handlers: { listings: ok, listing_status: ok, sales: ok, rollup: ok, fba_inventory: ok, warehouse_stock: ok, sales_backfill: ok },
    computeFreshness: async () => ({ sources: [] }),
    heartbeatMs: 1000,
    log: quietLog,
  })
  return {
    runner,
    refreshStore,
    release: () => release(),
    store: fakeStore(calls),
    service: { computeFreshness: async () => ({ sources: [] }), getCommandCenter: async () => ({ kpis: {} }) },
  }
}

test('non-admins and anonymous users are rejected before any work', async () => {
  const deps = makeDeps()
  await withServer(null, deps, async (base) => {
    assert.equal((await call(base, 'POST', '/ksa/refresh')).status, 401)
  })
  await withServer('employee', deps, async (base) => {
    assert.equal((await call(base, 'POST', '/ksa/refresh')).status, 403)
    assert.equal((await call(base, 'GET', '/ksa/command-center')).status, 403)
  })
  await withServer('warehouse', deps, async (base) => {
    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/mapping', { zohoItemId: 'z1' })).status, 403)
  })
  assert.equal((await deps.refreshStore.listRecentRuns('ksa', 10)).length, 0)
})

test('only KSA is supported', async () => {
  await withServer('admin', makeDeps(), async (base) => {
    const res = await call(base, 'POST', '/uae/refresh')
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'UNSUPPORTED_MARKETPLACE')
    assert.equal((await call(base, 'GET', '/uae/command-center')).status, 400)
  })
})

test('Refresh All answers 202 with run ids, a second click reuses the running job, and the run is pollable', async () => {
  const deps = makeDeps()
  await withServer('admin', deps, async (base) => {
    const first = await call(base, 'POST', '/ksa/refresh', {})
    assert.equal(first.status, 202)
    assert.equal(first.body.status, 'queued')
    assert.equal(first.body.jobType, 'refresh_all')
    assert.equal(first.body.runIds.length, 7, 'parent run first, then one run per step')

    const second = await call(base, 'POST', '/ksa/refresh', {})
    assert.equal(second.status, 202)
    assert.equal(second.body.alreadyRunning, true)
    assert.deepEqual(second.body.runIds, first.body.runIds)

    const poll = await call(base, 'GET', `/ksa/runs/${first.body.runIds[0]}`)
    assert.equal(poll.status, 200)
    assert.equal(poll.body.run.jobType, 'refresh_all')
    assert.equal(poll.body.run.requestedBy, 'user:42')
    assert.equal(poll.body.run.children.length, 6)

    deps.release()
    await deps.runner.drain()
    const done = await call(base, 'GET', `/ksa/runs/${first.body.runIds[0]}`)
    assert.equal(done.body.run.status, 'succeeded')
    assert.ok(done.body.run.children.every((c: any) => c.status === 'succeeded'))

    assert.equal((await call(base, 'GET', '/ksa/runs/00000000-0000-4000-8000-000000000999')).status, 404)
  })
})

test('job type and backfill input are validated', async () => {
  const deps = makeDeps()
  await withServer('admin', deps, async (base) => {
    assert.equal((await call(base, 'POST', '/ksa/refresh', { jobType: 'create_shipment' })).body.code, 'INVALID_JOB_TYPE')
    assert.equal((await call(base, 'POST', '/ksa/refresh', { jobType: 'sales_backfill' })).status, 400, 'backfill has its own endpoint')
    assert.equal((await call(base, 'POST', '/ksa/backfill', { days: 5000 })).status, 400)
    assert.equal((await call(base, 'POST', '/ksa/backfill', { windowDays: 60 })).status, 400)
    const ok = await call(base, 'POST', '/ksa/backfill', { days: 365 })
    assert.equal(ok.status, 202)
    assert.equal(ok.body.jobType, 'sales_backfill')
    deps.release()
    await deps.runner.drain()
  })
})

test('SKU mapping actions write only through our store and validate input', async () => {
  const calls: Call[] = []
  await withServer('admin', makeDeps(calls), async (base) => {
    const confirm = await call(base, 'POST', '/ksa/sku-master/7/confirm', {})
    assert.equal(confirm.status, 200)
    assert.equal(calls.at(-1)!.method, 'confirmMapping')
    assert.equal((calls.at(-1)!.args[2] as any).zohoItemId, 'z1')
    assert.equal(calls.at(-1)!.args[3], 'user:42')

    const pick = await call(base, 'POST', '/ksa/sku-master/7/confirm', { zohoItemId: 'z2' })
    assert.equal(pick.status, 200)
    assert.equal((calls.at(-1)!.args[2] as any).method, 'EXACT_ITEM_NAME', 'picking a suggested candidate keeps its match method')

    const change = await call(base, 'PUT', '/ksa/sku-master/7/mapping', { zohoItemId: 'z2' })
    assert.equal(change.status, 200)
    assert.equal((calls.at(-1)!.args[2] as any).method, 'MANUAL')

    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/mapping', { zohoItemId: 'not-in-snapshot' })).body.code, 'ZOHO_ITEM_UNKNOWN')
    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/mapping', {})).body.code, 'ZOHO_ITEM_REQUIRED')
    assert.equal((await call(base, 'POST', '/ksa/sku-master/99/confirm', {})).status, 404)
    assert.equal((await call(base, 'POST', '/ksa/sku-master/abc/confirm', {})).body.code, 'INVALID_SKU_ID')

    assert.equal((await call(base, 'POST', '/ksa/sku-master/7/unmap')).status, 200)
    assert.equal(calls.at(-1)!.method, 'markUnmapped')

    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/parameters', { packMultiplier: 0 })).status, 400)
    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/parameters', { cartonQuantity: 2.5 })).status, 400)
    assert.equal((await call(base, 'PUT', '/ksa/sku-master/7/parameters', {})).body.code, 'NOTHING_TO_UPDATE')
    const params = await call(base, 'PUT', '/ksa/sku-master/7/parameters', { packMultiplier: '2', cartonQuantity: null })
    assert.equal(params.status, 200)
    assert.deepEqual(calls.at(-1)!.args[2], { packMultiplier: 2, cartonQuantity: null })

    assert.equal((await call(base, 'GET', '/ksa/sku-master?status=bogus')).status, 400)
    assert.equal((await call(base, 'GET', '/ksa/sku-master?status=unmapped&search=abc')).status, 200)
    assert.equal((calls.at(-1)!.args[1] as any).status, 'UNMAPPED')
    assert.deepEqual((await call(base, 'GET', '/ksa/zoho-items?search=a')).body, { items: [] })
  })
})

test('settings: ranges are validated and max cover cannot be below target cover', async () => {
  const calls: Call[] = []
  await withServer('admin', makeDeps(calls), async (base) => {
    const got = await call(base, 'GET', '/ksa/settings')
    assert.equal(got.status, 200)
    assert.equal(got.body.settings.timezone, 'Asia/Riyadh')
    assert.equal(typeof got.body.schedulerEnvEnabled, 'boolean')
    assert.ok(Array.isArray(got.body.schedules))

    assert.equal((await call(base, 'PUT', '/ksa/settings', { maxCoverDays: 30 })).status, 400)
    assert.equal((await call(base, 'PUT', '/ksa/settings', { vatRate: 15 })).status, 400)
    assert.equal((await call(base, 'PUT', '/ksa/settings', { lowStockUnitsThreshold: -1 })).status, 400)
    const ok = await call(base, 'PUT', '/ksa/settings', { lowStockUnitsThreshold: 12, schedulerEnabled: true, timezone: 'UTC' })
    assert.equal(ok.status, 200)
    assert.deepEqual(calls.at(-1)!.args[1], { lowStockUnitsThreshold: 12 }, 'scheduler flag and timezone are not editable here')

    assert.equal((await call(base, 'PUT', '/ksa/settings', { healthAgedMinDays: 100 })).status, 400, 'aged threshold must be an Amazon bucket boundary')
    assert.equal((await call(base, 'PUT', '/ksa/settings', { capacityWarnPct: 95, capacityHighPct: 90 })).status, 400)
    const thresholds = await call(base, 'PUT', '/ksa/settings', { healthAgedMinDays: 271, healthExcessCoverDays: 200, capacityWarnPct: 75 })
    assert.equal(thresholds.status, 200)
    assert.deepEqual(calls.at(-1)!.args[1], { healthAgedMinDays: 271, healthExcessCoverDays: 200, capacityWarnPct: 75 })
  })
})

function fakeCapacityHealth(calls: Call[]) {
  const record = (method: string, value: any) => async (...args: unknown[]) => {
    calls.push({ method, args })
    return typeof value === 'function' ? value(...args) : value
  }
  return {
    getCapacity: record('getCapacity', { kpis: [] }),
    createCapacityPeriod: record('createCapacityPeriod', (_mk: string, input: any) => ({ id: 1, ...input })),
    reviseCapacityPeriod: record('reviseCapacityPeriod', (_mk: string, id: number) => (id === 1 ? { period: { id: 2 }, previous: { id: 1 } } : { error: 'SUPERSEDED', supersededById: 9 })),
    verifyCapacityPeriod: record('verifyCapacityPeriod', (_mk: string, id: number) => (id === 1 ? { id: 1 } : null)),
    getInventoryHealth: record('getInventoryHealth', { rows: [] }),
    getInactiveWithStock: record('getInactiveWithStock', { rows: [] }),
    getRemovalOrders: record('getRemovalOrders', { rows: [] }),
    getCapacityRelease: record('getCapacityRelease', { rows: [] }),
    getActions: record('getActions', { actions: [] }),
  }
}

function capacityDeps(calls: Call[]) {
  const deps: any = makeDeps(calls)
  deps.capacityHealth = fakeCapacityHealth(calls)
  deps.chStore = {
    getCapacityPeriod: async (_mk: string, id: number) =>
      id === 1 || id === 5 ? { id, periodStart: '2026-10-01', periodEnd: '2026-12-31', storageType: 'ALL', capacityUnit: 'CUBIC_FEET', capacityLimit: 100 } : null,
    listCapacityPeriods: async () => [],
    listCapacityEvents: async () => [],
  }
  return deps
}

const PERIOD = { periodStart: '2026-10-01', periodEnd: '2026-12-31', storageType: 'ALL', capacityLimit: 1500, capacityUnit: 'CUBIC_FEET' }

test('capacity / health / removal endpoints are admin-only and KSA-only', async () => {
  const calls: Call[] = []
  const deps = capacityDeps(calls)
  await withServer('employee', deps, async (base) => {
    assert.equal((await call(base, 'GET', '/ksa/capacity')).status, 403)
    assert.equal((await call(base, 'POST', '/ksa/capacity/periods', PERIOD)).status, 403)
  })
  await withServer('admin', deps, async (base) => {
    for (const path of ['/capacity', '/capacity/periods', '/capacity-release', '/inventory-health', '/inventory-health/inactive-with-stock', '/removal-orders', '/actions']) {
      const uae = await call(base, 'GET', `/uae${path}`)
      assert.equal(uae.status, 400, `/uae${path}`)
      assert.equal(uae.body.code, 'UNSUPPORTED_MARKETPLACE')
      assert.equal((await call(base, 'GET', `/ksa${path}`)).status, 200, `/ksa${path}`)
    }
    assert.equal((await call(base, 'POST', '/uae/capacity/periods', PERIOD)).status, 400)
  })
  assert.ok(!calls.some((c) => c.args[0] === 'uae'), 'nothing reaches the service for UAE')
})

test('manual capacity entry is validated; revisions never overwrite (409 on a superseded version)', async () => {
  const calls: Call[] = []
  await withServer('admin', capacityDeps(calls), async (base) => {
    const bad = async (body: any) => (await call(base, 'POST', '/ksa/capacity/periods', body)).status
    assert.equal(await bad({ ...PERIOD, capacityLimit: 0 }), 400)
    assert.equal(await bad({ ...PERIOD, capacityLimit: undefined }), 400)
    assert.equal(await bad({ ...PERIOD, periodEnd: '2026-09-01' }), 400)
    assert.equal(await bad({ ...PERIOD, periodStart: '2026-02-30' }), 400)
    assert.equal(await bad({ ...PERIOD, capacityUnit: 'LITRES' }), 400)
    assert.equal(await bad({ ...PERIOD, storageType: 'OTHER' }), 400, 'OTHER needs a label')
    assert.equal(await bad({ ...PERIOD, source: 'AMAZON_API' }), 400, 'people cannot record AMAZON_API figures')
    assert.equal(await bad({ ...PERIOD, source: 'CALCULATED' }), 400)
    assert.equal(await bad({ ...PERIOD, amazonReportedUsage: -1 }), 400)

    const created = await call(base, 'POST', '/ksa/capacity/periods', { ...PERIOD, amazonReportedUsage: 900, notes: 'From Seller Central capacity monitor' })
    assert.equal(created.status, 201)
    const input = calls.at(-1)!.args[1] as any
    assert.equal(input.source, 'SELLER_CENTRAL_MANUAL', 'manual source by default')
    assert.equal(input.amazonReportedUsage, 900)
    assert.equal(calls.at(-1)!.args[2], 'user:42')

    assert.equal((await call(base, 'PUT', '/ksa/capacity/periods/1', {})).body.code, 'NOTHING_TO_UPDATE')
    assert.equal((await call(base, 'PUT', '/ksa/capacity/periods/1', { periodEnd: '2026-01-01' })).status, 400, 'merged with the stored start date')
    assert.equal((await call(base, 'PUT', '/ksa/capacity/periods/77', { capacityLimit: 10 })).status, 404)
    const revised = await call(base, 'PUT', '/ksa/capacity/periods/1', { capacityLimit: 1600 })
    assert.equal(revised.status, 200)
    assert.equal(revised.body.period.id, 2)
    const stale = await call(base, 'PUT', '/ksa/capacity/periods/5', { capacityLimit: 1700 })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'PERIOD_SUPERSEDED')

    assert.equal((await call(base, 'POST', '/ksa/capacity/periods/1/verify')).status, 200)
    assert.equal((await call(base, 'POST', '/ksa/capacity/periods/3/verify')).status, 404)
    assert.equal((await call(base, 'POST', '/ksa/capacity/periods/x/verify')).body.code, 'INVALID_PERIOD_ID')
  })
})

test('inventory health defaults to ACTIVE; filters and removal status are validated', async () => {
  const calls: Call[] = []
  await withServer('admin', capacityDeps(calls), async (base) => {
    await call(base, 'GET', '/ksa/inventory-health')
    assert.equal((calls.at(-1)!.args[1] as any).filter, 'active')
    await call(base, 'GET', '/ksa/inventory-health?filter=inactive_with_stock&healthStatus=aged&search=brush')
    assert.deepEqual(calls.at(-1)!.args[1], { filter: 'inactive_with_stock', healthStatus: 'AGED', search: 'brush', limit: undefined })
    assert.equal((await call(base, 'GET', '/ksa/inventory-health?filter=everything')).status, 400)
    assert.equal((await call(base, 'GET', '/ksa/inventory-health?healthStatus=GREAT')).status, 400)

    await call(base, 'GET', '/ksa/removal-orders')
    assert.equal(calls.at(-1)!.args[1], null)
    await call(base, 'GET', '/ksa/removal-orders?status=open')
    assert.equal(calls.at(-1)!.args[1], 'OPEN')
    assert.equal((await call(base, 'GET', '/ksa/removal-orders?status=create')).status, 400)
    await call(base, 'GET', '/ksa/actions')
    assert.equal(calls.at(-1)!.args[1], 'OPEN')
    assert.equal((await call(base, 'GET', '/ksa/actions?status=bogus')).status, 400)
  })
})

test('new manual job types are accepted; there is no route that creates removals, shipments or listing changes', async () => {
  for (const jobType of ['refresh_health', 'listing_status', 'inventory_reports', 'removal_orders']) {
    assert.ok(ctrl.MANUAL_JOB_TYPES.includes(jobType), jobType)
  }
  const paths = router.stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`)
  assert.ok(!paths.some((p: string) => p.startsWith('DELETE')), 'no deletes')
  assert.ok(!paths.some((p: string) => /removal-orders/.test(p) && !p.startsWith('GET')), 'removal orders are read-only')
  assert.ok(!paths.some((p: string) => /shipment|listing-update|price/i.test(p)))
})

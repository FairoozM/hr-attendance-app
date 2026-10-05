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
    handlers: { listings: ok, sales: ok, rollup: ok, fba_inventory: ok, warehouse_stock: ok, sales_backfill: ok },
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
    assert.equal(first.body.runIds.length, 6, 'parent run first, then one run per step')

    const second = await call(base, 'POST', '/ksa/refresh', {})
    assert.equal(second.status, 202)
    assert.equal(second.body.alreadyRunning, true)
    assert.deepEqual(second.body.runIds, first.body.runIds)

    const poll = await call(base, 'GET', `/ksa/runs/${first.body.runIds[0]}`)
    assert.equal(poll.status, 200)
    assert.equal(poll.body.run.jobType, 'refresh_all')
    assert.equal(poll.body.run.requestedBy, 'user:42')
    assert.equal(poll.body.run.children.length, 5)

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
  })
})

'use strict'

/**
 * Amazon Control Tower API (admin only). Refreshes run in the background: POST answers 202 with run
 * ids and the client polls GET /runs/:id. SKU mapping actions change only our own database.
 */

const { isSupportedMarketplace, getControlTower } = require('../services/amazonControlTower/controlTowerService.ts')
const { JOB_TYPES } = require('../services/amazonControlTower/refreshRunner.ts')
const { isSchedulerEnabled } = require('../services/amazonControlTower/refreshScheduler.ts')

type Req = any
type Res = any

let deps: any = null

function getDeps() {
  if (!deps) deps = getControlTower()
  return deps
}

/** Test hook. */
function setDeps(next: any) {
  deps = next
}

const MANUAL_JOB_TYPES = [
  JOB_TYPES.REFRESH_ALL,
  JOB_TYPES.LISTINGS,
  JOB_TYPES.SALES,
  JOB_TYPES.ROLLUP,
  JOB_TYPES.FBA_INVENTORY,
  JOB_TYPES.WAREHOUSE_STOCK,
]

function httpError(status: number, code: string, message: string) {
  const err: any = new Error(message)
  err.status = status
  err.code = code
  return err
}

function sendError(res: Res, err: any, label: string) {
  const status = err.status || 500
  if (status >= 500) console.error(`[control-tower] ${label} failed:`, err.code || '', err.message)
  return res.status(status).json({ error: err.message || `Control Tower ${label} failed.`, code: err.code || undefined })
}

function marketplaceOf(req: Req): string {
  const mk = String(req.params.marketplace || '').toLowerCase()
  if (!isSupportedMarketplace(mk)) throw httpError(400, 'UNSUPPORTED_MARKETPLACE', 'Control Tower currently supports KSA only.')
  return mk
}

function actorOf(req: Req): string {
  return req.user && req.user.userId ? `user:${req.user.userId}` : 'user:unknown'
}

function skuIdOf(req: Req): number {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'INVALID_SKU_ID', 'Invalid SKU id.')
  return id
}

function optionalInt(value: unknown, field: string, min: number, max: number, { nullable = false } = {}): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') {
    if (nullable) return null
    throw httpError(400, 'INVALID_FIELD', `${field} is required.`)
  }
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, 'INVALID_FIELD', `${field} must be a whole number between ${min} and ${max}.`)
  return n
}

async function startRefresh(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const jobType = String(req.body?.jobType || JOB_TYPES.REFRESH_ALL)
    if (!MANUAL_JOB_TYPES.includes(jobType)) throw httpError(400, 'INVALID_JOB_TYPE', `jobType must be one of: ${MANUAL_JOB_TYPES.join(', ')}`)
    const result = await getDeps().runner.start({ marketplaceKey: mk, jobType, trigger: 'manual', requestedBy: actorOf(req) })
    return res.status(202).json({ runIds: result.runIds, status: result.status, alreadyRunning: result.alreadyRunning, jobType })
  } catch (err) {
    return sendError(res, err, 'refresh start')
  }
}

async function startBackfill(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const days = optionalInt(req.body?.days, 'days', 1, 730)
    const windowDays = optionalInt(req.body?.windowDays, 'windowDays', 1, 30)
    const params: Record<string, number> = {}
    if (days != null) params.days = days
    if (windowDays != null) params.windowDays = windowDays
    const result = await getDeps().runner.start({
      marketplaceKey: mk,
      jobType: JOB_TYPES.SALES_BACKFILL,
      trigger: 'manual',
      requestedBy: actorOf(req),
      params,
    })
    return res.status(202).json({ runIds: result.runIds, status: result.status, alreadyRunning: result.alreadyRunning, jobType: JOB_TYPES.SALES_BACKFILL })
  } catch (err) {
    return sendError(res, err, 'backfill start')
  }
}

async function getRun(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const run = await getDeps().runner.getRunWithChildren(String(req.params.id || ''))
    if (!run || run.marketplaceKey !== mk) throw httpError(404, 'RUN_NOT_FOUND', 'Run not found.')
    return res.json({ run })
  } catch (err) {
    return sendError(res, err, 'run lookup')
  }
}

async function listRuns(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    await getDeps().runner.sweepStaleRuns()
    const runs = await getDeps().refreshStore.listRecentRuns(mk, Number(req.query.limit) || 20)
    return res.json({ runs })
  } catch (err) {
    return sendError(res, err, 'run list')
  }
}

async function getFreshness(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    await getDeps().runner.sweepStaleRuns()
    return res.json(await getDeps().service.computeFreshness(mk))
  } catch (err) {
    return sendError(res, err, 'freshness')
  }
}

async function getCommandCenter(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    await getDeps().runner.sweepStaleRuns()
    return res.json(await getDeps().service.getCommandCenter(mk))
  } catch (err) {
    return sendError(res, err, 'command center')
  }
}

async function listSkuMaster(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined
    if (status && !['CONFIRMED', 'AUTO_MATCHED', 'REVIEW_REQUIRED', 'UNMAPPED'].includes(status)) {
      throw httpError(400, 'INVALID_STATUS', 'Unknown mapping status filter.')
    }
    const out = await getDeps().store.listSkuMaster(mk, {
      status,
      search: req.query.search ? String(req.query.search).slice(0, 100) : undefined,
      activeOnly: String(req.query.activeOnly || '') === '1',
      limit: Number(req.query.limit) || 200,
      offset: Number(req.query.offset) || 0,
    })
    return res.json(out)
  } catch (err) {
    return sendError(res, err, 'SKU master list')
  }
}

async function resolveZohoItem(zohoItemId: unknown) {
  const id = String(zohoItemId || '').trim()
  if (!id) throw httpError(400, 'ZOHO_ITEM_REQUIRED', 'zohoItemId is required.')
  const item = await getDeps().store.findWarehouseItem(id)
  if (!item) throw httpError(400, 'ZOHO_ITEM_UNKNOWN', 'That Zoho item is not in the latest warehouse snapshot. Refresh warehouse stock first.')
  return item
}

async function confirmSku(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = skuIdOf(req)
    const { store } = getDeps()
    const row = await store.getSkuMasterRow(mk, id)
    if (!row) throw httpError(404, 'SKU_NOT_FOUND', 'SKU not found.')
    let target
    if (req.body?.zohoItemId) {
      const item = await resolveZohoItem(req.body.zohoItemId)
      const candidate = (row.mappingCandidates || []).find((c: any) => c.zohoItemId === item.zohoItemId)
      target = { ...item, method: candidate ? candidate.method : 'MANUAL' }
    } else {
      if (!row.zohoItemId) throw httpError(400, 'NOTHING_TO_CONFIRM', 'This SKU has no suggested Zoho item. Choose one with Change mapping.')
      target = { zohoItemId: row.zohoItemId, itemCode: row.zohoItemCode, itemName: row.zohoItemName, method: row.mappingMethod || 'MANUAL' }
    }
    const updated = await store.confirmMapping(mk, id, target, actorOf(req))
    return res.json({ sku: updated })
  } catch (err) {
    return sendError(res, err, 'SKU confirm')
  }
}

async function changeSkuMapping(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = skuIdOf(req)
    const { store } = getDeps()
    const row = await store.getSkuMasterRow(mk, id)
    if (!row) throw httpError(404, 'SKU_NOT_FOUND', 'SKU not found.')
    const item = await resolveZohoItem(req.body?.zohoItemId)
    const updated = await store.confirmMapping(mk, id, { ...item, method: 'MANUAL' }, actorOf(req))
    return res.json({ sku: updated })
  } catch (err) {
    return sendError(res, err, 'SKU mapping change')
  }
}

async function unmapSku(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = skuIdOf(req)
    const updated = await getDeps().store.markUnmapped(mk, id, actorOf(req))
    if (!updated) throw httpError(404, 'SKU_NOT_FOUND', 'SKU not found.')
    return res.json({ sku: updated })
  } catch (err) {
    return sendError(res, err, 'SKU unmap')
  }
}

async function updateSkuParameters(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = skuIdOf(req)
    const patch: { packMultiplier?: number; cartonQuantity?: number | null } = {}
    if (req.body?.packMultiplier !== undefined) {
      const n = Number(req.body.packMultiplier)
      if (!Number.isFinite(n) || n <= 0 || n > 1000) throw httpError(400, 'INVALID_FIELD', 'packMultiplier must be a number greater than 0 and at most 1000.')
      patch.packMultiplier = Math.round(n * 10000) / 10000
    }
    const carton = optionalInt(req.body?.cartonQuantity, 'cartonQuantity', 1, 100000, { nullable: true })
    if (carton !== undefined) patch.cartonQuantity = carton
    if (!Object.keys(patch).length) throw httpError(400, 'NOTHING_TO_UPDATE', 'Send packMultiplier and/or cartonQuantity.')
    const updated = await getDeps().store.updateSkuParameters(mk, id, patch)
    if (!updated) throw httpError(404, 'SKU_NOT_FOUND', 'SKU not found.')
    return res.json({ sku: updated })
  } catch (err) {
    return sendError(res, err, 'SKU parameters')
  }
}

async function searchZohoItems(req: Req, res: Res) {
  try {
    marketplaceOf(req)
    const search = String(req.query.search || '').trim()
    if (search.length < 2) return res.json({ items: [] })
    const items = await getDeps().store.searchWarehouseItems(search.slice(0, 100), Number(req.query.limit) || 25)
    return res.json({ items })
  } catch (err) {
    return sendError(res, err, 'Zoho item search')
  }
}

async function getSettings(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const { store, refreshStore } = getDeps()
    const settings = await store.getSettings(mk)
    if (!settings) throw httpError(404, 'SETTINGS_NOT_FOUND', 'Settings not found.')
    const schedules = await refreshStore.listSchedules(mk)
    return res.json({ settings, schedules, schedulerEnvEnabled: isSchedulerEnabled() })
  } catch (err) {
    return sendError(res, err, 'settings')
  }
}

async function updateSettings(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const body = req.body || {}
    const patch: Record<string, unknown> = {}
    const low = optionalInt(body.lowStockUnitsThreshold, 'lowStockUnitsThreshold', 0, 100000)
    if (low !== undefined) patch.lowStockUnitsThreshold = low
    const target = optionalInt(body.targetCoverDays, 'targetCoverDays', 1, 365)
    if (target !== undefined) patch.targetCoverDays = target
    const max = optionalInt(body.maxCoverDays, 'maxCoverDays', 1, 730)
    if (max !== undefined) patch.maxCoverDays = max
    const lead = optionalInt(body.defaultLeadTimeDays, 'defaultLeadTimeDays', 0, 365)
    if (lead !== undefined) patch.defaultLeadTimeDays = lead
    const carton = optionalInt(body.defaultCartonQuantity, 'defaultCartonQuantity', 1, 100000, { nullable: true })
    if (carton !== undefined) patch.defaultCartonQuantity = carton
    if (body.vatRate !== undefined) {
      const v = Number(body.vatRate)
      if (!Number.isFinite(v) || v < 0 || v >= 0.5) throw httpError(400, 'INVALID_FIELD', 'vatRate must be between 0 and 0.5 (e.g. 0.15).')
      patch.vatRate = v
    }
    const { store } = getDeps()
    const current = await store.getSettings(mk)
    if (!current) throw httpError(404, 'SETTINGS_NOT_FOUND', 'Settings not found.')
    const nextTarget = (patch.targetCoverDays as number) ?? current.targetCoverDays
    const nextMax = (patch.maxCoverDays as number) ?? current.maxCoverDays
    if (nextMax < nextTarget) throw httpError(400, 'INVALID_FIELD', 'maxCoverDays must be greater than or equal to targetCoverDays.')
    const settings = await store.updateSettings(mk, patch)
    return res.json({ settings })
  } catch (err) {
    return sendError(res, err, 'settings update')
  }
}

module.exports = {
  setDeps,
  startRefresh,
  startBackfill,
  getRun,
  listRuns,
  getFreshness,
  getCommandCenter,
  listSkuMaster,
  confirmSku,
  changeSkuMapping,
  unmapSku,
  updateSkuParameters,
  searchZohoItems,
  getSettings,
  updateSettings,
}

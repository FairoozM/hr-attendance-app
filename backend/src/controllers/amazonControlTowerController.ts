'use strict'

/**
 * Amazon Control Tower API (admin only). Refreshes run in the background: POST answers 202 with run
 * ids and the client polls GET /runs/:id. SKU mapping actions change only our own database.
 */

const { isSupportedMarketplace, getControlTower } = require('../services/amazonControlTower/controlTowerService.ts')
const { JOB_TYPES } = require('../services/amazonControlTower/refreshRunner.ts')
const { isSchedulerEnabled } = require('../services/amazonControlTower/refreshScheduler.ts')
const { HEALTH_SETTING_DEFAULTS } = require('../services/amazonControlTower/controlTowerStore.ts')

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
  JOB_TYPES.REFRESH_HEALTH,
  JOB_TYPES.LISTINGS,
  JOB_TYPES.LISTING_STATUS,
  JOB_TYPES.SALES,
  JOB_TYPES.ROLLUP,
  JOB_TYPES.FBA_INVENTORY,
  JOB_TYPES.WAREHOUSE_STOCK,
  JOB_TYPES.INVENTORY_REPORTS,
  JOB_TYPES.REMOVAL_ORDERS,
]

const STORAGE_TYPES = ['ALL', 'STANDARD', 'OVERSIZE', 'APPAREL', 'FOOTWEAR', 'OTHER']
const CAPACITY_UNITS = ['CUBIC_FEET', 'CUBIC_METERS', 'UNITS', 'OTHER']
/** Sources a person may record; AMAZON_API and CALCULATED are reserved for system-produced rows. */
const MANUAL_CAPACITY_SOURCES = ['SELLER_CENTRAL_MANUAL', 'IMPORT']
const HEALTH_FILTERS = ['active', 'inactive_with_stock', 'suppressed', 'all']
const HEALTH_STATUSES = ['HEALTHY', 'WATCH', 'SLOW', 'EXCESS', 'AGED', 'ZERO_SALES', 'OUT_ZERO_FBA', 'DATA_INCOMPLETE']
const REMOVAL_STATUS_FILTERS = ['OPEN', 'COMPLETED', 'CANCELLED', 'ALL']

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
    if (body.healthAgedMinDays !== undefined) {
      const v = Number(body.healthAgedMinDays)
      if (![91, 181, 271, 366].includes(v)) throw httpError(400, 'INVALID_FIELD', 'healthAgedMinDays must be 91, 181, 271 or 366 (Amazon age bucket boundaries).')
      patch.healthAgedMinDays = v
    }
    const intSettings: [string, number, number][] = [
      ['healthExcessCoverDays', 1, 1000],
      ['healthLowCoverDays', 0, 365],
      ['healthSlowUnitsPer30d', 0, 100000],
      ['healthVeryLowUnitsPer30d', 0, 100000],
      ['removalStuckDays', 1, 365],
      ['capacityWarnPct', 1, 200],
      ['capacityHighPct', 1, 200],
      ['capacityCriticalPct', 1, 300],
      ['usageCoverageMinPct', 0, 100],
    ]
    for (const [field, min, maxValue] of intSettings) {
      const v = optionalInt(body[field], field, min, maxValue)
      if (v !== undefined) patch[field] = v
    }
    const { store } = getDeps()
    const current = await store.getSettings(mk)
    if (!current) throw httpError(404, 'SETTINGS_NOT_FOUND', 'Settings not found.')
    const nextTarget = (patch.targetCoverDays as number) ?? current.targetCoverDays
    const nextMax = (patch.maxCoverDays as number) ?? current.maxCoverDays
    if (nextMax < nextTarget) throw httpError(400, 'INVALID_FIELD', 'maxCoverDays must be greater than or equal to targetCoverDays.')
    const next = (k: string) => (patch[k] as number) ?? current[k] ?? HEALTH_SETTING_DEFAULTS[k]
    if (!(next('capacityWarnPct') < next('capacityHighPct') && next('capacityHighPct') <= next('capacityCriticalPct'))) {
      throw httpError(400, 'INVALID_FIELD', 'Capacity thresholds must satisfy warn < high ≤ critical.')
    }
    if (next('healthVeryLowUnitsPer30d') > next('healthSlowUnitsPer30d')) {
      throw httpError(400, 'INVALID_FIELD', 'healthVeryLowUnitsPer30d must not exceed healthSlowUnitsPer30d.')
    }
    const settings = await store.updateSettings(mk, patch)
    return res.json({ settings })
  } catch (err) {
    return sendError(res, err, 'settings update')
  }
}

// ---------- capacity, inventory health, removals ----------

function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
}

function optionalText(value: unknown, field: string, maxLen: number): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const s = String(value).trim()
  if (s.length > maxLen) throw httpError(400, 'INVALID_FIELD', `${field} must be at most ${maxLen} characters.`)
  return s || null
}

function optionalNumber(value: unknown, field: string, { min = 0, max = 1e9, nullable = true } = {}): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') {
    if (nullable) return null
    throw httpError(400, 'INVALID_FIELD', `${field} is required.`)
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, 'INVALID_FIELD', `${field} must be a number between ${min} and ${max}.`)
  return Math.round(n * 10000) / 10000
}

/** Validated capacity-period fields from a request body; `partial` for revisions. */
function capacityPeriodInput(body: any, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const b = body || {}
  for (const field of ['periodStart', 'periodEnd']) {
    if (b[field] === undefined) {
      if (!partial) throw httpError(400, 'INVALID_FIELD', `${field} (YYYY-MM-DD) is required.`)
      continue
    }
    if (!isDateString(b[field])) throw httpError(400, 'INVALID_FIELD', `${field} must be a date (YYYY-MM-DD).`)
    out[field] = b[field]
  }
  if (b.storageType !== undefined || !partial) {
    const st = String(b.storageType ?? 'ALL').toUpperCase()
    if (!STORAGE_TYPES.includes(st)) throw httpError(400, 'INVALID_FIELD', `storageType must be one of: ${STORAGE_TYPES.join(', ')}.`)
    out.storageType = st
  }
  if (b.capacityUnit !== undefined || !partial) {
    const unit = String(b.capacityUnit ?? '').toUpperCase()
    if (!CAPACITY_UNITS.includes(unit)) throw httpError(400, 'INVALID_FIELD', `capacityUnit must be one of: ${CAPACITY_UNITS.join(', ')}.`)
    out.capacityUnit = unit
  }
  const limit = optionalNumber(b.capacityLimit, 'capacityLimit', { min: 0.0001, nullable: false })
  if (limit === undefined && !partial) throw httpError(400, 'INVALID_FIELD', 'capacityLimit is required.')
  if (limit !== undefined) out.capacityLimit = limit
  const usage = optionalNumber(b.amazonReportedUsage, 'amazonReportedUsage')
  if (usage !== undefined) out.amazonReportedUsage = usage
  if (b.source !== undefined || !partial) {
    const source = String(b.source ?? 'SELLER_CENTRAL_MANUAL').toUpperCase()
    if (!MANUAL_CAPACITY_SOURCES.includes(source)) throw httpError(400, 'INVALID_FIELD', `source must be one of: ${MANUAL_CAPACITY_SOURCES.join(', ')}.`)
    out.source = source
  }
  const texts: [string, number][] = [
    ['storageTypeLabel', 100],
    ['capacityUnitLabel', 50],
    ['sourceReference', 500],
    ['notes', 2000],
  ]
  for (const [field, maxLen] of texts) {
    const v = optionalText(b[field], field, maxLen)
    if (v !== undefined) out[field] = v
  }
  return out
}

function checkPeriodConsistency(p: Record<string, any>) {
  if (p.periodStart && p.periodEnd && p.periodEnd < p.periodStart) throw httpError(400, 'INVALID_FIELD', 'periodEnd must be on or after periodStart.')
  if (p.storageType === 'OTHER' && !p.storageTypeLabel) throw httpError(400, 'INVALID_FIELD', 'storageTypeLabel is required when storageType is OTHER.')
  if (p.capacityUnit === 'OTHER' && !p.capacityUnitLabel) throw httpError(400, 'INVALID_FIELD', 'capacityUnitLabel is required when capacityUnit is OTHER.')
}

function periodIdOf(req: Req): number {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'INVALID_PERIOD_ID', 'Invalid capacity period id.')
  return id
}

async function getCapacity(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    return res.json(await getDeps().capacityHealth.getCapacity(mk))
  } catch (err) {
    return sendError(res, err, 'capacity')
  }
}

async function listCapacityPeriods(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const { chStore } = getDeps()
    const [periods, events] = await Promise.all([chStore.listCapacityPeriods(mk), chStore.listCapacityEvents(mk)])
    return res.json({ periods, events })
  } catch (err) {
    return sendError(res, err, 'capacity periods')
  }
}

async function createCapacityPeriod(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const input = capacityPeriodInput(req.body, false)
    checkPeriodConsistency(input)
    const period = await getDeps().capacityHealth.createCapacityPeriod(mk, input, actorOf(req))
    return res.status(201).json({ period })
  } catch (err) {
    return sendError(res, err, 'capacity period create')
  }
}

async function reviseCapacityPeriod(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = periodIdOf(req)
    const patch = capacityPeriodInput(req.body, true)
    if (!Object.keys(patch).length) throw httpError(400, 'NOTHING_TO_UPDATE', 'Send at least one capacity field to revise.')
    const existing = await getDeps().chStore.getCapacityPeriod(mk, id)
    if (!existing) throw httpError(404, 'PERIOD_NOT_FOUND', 'Capacity period not found.')
    checkPeriodConsistency({ ...existing, ...patch })
    const result = await getDeps().capacityHealth.reviseCapacityPeriod(mk, id, patch, actorOf(req))
    if (result.error === 'NOT_FOUND') throw httpError(404, 'PERIOD_NOT_FOUND', 'Capacity period not found.')
    if (result.error === 'SUPERSEDED') throw httpError(409, 'PERIOD_SUPERSEDED', `This period was already revised (current version ${result.supersededById}). Revise the current version.`)
    if (result.error === 'NO_CHANGES') throw httpError(400, 'NO_CHANGES', 'Nothing changed.')
    return res.json(result)
  } catch (err) {
    return sendError(res, err, 'capacity period revise')
  }
}

async function verifyCapacityPeriod(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const id = periodIdOf(req)
    const period = await getDeps().capacityHealth.verifyCapacityPeriod(mk, id, actorOf(req))
    if (!period) throw httpError(404, 'PERIOD_NOT_FOUND', 'Capacity period not found or already superseded.')
    return res.json({ period })
  } catch (err) {
    return sendError(res, err, 'capacity period verify')
  }
}

async function getInventoryHealth(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const filter = String(req.query.filter || 'active').toLowerCase()
    if (!HEALTH_FILTERS.includes(filter)) throw httpError(400, 'INVALID_FILTER', `filter must be one of: ${HEALTH_FILTERS.join(', ')}.`)
    const healthStatus = req.query.healthStatus ? String(req.query.healthStatus).toUpperCase() : undefined
    if (healthStatus && !HEALTH_STATUSES.includes(healthStatus)) throw httpError(400, 'INVALID_FILTER', 'Unknown health status.')
    return res.json(
      await getDeps().capacityHealth.getInventoryHealth(mk, {
        filter,
        healthStatus,
        search: req.query.search ? String(req.query.search).slice(0, 100) : undefined,
        limit: Number(req.query.limit) || undefined,
      })
    )
  } catch (err) {
    return sendError(res, err, 'inventory health')
  }
}

async function getInactiveWithStock(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    return res.json(await getDeps().capacityHealth.getInactiveWithStock(mk))
  } catch (err) {
    return sendError(res, err, 'inactive listings with stock')
  }
}

async function getRemovalOrders(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const status = String(req.query.status || 'ALL').toUpperCase()
    if (!REMOVAL_STATUS_FILTERS.includes(status)) throw httpError(400, 'INVALID_FILTER', `status must be one of: ${REMOVAL_STATUS_FILTERS.join(', ')}.`)
    return res.json(await getDeps().capacityHealth.getRemovalOrders(mk, status === 'ALL' ? null : status))
  } catch (err) {
    return sendError(res, err, 'removal orders')
  }
}

async function getCapacityRelease(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    return res.json(await getDeps().capacityHealth.getCapacityRelease(mk))
  } catch (err) {
    return sendError(res, err, 'capacity release')
  }
}

async function getActions(req: Req, res: Res) {
  try {
    const mk = marketplaceOf(req)
    const status = String(req.query.status || 'OPEN').toUpperCase()
    if (!['OPEN', 'RESOLVED', 'ALL'].includes(status)) throw httpError(400, 'INVALID_FILTER', 'status must be OPEN, RESOLVED or ALL.')
    return res.json(await getDeps().capacityHealth.getActions(mk, status === 'ALL' ? null : status))
  } catch (err) {
    return sendError(res, err, 'actions')
  }
}

module.exports = {
  setDeps,
  MANUAL_JOB_TYPES,
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
  getCapacity,
  listCapacityPeriods,
  createCapacityPeriod,
  reviseCapacityPeriod,
  verifyCapacityPeriod,
  getInventoryHealth,
  getInactiveWithStock,
  getRemovalOrders,
  getCapacityRelease,
  getActions,
}

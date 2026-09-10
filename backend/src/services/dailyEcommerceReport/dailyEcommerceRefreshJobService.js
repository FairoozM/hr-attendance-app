'use strict'

/**
 * Background refresh for the Daily Ecommerce Report (CloudFront-safe — returns immediately).
 *
 * A full refresh pulls every marketplace's own integration for one UAE day. Noon publishes orders
 * and finance only as export jobs that have to be created and then polled, which alone takes
 * upwards of a minute, and the two Amazon marketplaces are re-synced page by page. That is far
 * longer than the 30s CloudFront origin-response timeout in front of this API, so the request
 * cannot wait for the work: it starts a job, returns the id, and the page polls for the result.
 *
 * Providers are settled independently, so one failing marketplace never blocks the others.
 *
 * - Amazon UAE/KSA: SP-API orders sync, every NextToken page, items included
 * - Noon: OMS orders export plus the finance item-level transaction report, via the Partner API
 * - Life Smile: read-only live query against the website database, so only read access is probed
 */

const crypto = require('crypto')
const { dubaiDayBounds } = require('./dateBounds')
const { buildDailyEcommerceReport } = require('./dailyEcommerceReportService')

/** How far past the report date a Noon settlement statement is still worth asking for. */
const FINANCE_LOOKAHEAD_DAYS = 45

/** Finished jobs stay readable long enough for a slow poller to collect the report. */
const JOB_RETENTION_MS = 15 * 60 * 1000

/** @type {Map<string, object>} jobId -> job */
const jobs = new Map()
/** @type {Map<string, string>} report date -> jobId, so a second click joins the running job */
const activeJobByDate = new Map()

function newJobId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    date: job.date,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    sync: job.sync,
    report: job.report,
    alreadyRunning: job.alreadyRunning === true,
  }
}

function isOpen(job) {
  return Boolean(job) && (job.status === 'queued' || job.status === 'running')
}

function pruneFinishedJobs(now = Date.now()) {
  for (const [jobId, job] of jobs) {
    if (isOpen(job)) continue
    const finished = job.completedAt ? Date.parse(job.completedAt) : 0
    if (finished && now - finished > JOB_RETENTION_MS) jobs.delete(jobId)
  }
}

function getRefreshJob(jobId) {
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

/** The job currently refreshing `date`, if any. Used to make a second Refresh click idempotent. */
function getActiveRefreshJob(date) {
  const key = String(date || '').trim()
  const jobId = activeJobByDate.get(key)
  if (!jobId) return null
  const job = jobs.get(jobId)
  if (!isOpen(job)) {
    activeJobByDate.delete(key)
    return null
  }
  return serializeJob(job)
}

/**
 * Amazon withholds OrderTotal while an order is Pending, so an explicit Refresh has to re-read the
 * day even if a sync ran minutes ago — the cached amount for a fresh order only becomes correct
 * once Amazon authorises it and we ask again.
 */
async function syncAmazonMarketplace(marketplaceKey, bounds) {
  const { syncAmazonOrders } = require('../amazonOrdersSyncService')
  const createdBefore = new Date(
    Math.max(bounds.start.getTime() + 1000, bounds.end.getTime() - 1),
  )
  const result = await syncAmazonOrders({
    marketplaceKey,
    createdAfter: bounds.start,
    createdBefore,
    includeItems: true,
    force: true,
    forceAllowed: true,
  })
  return {
    status: result?.skipped ? 'skipped' : 'ok',
    ordersFetched: result?.ordersFetched ?? null,
    ordersSaved: result?.ordersSaved ?? null,
    orderItemsFetched: result?.orderItemsFetched ?? null,
    pagesFetched: result?.pagesFetched ?? null,
    truncated: result?.truncated ?? null,
    message: result?.message,
  }
}

async function syncNoonOrdersForDay(bounds) {
  const { syncNoonOrders } = require('../noon/noonOrdersExportService')
  // Noon filters the export by order date in its own calendar, so ask for the day before as well
  // and let `order_placed_at` decide inclusion precisely.
  const dayBefore = new Date(bounds.start.getTime() - 24 * 60 * 60 * 1000)
  const result = await syncNoonOrders({
    fromYmd: dayBefore.toISOString().slice(0, 10),
    toYmd: bounds.dateYmd,
  })
  return {
    status: 'ok',
    exportCategoryCode: result.exportCategoryCode,
    exportCode: result.exportCode,
    pollCount: result.pollCount,
    rowsParsed: result.rowsParsed,
    rowsSaved: result.rowsSaved,
    uniqueOrders: result.uniqueOrders,
    linesByCountry: result.linesByCountry,
  }
}

async function syncNoonFinanceForDay(bounds) {
  const { syncNoonFinance } = require('../noon/noonOrdersExportService')
  // Noon publishes an order's proceeds and fees only when the order reaches a settlement statement,
  // days later, and the finance export is filtered by that statement date. So ask for every
  // statement from the report date up to today (capped) and let the order number decide which
  // order each row belongs to.
  const windowEndMs = Math.min(
    Date.now(),
    bounds.start.getTime() + FINANCE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  )
  const result = await syncNoonFinance({
    fromYmd: bounds.dateYmd,
    toYmd: new Date(Math.max(bounds.start.getTime(), windowEndMs)).toISOString().slice(0, 10),
  })
  return {
    status: 'ok',
    exportCategoryCode: result.exportCategoryCode,
    exportCode: result.exportCode,
    fromDate: result.fromDate,
    toDate: result.toDate,
    pollCount: result.pollCount,
    rowsParsed: result.rowsParsed,
    rowsSaved: result.rowsSaved,
    ordersWithMoney: result.ordersWithMoney,
  }
}

/**
 * Life Smile is read live, so there is nothing to sync — but reaching the database is not the same
 * as being allowed to read orders. The report role is granted table by table, so probe the two
 * tables the report needs and report the real PostgreSQL error (42501 = permission denied) instead
 * of a generic failure.
 */
async function probeLifeSmileAccess(bounds) {
  const websiteDb = require('../../db/lifesmileWebsiteDb')
  if (!websiteDb.isConfigured()) {
    return { status: 'not_configured', message: `${websiteDb.ENV_VAR} is unset` }
  }
  const health = await websiteDb.checkHealth()
  if (!health.reachable) {
    return { status: 'error', ...health }
  }
  try {
    const probe = await websiteDb.readQuery(
      `SELECT (SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2) AS orders,
              (SELECT COUNT(*) FROM cart_items WHERE created_at >= $1 AND created_at < $2) AS cart_items`,
      [bounds.start, bounds.end],
    )
    return {
      status: 'ok',
      ...health,
      ordersReadable: true,
      ordersInWindow: Number(probe.rows[0]?.orders ?? 0),
      cartItemsInWindow: Number(probe.rows[0]?.cart_items ?? 0),
    }
  } catch (err) {
    const message = [err.pgCode ? `SQLSTATE ${err.pgCode}` : null, err.message]
      .filter(Boolean)
      .join(': ')
    return { status: 'error', ...health, ordersReadable: false, message }
  }
}

function errorEntry(err) {
  return {
    status: err && err.code === 'NOON_NOT_CONFIGURED' ? 'not_configured' : 'error',
    code: err && err.code ? err.code : undefined,
    message: err && err.message ? err.message : String(err),
  }
}

/**
 * Runs every integration for one day. Each task records its own outcome under `sync`, and a
 * rejection is captured rather than thrown so a failing marketplace cannot cancel the others.
 */
async function runRefresh(job, { skipAmazon = false, skipNoon = false } = {}) {
  const bounds = dubaiDayBounds(job.date)
  const sync = job.sync

  const tasks = []
  const track = (key, label, run) => {
    sync[key] = { status: 'running' }
    tasks.push(
      run()
        .then((value) => {
          sync[key] = value
        })
        .catch((err) => {
          sync[key] = errorEntry(err)
          console.error(`[dailyEcommerceReport] refresh ${label} failed:`, err)
        })
        .finally(() => {
          job.progress = { ...job.progress, completedSteps: (job.progress.completedSteps || 0) + 1 }
        }),
    )
  }

  if (skipAmazon) {
    sync.amazon_uae = { status: 'skipped', message: 'sync_amazon=0' }
    sync.amazon_ksa = { status: 'skipped', message: 'sync_amazon=0' }
  } else {
    for (const mk of ['uae', 'ksa']) {
      track(`amazon_${mk}`, `Amazon ${mk.toUpperCase()}`, () => syncAmazonMarketplace(mk, bounds))
    }
  }

  if (skipNoon) {
    sync.noon = { status: 'skipped', message: 'sync_noon=0' }
    sync.noon_finance = { status: 'skipped', message: 'sync_noon=0' }
  } else {
    track('noon', 'Noon orders export', () => syncNoonOrdersForDay(bounds))
    track('noon_finance', 'Noon finance export', () => syncNoonFinanceForDay(bounds))
  }

  track('life_smile', 'Life Smile website read access', () => probeLifeSmileAccess(bounds))

  job.progress = {
    step: 'Pulling Amazon, Noon and Life Smile for the selected day…',
    totalSteps: tasks.length,
    completedSteps: 0,
  }

  await Promise.all(tasks)

  job.progress = { ...job.progress, step: 'Rebuilding the report from the refreshed data…' }
  job.report = await buildDailyEcommerceReport({ date: job.date, includeLiveAds: true })
}

/**
 * Starts a refresh for one UAE day and returns straight away. A refresh already running for the
 * same date is returned instead of starting a second one.
 */
function startRefreshJob({ date, skipAmazon = false, skipNoon = false } = {}) {
  const key = String(date || '').trim()
  const running = getActiveRefreshJob(key)
  if (running) return { ...running, alreadyRunning: true }

  pruneFinishedJobs()

  const job = {
    jobId: newJobId(),
    date: key,
    status: 'queued',
    progress: { step: 'Queued…', totalSteps: null, completedSteps: 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    sync: {},
    report: null,
  }
  jobs.set(job.jobId, job)
  activeJobByDate.set(key, job.jobId)

  setImmediate(async () => {
    job.status = 'running'
    try {
      await runRefresh(job, { skipAmazon, skipNoon })
      job.status = 'completed'
      job.progress = { ...job.progress, step: 'Refresh complete' }
    } catch (err) {
      job.status = 'failed'
      job.error = err && err.message ? err.message : String(err)
      job.progress = { ...job.progress, step: 'Refresh failed' }
      console.error('[dailyEcommerceReport] background refresh failed:', err)
    } finally {
      job.completedAt = new Date().toISOString()
      if (activeJobByDate.get(key) === job.jobId) activeJobByDate.delete(key)
    }
  })

  return serializeJob(job)
}

module.exports = {
  startRefreshJob,
  getRefreshJob,
  getActiveRefreshJob,
  FINANCE_LOOKAHEAD_DAYS,
  JOB_RETENTION_MS,
  // exported for tests
  runRefresh,
}

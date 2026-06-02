const crypto = require('crypto')
const comparisonService = require('./amazonZohoStockComparisonService')
const jobStore = require('./amazonZohoStockRefreshJobStore')

let tablesReady = false

async function ensureTables() {
  if (tablesReady) return
  await jobStore.ensureAmazonZohoStockRefreshJobTable()
  tablesReady = true
}

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    totalRows: job.totalRows,
  }
}

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Refresh failed'
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]').slice(0, 800)
}

async function startAmazonZohoStockRefresh(options = {}) {
  await ensureTables()
  await jobStore.markStaleJobsFailed()

  const marketplace = String(options.marketplace || 'all').trim().toLowerCase()
  const running = await jobStore.findRunningJob(marketplace)
  if (running) return serializeJob(running)

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  await jobStore.insertJob({ jobId, marketplace })

  setImmediate(async () => {
    await jobStore.updateJob(jobId, {
      status: 'running',
      progress: { step: 'Starting refresh', current: 0, total: 0 },
    })
    try {
      const result = await comparisonService.refreshAmazonZohoStockComparison({
        marketplace,
        progress: (progress) => {
          void jobStore.updateJob(jobId, {
            status: 'running',
            progress: {
              step: progress.step || 'Running',
              current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : 0,
              total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
            },
          })
        },
        onMarketplaceComplete: async ({ marketplaceKey, rowsInserted, zohoMatchStats }) => {
          await jobStore.updateJob(jobId, {
            status: 'running',
            progress: {
              step: `Saved ${marketplaceKey.toUpperCase()} cache (${rowsInserted} rows)`,
              current: rowsInserted,
              total: rowsInserted,
            },
            metadata: { lastMarketplaceSaved: marketplaceKey, zohoMatchStats },
          })
        },
      })
      await jobStore.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        totalRows: result.totalRows,
        progress: {
          step: `Completed ${result.totalRows} comparison rows`,
          current: result.totalRows,
          total: result.totalRows,
        },
        metadata: { zohoMeta: result.zohoMeta },
      })
    } catch (e) {
      await jobStore.updateJob(jobId, {
        status: 'failed',
        error: safeError(e),
        completedAt: new Date().toISOString(),
      })
      console.error('[amazon-zoho-stock-refresh]', e?.message || e)
    }
  })

  return serializeJob(await jobStore.getJob(jobId))
}

async function getAmazonZohoStockRefreshJob(jobId) {
  await ensureTables()
  return serializeJob(await jobStore.getJob(jobId))
}

async function isRefreshRunning(marketplace = 'all') {
  await ensureTables()
  await jobStore.markStaleJobsFailed()
  const job = await jobStore.findRunningJob(marketplace)
  return Boolean(job)
}

module.exports = {
  startAmazonZohoStockRefresh,
  getAmazonZohoStockRefreshJob,
  isRefreshRunning,
}

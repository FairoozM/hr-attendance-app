const inventoryHealthImageService = require('../services/inventoryHealthImageService')
const imageSyncJobService = require('../services/inventoryHealthImageSyncJobService')
const { isSyncPaused } = require('../services/zohoApiClient')

function parseBool(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue
  return value === true || value === 'true' || value === '1'
}

function parseLimit(value, defaultValue = 50) {
  const n = parseInt(String(value ?? defaultValue), 10)
  if (!Number.isFinite(n)) return defaultValue
  return Math.max(1, Math.min(n, 500))
}

async function getImageSyncJob(req, res) {
  try {
    const jobId = cleanStr(req.params.jobId)
    const job = jobId
      ? imageSyncJobService.getImageSyncJob(jobId)
      : imageSyncJobService.getActiveImageSyncJob()
    if (!job) {
      return res.status(404).json({ error: 'Sync job not found', code: 'SYNC_JOB_NOT_FOUND' })
    }
    return res.json(job)
  } catch (err) {
    console.error('[inventory-health-images] sync job status failed:', err?.message || err)
    return res.status(500).json({
      error: 'Failed to load image sync job status',
      code: 'INVENTORY_HEALTH_IMAGE_SYNC_JOB_ERROR',
    })
  }
}

async function getActiveImageSyncJob(req, res) {
  try {
    const job = imageSyncJobService.getActiveImageSyncJob()
    return res.json({ job })
  } catch (err) {
    console.error('[inventory-health-images] active sync job failed:', err?.message || err)
    return res.status(500).json({
      error: 'Failed to load active image sync job',
      code: 'INVENTORY_HEALTH_IMAGE_SYNC_ACTIVE_ERROR',
    })
  }
}

async function postImageSync(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const q = req.query || {}
    const force = parseBool(body.force ?? q.force, false)
    const dryRun = parseBool(body.dryRun ?? q.dryRun, false)
    const all = parseBool(body.all ?? q.all, false)
    const asyncMode = parseBool(body.async ?? q.async, true)
    const limit = parseLimit(body.limit ?? q.limit, 20)
    const concurrency = Math.max(1, Math.min(parseInt(String(body.concurrency ?? q.concurrency ?? '1'), 10) || 1, 2))

    if (isSyncPaused()) {
      return res.status(429).json({
        error: 'Zoho API is paused after rate limiting (~15 min). Wait before syncing images.',
        code: 'ZOHO_SYNC_PAUSED',
      })
    }

    if (asyncMode) {
      const job = imageSyncJobService.startImageSyncJob({
        force,
        dryRun,
        all,
        limit,
        concurrency,
      })
      const status = job?.alreadyRunning ? 200 : 202
      return res.status(status).json(job)
    }

    const result = await inventoryHealthImageService.syncMissingInventoryImages({
      force,
      dryRun,
      all,
      limit,
      concurrency,
    })
    return res.json(result)
  } catch (err) {
    console.error('[inventory-health-images] sync failed:', err?.message || err)
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    return res.status(500).json({
      error: 'Failed to sync inventory item images',
      code: 'INVENTORY_HEALTH_IMAGE_SYNC_ERROR',
    })
  }
}

async function getImageStatus(req, res) {
  try {
    const status = await inventoryHealthImageService.getInventoryImageCacheStatus()
    return res.json(status)
  } catch (err) {
    console.error('[inventory-health-images] status failed:', err?.message || err)
    return res.status(500).json({
      error: 'Failed to load inventory image cache status',
      code: 'INVENTORY_HEALTH_IMAGE_STATUS_ERROR',
    })
  }
}

async function postImageSyncOne(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const force = parseBool(body.force, false)
    const result = await inventoryHealthImageService.syncOneInventoryImage({
      itemId: body.itemId,
      sku: body.sku,
      force,
    })
    return res.json(result)
  } catch (err) {
    console.error('[inventory-health-images] sync-one failed:', err?.message || err)
    if (err && err.code === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code: err.code })
    }
    if (err && err.code === 'INVALID_SYNC_ONE') {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    return res.status(500).json({
      error: 'Failed to sync inventory item image',
      code: 'INVENTORY_HEALTH_IMAGE_SYNC_ONE_ERROR',
    })
  }
}

async function getImageDebugOne(req, res) {
  try {
    const sku = cleanStr(req.query?.sku)
    const itemId = cleanStr(req.query?.itemId)
    const result = await inventoryHealthImageService.debugOneInventoryImage({ sku, itemId })
    return res.json(result)
  } catch (err) {
    console.error('[inventory-health-images] debug-one failed:', err?.message || err)
    if (err && err.code === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code: err.code })
    }
    if (err && err.code === 'INVALID_DEBUG_ONE') {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    if (err && err.code === 'ZOHO_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Zoho is not configured.', code: 'ZOHO_NOT_CONFIGURED' })
    }
    return res.status(500).json({
      error: 'Failed to debug inventory item image',
      code: 'INVENTORY_HEALTH_IMAGE_DEBUG_ONE_ERROR',
    })
  }
}

function cleanStr(v) {
  return String(v == null ? '' : v).trim()
}

module.exports = {
  postImageSync,
  getImageStatus,
  postImageSyncOne,
  getImageDebugOne,
  getImageSyncJob,
  getActiveImageSyncJob,
}

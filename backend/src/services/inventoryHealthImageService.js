/**
 * Sync Zoho inventory item images into persistent cache for inventory health dashboard.
 * Separate from main inventory health calculation — call via admin sync endpoints only.
 */

const { fetchAllItemsRaw } = require('../integrations/zoho/zohoAdapter')
const {
  fetchZohoItemImageBuffer,
  fetchItemById,
} = require('../integrations/zoho/zohoInventoryClient')
const inventoryItemImageStore = require('./inventoryItemImageStore')
const inventoryItemImageStorage = require('./inventoryItemImageStorage')
const { isSyncPaused } = require('./zohoApiClient')
const { readZohoConfig, INVENTORY_V1 } = require('../integrations/zoho/zohoConfig')

function isActiveZohoItem(item) {
  if (!item || typeof item !== 'object') return false
  const st = String(item.status || '').trim().toLowerCase()
  return !st || st === 'active'
}

function cleanStr(v) {
  return String(v == null ? '' : v).trim()
}

function pickItemId(item) {
  return cleanStr(item && (item.item_id || item.id))
}

function pickSku(item) {
  return cleanStr(item && (item.sku || item.item_code || item.code))
}

function pickItemName(item) {
  return cleanStr(item && (item.name || item.item_name || item.description))
}

function extractImageReference(item) {
  if (!item || typeof item !== 'object') return null
  const candidates = [
    item.image_url,
    item.imageUrl,
    item.image,
    item.item_image_url,
    item.itemImageUrl,
    item.photo_url,
    item.thumbnail_url,
    item.image_document_id,
    item.image_id,
    item.image_name,
  ]
  for (const value of candidates) {
    const v = cleanStr(value)
    if (v) return v
  }
  if (Array.isArray(item.documents)) {
    const doc = item.documents.find((d) => d && /image/i.test(String(d.type || d.file_type || d.name || '')))
    const v = doc && cleanStr(doc.url || doc.document_url || doc.document_id || doc.name)
    if (v) return v
  }
  return null
}

function imageRelatedKeys(item) {
  if (!item || typeof item !== 'object') return []
  return Object.keys(item).filter((k) => /image|photo|document|attachment|file/i.test(k))
}

function pickImageFields(item) {
  const out = {}
  for (const k of imageRelatedKeys(item)) {
    const v = item[k]
    if (v == null || v === '') continue
    if (typeof v === 'object') {
      out[k] = Array.isArray(v) ? v.slice(0, 3) : v
    } else {
      out[k] = v
    }
  }
  return out
}

function findActiveItem(rawItems, { itemId, sku, name } = {}) {
  const id = cleanStr(itemId)
  const skuKey = cleanStr(sku).toLowerCase()
  const nameKey = cleanStr(name).toLowerCase()
  for (const row of rawItems || []) {
    if (!isActiveZohoItem(row)) continue
    if (id && pickItemId(row) === id) return row
    if (skuKey && pickSku(row).toLowerCase() === skuKey) return row
    if (nameKey && pickItemName(row).toLowerCase() === nameKey) return row
  }
  return null
}

function logListItemImageSample(activeItems, limit = 5) {
  for (const item of (activeItems || []).slice(0, limit)) {
    console.log(
      '[inventory-health-images] list-item sample',
      JSON.stringify({
        item_id: pickItemId(item),
        sku: pickSku(item),
        name: pickItemName(item),
        imageRelatedKeys: imageRelatedKeys(item),
        imageFields: pickImageFields(item),
      }),
    )
  }
}

function formatMissingReason(resolved) {
  const raw = cleanStr(resolved?.missingReason)
  if (!raw) return 'unknown'
  if (raw === 'no_list_image_metadata') return 'No image metadata in Zoho list-items'
  if (raw === 'no_image_metadata') return 'No image fields in Zoho item/detail'
  if (raw === 'zoho_image_not_found') return 'Zoho image download returned 404'
  if (raw.startsWith('image_fetch_error:')) {
    const status = resolved?.status
    if (status === 403) return 'Zoho image download returned 403'
    if (status === 404) return 'Zoho image download returned 404'
    return raw.replace(/^image_fetch_error:/, 'Zoho image download failed: ')
  }
  if (raw.startsWith('item_detail_error:')) {
    return `Zoho item detail failed: ${raw.replace(/^item_detail_error:/, '')}`
  }
  return raw
}

function failureStageFromResolved(resolved) {
  return resolved?.stage || formatMissingReason(resolved)
}

function isRateLimitFailure(resolved, err) {
  const msg = `${resolved?.missingReason || ''} ${err?.message || ''} ${err?.code || ''}`
  return /429|rate limit|sync paused|ZOHO_SYNC_PAUSED|ZOHO_HTTP_429|ZOHO_RATE_MINUTE/i.test(msg)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isEffectivelyCached(cached) {
  if (!cached?.imageUrl) return false
  if (!inventoryItemImageStorage.isPermanentCachedImageUrl(cached.imageUrl)) return false
  return inventoryItemImageStorage.fileExistsForPublicUrl(cached.imageUrl)
}

async function resolveImageForItem(item, { allowDetail = false, forceReplace = false } = {}) {
  const itemId = pickItemId(item)
  const sku = pickSku(item)
  const itemName = pickItemName(item)
  const base = { itemId, sku, itemName }

  if (!itemId) {
    return {
      ...base,
      imageUrl: null,
      imageSource: 'none',
      missingReason: 'missing_item_id',
      stage: 'missing_item_id',
    }
  }

  let sourceItem = item
  let imageSource = 'zoho_list_metadata'
  let ref = extractImageReference(sourceItem)

  if (!ref && allowDetail) {
    try {
      sourceItem = await fetchItemById(itemId, { source: 'inventory_health_image_sync' })
      ref = extractImageReference(sourceItem)
      if (ref) imageSource = 'zoho_item_detail'
    } catch (err) {
      return {
        ...base,
        imageUrl: null,
        imageSource: 'zoho_item_detail',
        missingReason: `item_detail_error:${err?.message || 'unknown'}`,
        stage: 'detail_fetch',
        status: err?.httpStatus || null,
      }
    }
  }

  if (!ref) {
    return {
      ...base,
      imageUrl: null,
      imageSource: imageSource === 'zoho_item_detail' ? 'zoho_item_detail' : 'none',
      missingReason: allowDetail ? 'no_image_metadata' : 'no_list_image_metadata',
      stage: allowDetail ? 'no_image_metadata' : 'no_list_metadata',
    }
  }

  try {
    const image = await fetchZohoItemImageBuffer(itemId)
    if (!image || !image.buffer) {
      return {
        ...base,
        imageUrl: null,
        imageSource,
        missingReason: 'zoho_image_not_found',
        stage: 'zoho_download',
        status: 404,
      }
    }

    if (forceReplace) {
      await inventoryItemImageStorage.deleteInventoryItemImageFiles(itemId)
    }

    const stored = await inventoryItemImageStorage.saveInventoryItemImage(itemId, image.buffer, image.contentType)
    return {
      ...base,
      imageUrl: stored.imageUrl,
      imageSource: 'zoho_downloaded_cached',
      contentType: stored.contentType,
      fileSize: stored.fileSize,
      missingReason: null,
      stage: 'saved',
      status: 200,
    }
  } catch (err) {
    const status = err?.httpStatus || null
    return {
      ...base,
      imageUrl: null,
      imageSource,
      missingReason: `image_fetch_error:${err?.message || 'unknown'}`,
      stage: 'zoho_download',
      status,
      contentType: null,
    }
  }
}

async function mapPool(items, concurrency, fn, { staggerMs = 0 } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return []
  const maxWorkers = Math.max(1, Math.min(concurrency, list.length))
  const out = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const i = next
      next += 1
      if (staggerMs > 0 && i > 0) {
        await sleep(staggerMs)
      }
      out[i] = await fn(list[i], i)
    }
  }
  await Promise.all(Array.from({ length: maxWorkers }, () => worker()))
  return out
}

function emptySyncAggregate() {
  return {
    success: true,
    mode: 'missing_only',
    dryRun: false,
    scannedItems: 0,
    alreadyCached: 0,
    missingBeforeSync: 0,
    attempted: 0,
    downloaded: 0,
    saved: 0,
    failed: 0,
    stillMissing: 0,
    skippedDueToLimit: 0,
    batchesRun: 0,
    errors: [],
    sampleSuccess: [],
    sampleFailures: [],
    timingsMs: { items: 0, cacheLookup: 0, imageFetch: 0, save: 0, total: 0 },
  }
}

function mergeSyncBatch(into, batch) {
  into.scannedItems = batch.scannedItems
  into.alreadyCached = batch.alreadyCached
  into.missingBeforeSync = batch.skippedDueToLimit
  into.attempted += batch.attempted
  into.downloaded += batch.downloaded
  into.saved += batch.saved
  into.failed += batch.failed
  into.stillMissing += batch.stillMissing
  into.skippedDueToLimit = batch.skippedDueToLimit
  into.timingsMs.items += batch.timingsMs.items
  into.timingsMs.cacheLookup += batch.timingsMs.cacheLookup
  into.timingsMs.imageFetch += batch.timingsMs.imageFetch
  into.timingsMs.save += batch.timingsMs.save
  into.timingsMs.total += batch.timingsMs.total
  for (const row of batch.errors || []) {
    if (into.errors.length < 100) into.errors.push(row)
  }
  for (const row of batch.sampleSuccess || []) {
    if (into.sampleSuccess.length < 5) into.sampleSuccess.push(row)
  }
  for (const row of batch.sampleFailures || []) {
    if (into.sampleFailures.length < 10) into.sampleFailures.push(row)
  }
}

async function processSyncItem(item, { force, dryRun }) {
  const itemId = pickItemId(item)
  const sku = pickSku(item)
  try {
    const listRef = extractImageReference(item)
    const resolved = await resolveImageForItem(item, { allowDetail: !listRef, forceReplace: force })
    if (resolved.imageUrl) {
      if (!dryRun) {
        await inventoryItemImageStore.upsertInventoryItemImage(resolved, { forceReplaceImage: force })
      }
      return {
        ok: true,
        itemId,
        sku,
        resolved,
        successSample: {
          sku,
          itemId,
          imageUrl: resolved.imageUrl,
          contentType: resolved.contentType || null,
          fileSize: resolved.fileSize || null,
        },
      }
    }
    const reason = formatMissingReason(resolved)
    const errRow = {
      itemId,
      sku,
      stage: failureStageFromResolved(resolved),
      reason,
      status: resolved.status ?? null,
      contentType: resolved.contentType ?? null,
      rateLimited: isRateLimitFailure(resolved),
    }
    if (!dryRun && !errRow.rateLimited) {
      await inventoryItemImageStore.upsertInventoryItemImage(resolved, { forceReplaceImage: force })
    }
    return { ok: false, itemId, sku, errRow, rateLimited: errRow.rateLimited }
  } catch (err) {
    const rateLimited = isRateLimitFailure(null, err)
    return {
      ok: false,
      itemId,
      sku,
      rateLimited,
      errRow: {
        itemId,
        sku,
        stage: 'unexpected',
        reason: err?.message || String(err),
        status: err?.httpStatus ?? null,
        contentType: null,
        rateLimited,
      },
    }
  }
}

async function syncMissingInventoryImagesBatch(options = {}) {
  const force = options.force === true || options.force === 'true' || options.force === '1'
  const dryRun = options.dryRun === true || options.dryRun === 'true' || options.dryRun === '1'
  const limit = Math.max(1, Math.min(parseInt(String(options.limit || '20'), 10) || 20, 50))
  const concurrency = Math.max(1, Math.min(parseInt(String(options.concurrency || '1'), 10) || 1, 2))
  const staggerMs = Math.max(0, parseInt(String(options.staggerMs || '800'), 10) || 800)
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const progressOffset = options.progressOffset || { saved: 0, failed: 0, attempted: 0 }

  const timingsMs = { items: 0, cacheLookup: 0, imageFetch: 0, save: 0, total: 0 }
  const errors = []
  const sampleSuccess = []
  const sampleFailures = []
  const tTotal = Date.now()

  let scannedItems = 0
  let alreadyCached = 0
  let missingBeforeSync = 0
  let attempted = 0
  let downloaded = 0
  let saved = 0
  let failed = 0
  let stillMissing = 0
  let skippedDueToLimit = 0

  try {
    inventoryItemImageStorage.ensureUploadDir()

    if (isSyncPaused()) {
      return {
        success: false,
        rateLimitPaused: true,
        mode: force ? 'force_refetch' : 'missing_only',
        dryRun,
        scannedItems: 0,
        alreadyCached: 0,
        missingBeforeSync: 0,
        attempted: 0,
        downloaded: 0,
        saved: 0,
        failed: 0,
        stillMissing: 0,
        skippedDueToLimit: 0,
        errors: [
          {
            stage: 'rate_limit',
            reason: 'Zoho rate limited (HTTP 429). Wait ~15 minutes, then sync again.',
          },
        ],
        sampleSuccess: [],
        sampleFailures: [],
        concurrency,
        timingsMs: { items: 0, cacheLookup: 0, imageFetch: 0, save: 0, total: Date.now() - tTotal },
      }
    }

    const tItems = Date.now()
    const rawItems = await fetchAllItemsRaw()
    const activeItems = (rawItems || []).filter(isActiveZohoItem)
    scannedItems = activeItems.length
    timingsMs.items = Date.now() - tItems
    logListItemImageSample(activeItems, 5)

    const tCache = Date.now()
    const cacheByItemId = await inventoryItemImageStore.getAllCachedByItemId()
    timingsMs.cacheLookup = Date.now() - tCache

    const candidates = []
    for (const item of activeItems) {
      const itemId = pickItemId(item)
      if (!itemId) continue
      const cached = cacheByItemId.get(itemId)
      if (!force && isEffectivelyCached(cached)) {
        alreadyCached += 1
        continue
      }
      candidates.push(item)
    }

    missingBeforeSync = candidates.length
    const batch = candidates.slice(0, limit)
    skippedDueToLimit = Math.max(0, candidates.length - batch.length)

    const tFetch = Date.now()
    let batchSaved = 0
    let batchFailed = 0
    let batchDone = 0
    let haltBatch = false
    const outcomes = await mapPool(
      batch,
      concurrency,
      async (item) => {
        if (haltBatch) {
          return { ok: false, skipped: true, itemId: pickItemId(item), sku: pickSku(item) }
        }
        const outcome = await processSyncItem(item, { force, dryRun })
        if (outcome.rateLimited) {
          haltBatch = true
        }
        return outcome
      },
      { staggerMs },
    )
    for (const outcome of outcomes) {
      if (outcome.skipped) continue
      attempted += 1
      if (outcome.ok) {
        downloaded += 1
        saved += 1
        batchSaved += 1
        if (sampleSuccess.length < 5 && outcome.successSample) {
          sampleSuccess.push(outcome.successSample)
        }
      } else {
        stillMissing += 1
        if (outcome.errRow) {
          failed += 1
          batchFailed += 1
          errors.push(outcome.errRow)
          if (sampleFailures.length < 10) {
            sampleFailures.push(outcome.errRow)
          }
        }
      }
      batchDone += 1
      if (onProgress && (batchDone % 4 === 0 || batchDone === batch.length)) {
        onProgress({
          step: haltBatch
            ? 'Zoho rate limited — pausing sync (wait ~15 min, then retry)'
            : 'Downloading images from Zoho…',
          saved: progressOffset.saved + batchSaved,
          failed: progressOffset.failed + batchFailed,
          attempted: progressOffset.attempted + batchDone,
          remaining: skippedDueToLimit + (batch.length - batchDone),
          alreadyCached,
          scannedItems,
          rateLimitPaused: haltBatch,
        })
      }
    }
    timingsMs.imageFetch = Date.now() - tFetch
    timingsMs.save = dryRun ? 0 : timingsMs.imageFetch
    timingsMs.total = Date.now() - tTotal

    if (force) {
      console.warn('[inventory-health-images] force=true image sync requested by admin')
    }

    return {
      success: true,
      mode: force ? 'force_refetch' : 'missing_only',
      dryRun,
      scannedItems,
      alreadyCached,
      missingBeforeSync,
      attempted,
      downloaded,
      saved,
      failed,
      stillMissing,
      skippedDueToLimit,
      rateLimitPaused: haltBatch,
      errors,
      sampleSuccess,
      sampleFailures,
      concurrency,
      timingsMs,
    }
  } catch (err) {
    timingsMs.total = Date.now() - tTotal
    throw err
  }
}

async function syncMissingInventoryImages(options = {}) {
  const syncAll = options.all === true || options.all === 'true' || options.all === '1'
  if (!syncAll) {
    return syncMissingInventoryImagesBatch(options)
  }

  const maxBatches = Math.max(1, Math.min(parseInt(String(options.maxBatches || '20'), 10) || 20, 50))
  const started = Date.now()
  const maxDurationMs = Math.max(
    60_000,
    Math.min(parseInt(String(options.maxDurationMs || '900000'), 10) || 900_000, 1_800_000),
  )
  const aggregate = emptySyncAggregate()
  aggregate.mode = options.force ? 'force_refetch_all' : 'missing_all'
  aggregate.dryRun = options.dryRun === true || options.dryRun === 'true' || options.dryRun === '1'
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const progressOffset = { saved: 0, failed: 0, attempted: 0 }

  for (let batchNo = 0; batchNo < maxBatches; batchNo += 1) {
    if (Date.now() - started > maxDurationMs) {
      aggregate.timedOut = true
      break
    }
    const batch = await syncMissingInventoryImagesBatch({
      ...options,
      all: false,
      progressOffset,
      onProgress,
    })
    aggregate.batchesRun += 1
    mergeSyncBatch(aggregate, batch)
    progressOffset.saved = aggregate.saved
    progressOffset.failed = aggregate.failed
    progressOffset.attempted = aggregate.attempted
    if (onProgress) {
      onProgress({
        step: `Batch ${batchNo + 1} complete`,
        saved: aggregate.saved,
        failed: aggregate.failed,
        attempted: aggregate.attempted,
        remaining: batch.skippedDueToLimit,
        alreadyCached: aggregate.alreadyCached,
        scannedItems: aggregate.scannedItems,
      })
    }
    console.log(
      `[inventory-health-images] sync-all batch ${batchNo + 1}: saved=${batch.saved} failed=${batch.failed} remaining=${batch.skippedDueToLimit}`,
    )
    if (batch.rateLimitPaused) {
      aggregate.rateLimitPaused = true
      break
    }
    if (batch.skippedDueToLimit === 0) break
    if (batch.attempted === 0) break
  }

  aggregate.timingsMs.total = Date.now() - started
  aggregate.success = true
  aggregate.rateLimitPaused = aggregate.rateLimitPaused || false
  return aggregate
}

async function syncOneInventoryImage({ itemId, sku, force = false } = {}) {
  const id = cleanStr(itemId)
  const skuClean = cleanStr(sku)
  if (!id && !skuClean) {
    const e = new Error('itemId or sku is required')
    e.code = 'INVALID_SYNC_ONE'
    throw e
  }

  const rawItems = await fetchAllItemsRaw()
  let item = findActiveItem(rawItems, { itemId: id, sku: skuClean, name: skuClean })

  if (!item && id) {
    try {
      item = await fetchItemById(id, { source: 'inventory_health_image_sync_one' })
    } catch {
      item = { item_id: id, sku: skuClean }
    }
  }

  if (!item) {
    const e = new Error('Item not found in Zoho')
    e.code = 'ITEM_NOT_FOUND'
    throw e
  }

  const resolvedItemId = pickItemId(item)

  if (force) {
    console.warn(`[inventory-health-images] force sync-one itemId=${resolvedItemId}`)
  } else {
    const cachedMap = await inventoryItemImageStore.getCachedImagesByItemIds([resolvedItemId])
    const cached = cachedMap.get(resolvedItemId)
    if (isEffectivelyCached(cached)) {
      return {
        success: true,
        skipped: true,
        reason: 'already_cached',
        row: cached,
      }
    }
  }

  const listRef = extractImageReference(item)
  const resolved = await resolveImageForItem(item, { allowDetail: !listRef, forceReplace: force })
  await inventoryItemImageStore.upsertInventoryItemImage(resolved, { forceReplaceImage: force })

  return {
    success: true,
    skipped: false,
    row: resolved,
  }
}

async function getInventoryImageCacheStatus(activeItemCount = null) {
  const status = await inventoryItemImageStore.getImageCacheStatus()
  let totalActive = activeItemCount != null && activeItemCount > 0 ? activeItemCount : null
  if (totalActive == null) {
    try {
      const raw = await fetchAllItemsRaw()
      totalActive = (raw || []).filter(isActiveZohoItem).length
    } catch {
      totalActive = status.cachedImages + status.missingImages
    }
  }
  const missingImages = Math.max(0, totalActive - status.cachedImages)
  return {
    ...status,
    totalActiveItems: totalActive,
    missingImages,
    failedCacheRows: status.missingImages,
    cacheCoveragePercent:
      totalActive > 0 ? Math.round((status.cachedImages / totalActive) * 1000) / 10 : status.cacheCoveragePercent,
  }
}

async function debugOneInventoryImage({ sku, itemId } = {}) {
  const lookup = cleanStr(sku || itemId)
  if (!lookup) {
    const e = new Error('sku or itemId query param is required')
    e.code = 'INVALID_DEBUG_ONE'
    throw e
  }

  const rawItems = await fetchAllItemsRaw()
  const activeItems = (rawItems || []).filter(isActiveZohoItem)
  logListItemImageSample(activeItems, 5)

  const listItem = findActiveItem(activeItems, {
    itemId: cleanStr(itemId),
    sku: lookup,
    name: lookup,
  })

  if (!listItem) {
    const e = new Error(`Item not found in Zoho active list-items for lookup: ${lookup}`)
    e.code = 'ITEM_NOT_FOUND'
    throw e
  }

  const resolvedItemId = pickItemId(listItem)
  const resolvedSku = pickSku(listItem)
  const resolvedName = pickItemName(listItem)

  let detail = null
  let detailEndpoint = `${INVENTORY_V1}/items/${resolvedItemId}`
  let detailError = null
  try {
    detail = await fetchItemById(resolvedItemId, { source: 'inventory_health_image_debug', skipCache: true })
  } catch (err) {
    detailError = err?.message || String(err)
  }

  const attemptedDownloadUrls = [
    `${INVENTORY_V1}/items/${resolvedItemId}/image?organization_id=(redacted)`,
  ]

  const downloadResults = []

  try {
    const image = await fetchZohoItemImageBuffer(resolvedItemId)
    downloadResults.push({
      source: 'fetchZohoItemImageBuffer',
      status: image?.buffer ? 200 : 404,
      contentType: image?.contentType || null,
      contentLength: image?.buffer ? image.buffer.length : 0,
      success: !!(image && image.buffer && image.buffer.length),
      error: image?.buffer ? null : 'empty_or_null_response',
    })
  } catch (err) {
    downloadResults.push({
      source: 'fetchZohoItemImageBuffer',
      status: err?.httpStatus || null,
      contentType: null,
      contentLength: 0,
      success: false,
      error: err?.message || String(err),
    })
  }

  const cfg = readZohoConfig()
  const cachedRow = (await inventoryItemImageStore.getCachedImagesByItemIds([resolvedItemId])).get(resolvedItemId)
  const fileExists = cachedRow?.imageUrl
    ? inventoryItemImageStorage.fileExistsForPublicUrl(cachedRow.imageUrl)
    : false

  return {
    sku: resolvedSku,
    itemId: resolvedItemId,
    itemName: resolvedName,
    lookupUsed: lookup,
    lookupNote:
      lookup.toLowerCase() === resolvedName.toLowerCase() && lookup.toLowerCase() !== resolvedSku.toLowerCase()
        ? 'Matched by item name (not barcode SKU). Dashboard label may differ from Zoho sku field.'
        : null,
    listItemImageKeys: imageRelatedKeys(listItem),
    detailImageKeys: detail ? imageRelatedKeys(detail) : [],
    detailEndpoint,
    detailError,
    possibleImageFields: {
      list: pickImageFields(listItem),
      detail: detail ? pickImageFields(detail) : null,
    },
    attemptedDownloadUrls,
    downloadResults,
    cachedImage: cachedRow
      ? {
          imageUrl: cachedRow.imageUrl,
          imageSource: cachedRow.imageSource,
          fileExistsOnDisk: fileExists,
          contentType: cachedRow.contentType || null,
          fileSize: cachedRow.fileSize || null,
        }
      : null,
    zohoConfigured: cfg.code === 'ok',
  }
}

module.exports = {
  syncMissingInventoryImages,
  syncOneInventoryImage,
  getInventoryImageCacheStatus,
  debugOneInventoryImage,
  _internals: {
    extractImageReference,
    resolveImageForItem,
    pickItemId,
    pickSku,
    isEffectivelyCached,
    findActiveItem,
    imageRelatedKeys,
    pickImageFields,
  },
}

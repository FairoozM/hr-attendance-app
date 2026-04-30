const {
  listAllItems,
  fetchItemById,
  fetchZohoItemImageBuffer,
} = require('../integrations/zoho/zohoInventoryClient')
const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const { normalizeZohoInventoryItem, parseFamilyFromZohoItem } = require('../integrations/zoho/zohoItemFamily')
const { listAllActiveMemberRows } = require('../services/itemReportGroupsService')
const {
  _internals: {
    buildZohoLookupMaps,
    findZohoItemsForMember,
    aggregateByFamily,
  },
} = require('../services/weeklyReportZohoData')
const zohoItemImageCache = require('../services/zohoItemImageCache')

const MAX_SKUS = 1000
const DEFAULT_CONCURRENCY = 10
const SKU_MAP_TTL_MS = 30 * 60 * 1000

let skuMapCache = { expiresAt: 0, promise: null, map: null }

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeSku(value) {
  return cleanSku(value).toLowerCase()
}

function uniqueSkus(input) {
  const source = Array.isArray(input) ? input : []
  const seen = new Set()
  const out = []
  for (const raw of source) {
    const sku = cleanSku(raw)
    if (!sku) continue
    const key = normalizeSku(sku)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(sku)
    if (out.length >= MAX_SKUS) break
  }
  return out
}

function pickItemSku(item) {
  return cleanSku(item && (item.sku || item.item_code || item.code || item.zoho_representative_sku))
}

function pickItemName(item) {
  return cleanSku(item && (item.name || item.item_name || item.description || item.zoho_representative_name || item.family))
}

function pickItemId(item) {
  return cleanSku(item && (item.item_id || item.id || item.zoho_representative_item_id))
}

function itemLooksActive(item) {
  const status = String((item && (item.status || item.item_status)) || '').toLowerCase()
  return !status || status === 'active'
}

async function buildSkuMap() {
  const c = readZohoConfig()
  const familyFieldId = c.code === 'ok' ? c.familyCustomFieldId : null
  const items = await listAllItems()
  const maps = buildZohoLookupMaps(items, familyFieldId)
  const map = new Map()

  function addLookup(key, item, prefer = false) {
    const norm = normalizeSku(key)
    if (!norm || !item || !pickItemId(item)) return
    const existing = map.get(norm)
    if (
      prefer ||
      !existing ||
      (!itemLooksActive(existing) && itemLooksActive(item)) ||
      (!extractImageReference(existing) && extractImageReference(item))
    ) {
      map.set(norm, item)
    }
  }

  for (const item of Array.isArray(items) ? items : []) {
    const sku = pickItemSku(item)
    const itemId = pickItemId(item)
    const name = pickItemName(item)
    const family = parseFamilyFromZohoItem(item, familyFieldId)
    addLookup(sku, item)
    addLookup(itemId, item)
    addLookup(name, item)
    if (family) {
      const familyRepresentative = resolveRepresentativeForZohoItems([item], maps, familyFieldId, family)
      addLookup(family, familyRepresentative || item, true)
    }
  }

  const members = await listAllActiveMemberRows()
  for (const member of members) {
    const matches = findZohoItemsForMember(member, maps)
      .filter((item) => item && !(item.status && String(item.status).toLowerCase() === 'inactive'))
    const representative = resolveRepresentativeForZohoItems(
      matches,
      maps,
      familyFieldId,
      member.item_name || member.sku || member.item_id || ''
    )
    if (!representative) continue
    addLookup(member.sku, representative, true)
    addLookup(member.item_id, representative, true)
    addLookup(member.item_name, representative, true)
  }

  return map
}

function zohoItemToImageLookupRow(zohoItem, familyFieldId) {
  const n = normalizeZohoInventoryItem(zohoItem, familyFieldId)
  const hasImage =
    zohoItem &&
    ((zohoItem.image_document_id != null && zohoItem.image_document_id !== '') ||
      (zohoItem.image_name != null && zohoItem.image_name !== ''))
  return {
    sku: n.sku,
    item_name: n.name,
    item_id: n.item_id,
    family: n.family,
    opening_stock: 0,
    closing_stock: 0,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    sales_amount: 0,
    _zoho: {
      from_date: '1970-01-01',
      to_date: '1970-01-01',
      family: n.family,
      has_image: !!hasImage,
      is_active: !zohoItem.status || String(zohoItem.status).toLowerCase() !== 'inactive',
    },
  }
}

function resolveRepresentativeForZohoItems(zohoItems, maps, familyFieldId, fallbackLabel) {
  const rows = (Array.isArray(zohoItems) ? zohoItems : [])
    .filter((item) => item && pickItemId(item))
    .map((item) => zohoItemToImageLookupRow(item, familyFieldId))
  if (rows.length === 0) return null
  const familyRows = aggregateByFamily(rows, {
    byFamily: maps.byFamily,
    bySku: maps.bySku,
    familyFieldId,
    fromDate: '1970-01-01',
    toDate: '1970-01-01',
  })
  const target = cleanSku(fallbackLabel).toLowerCase()
  const selected =
    (target && familyRows.find((row) => cleanSku(row.family).toLowerCase() === target)) ||
    familyRows[0]
  if (!selected || !selected.zoho_representative_item_id) return zohoItems[0] || null
  return {
    item_id: selected.zoho_representative_item_id,
    sku: selected.zoho_representative_sku || '',
    name: selected.zoho_representative_name || selected.family || fallbackLabel || '',
    item_name: selected.zoho_representative_name || selected.family || fallbackLabel || '',
    family: selected.family || fallbackLabel || '',
    image_document_id: 'representative',
    status: 'active',
  }
}

async function getSkuMap() {
  const now = Date.now()
  if (skuMapCache.map && now < skuMapCache.expiresAt) return skuMapCache.map
  if (!skuMapCache.promise) {
    skuMapCache.promise = buildSkuMap()
      .then((map) => {
        skuMapCache = {
          map,
          promise: null,
          expiresAt: Date.now() + SKU_MAP_TTL_MS,
        }
        return map
      })
      .catch((err) => {
        skuMapCache.promise = null
        throw err
      })
  }
  return skuMapCache.promise
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
    const v = cleanSku(value)
    if (v) return v
  }
  if (Array.isArray(item.documents)) {
    const doc = item.documents.find((d) => d && /image/i.test(String(d.type || d.file_type || d.name || '')))
    const v = doc && cleanSku(doc.url || doc.document_url || doc.document_id || doc.name)
    if (v) return v
  }
  return null
}

function publicImagePath(itemId) {
  return `/api/zoho/items/images/${encodeURIComponent(String(itemId))}/download`
}

async function mapWithConcurrency(list, limit, fn) {
  if (!list.length) return []
  const out = new Array(list.length)
  const max = Math.max(1, Math.min(Number(limit) || DEFAULT_CONCURRENCY, list.length))
  let index = 0
  async function worker() {
    for (;;) {
      const i = index
      index += 1
      if (i >= list.length) return
      out[i] = await fn(list[i], i)
    }
  }
  await Promise.all(Array.from({ length: max }, () => worker()))
  return out
}

function errorMessage(err) {
  if (!err) return 'Unknown error'
  if (err.code === 'ZOHO_OAUTH_ERROR') {
    return 'Zoho authentication failed. Check the backend Zoho OAuth refresh token and client credentials.'
  }
  if (err.code === 'ZOHO_NOT_CONFIGURED') {
    return 'Zoho is not configured on the backend. Set the Zoho environment variables and restart the backend.'
  }
  if (err.code === 'ZOHO_HTTP_429' || err.code === 'ZOHO_RATE_MINUTE_LIMIT') {
    return 'Zoho rate limit reached. Retry after the cooldown window.'
  }
  return err.message || 'Zoho request failed'
}

async function fetchOneSku(sku, skuMap) {
  const base = {
    sku,
    itemName: '',
    itemId: '',
    imageUrl: '',
    imageReference: '',
    imageContentType: '',
    status: 'Error',
    message: '',
  }
  try {
    const itemSummary = skuMap.get(normalizeSku(sku))
    if (!itemSummary) {
      return { ...base, status: 'Not Found', message: 'SKU not found in Zoho Inventory' }
    }

    const itemId = pickItemId(itemSummary)
    const detail = await fetchItemById(itemId)
    const itemName = pickItemName(detail) || pickItemName(itemSummary)
    const imageReference = extractImageReference(detail)

    const cached = zohoItemImageCache.get(itemId)
    const image = cached || (await fetchZohoItemImageBuffer(itemId))
    if (!image) {
      return {
        ...base,
        itemName,
        itemId,
        imageReference: imageReference || '',
        status: 'No Image',
        message: 'Item found, but Zoho returned no image',
      }
    }
    if (!cached) zohoItemImageCache.set(itemId, image)

    return {
      ...base,
      sku: pickItemSku(detail) || pickItemSku(itemSummary) || sku,
      itemName,
      itemId,
      imageUrl: publicImagePath(itemId),
      imageReference: imageReference || publicImagePath(itemId),
      imageContentType: image.contentType || 'image/jpeg',
      status: 'Found',
      message: 'Image found',
    }
  } catch (err) {
    return { ...base, status: 'Error', message: errorMessage(err) }
  }
}

function summarize(results) {
  const summary = { total: results.length, found: 0, notFound: 0, noImage: 0, error: 0 }
  for (const row of results) {
    if (row.status === 'Found') summary.found += 1
    else if (row.status === 'Not Found') summary.notFound += 1
    else if (row.status === 'No Image') summary.noImage += 1
    else summary.error += 1
  }
  return summary
}

async function fetchImages(req, res) {
  const skus = uniqueSkus(req.body && req.body.skus)
  if (!Array.isArray(req.body && req.body.skus)) {
    return res.status(400).json({ error: 'Input must be { skus: string[] }' })
  }
  if (skus.length === 0) {
    return res.status(400).json({ error: 'Paste at least one SKU' })
  }
  try {
    const skuMap = await getSkuMap()
    const results = await mapWithConcurrency(skus, DEFAULT_CONCURRENCY, (sku) => fetchOneSku(sku, skuMap))
    return res.json({
      results,
      summary: summarize(results),
      meta: {
        inputCount: req.body.skus.length,
        uniqueCount: skus.length,
        maxSkus: MAX_SKUS,
        batchSize: DEFAULT_CONCURRENCY,
      },
    })
  } catch (err) {
    const status = err.code === 'ZOHO_NOT_CONFIGURED' ? 503 : err.code === 'ZOHO_OAUTH_ERROR' ? 502 : 500
    return res.status(status).json({ error: errorMessage(err), code: err.code || 'ZOHO_ITEM_IMAGE_FETCH_FAILED' })
  }
}

function csvEscape(value) {
  const s = String(value == null ? '' : value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function normalizeResults(input) {
  return Array.isArray(input) ? input.slice(0, MAX_SKUS) : []
}

function buildCsv(results) {
  const headers = ['SKU', 'Item Name', 'Zoho Item ID', 'Image URL', 'Status', 'Message']
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of normalizeResults(results)) {
    lines.push([
      row.sku,
      row.itemName,
      row.itemId,
      row.imageUrl || row.imageReference,
      row.status,
      row.message,
    ].map(csvEscape).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function exportCsv(req, res) {
  const results = normalizeResults(req.body && req.body.results)
  const csv = buildCsv(results)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="image_fetch_results.csv"')
  return res.status(200).send(csv)
}

function sanitizeFilename(value) {
  const base = cleanSku(value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (base || 'item').slice(0, 120)
}

function extensionFor(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  return 'jpg'
}

function uniqueImageName(row, contentType, used) {
  const base = sanitizeFilename(row.sku || row.itemId || 'item')
  const ext = extensionFor(contentType)
  let name = `${base}.${ext}`
  let n = 2
  while (used.has(name.toLowerCase())) {
    name = `${base}_${n}.${ext}`
    n += 1
  }
  used.add(name.toLowerCase())
  return name
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const b of buffer) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

function buildZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  const { dosTime, dosDate } = dosDateTime()

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

async function exportZip(req, res) {
  const results = normalizeResults(req.body && req.body.results)
  const files = [{ name: 'image_fetch_results.csv', data: Buffer.from(buildCsv(results), 'utf8') }]
  const used = new Set(['image_fetch_results.csv'])

  for (const row of results) {
    if (row.status !== 'Found' || !row.itemId) continue
    try {
      const cached = zohoItemImageCache.get(row.itemId)
      const image = cached || (await fetchZohoItemImageBuffer(row.itemId))
      if (!image || !image.buffer) continue
      if (!cached) zohoItemImageCache.set(row.itemId, image)
      files.push({
        name: uniqueImageName(row, image.contentType, used),
        data: image.buffer,
      })
    } catch (err) {
      console.warn('[zohoItemImages] exportZip image skipped:', row.itemId, err.message)
    }
  }

  const zip = buildZip(files)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="zoho_item_images.zip"')
  return res.status(200).send(zip)
}

async function downloadImage(req, res) {
  const { itemId } = req.params
  try {
    const cached = zohoItemImageCache.get(itemId)
    const out = cached || (await fetchZohoItemImageBuffer(itemId))
    if (!out) return res.status(404).json({ error: 'Image not found' })
    if (!cached) zohoItemImageCache.set(itemId, out)
    res.setHeader('Content-Type', out.contentType || 'image/jpeg')
    res.setHeader('Cache-Control', `private, max-age=${zohoItemImageCache.MAX_AGE_SEC}`)
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(itemId)}.${extensionFor(out.contentType)}"`)
    return res.status(200).send(out.buffer)
  } catch (err) {
    if (err.code === 'ZOHO_INVALID_ITEM_ID') {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    return res.status(502).json({ error: errorMessage(err), code: err.code || 'ZOHO_IMAGE_DOWNLOAD_FAILED' })
  }
}

module.exports = {
  fetchImages,
  exportCsv,
  exportZip,
  downloadImage,
  _internals: {
    uniqueSkus,
    buildCsv,
    buildZip,
    extractImageReference,
  },
}

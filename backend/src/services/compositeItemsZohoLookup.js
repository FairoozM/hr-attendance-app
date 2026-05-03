/**
 * On-demand Zoho composite item lookup by SKU (no full catalog sync).
 * Uses GET /compositeitems (search_text) + GET /compositeitems/{id} for BOM lines.
 */

const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const {
  fetchCompositeItemsList,
  fetchCompositeItemDetail,
  fetchItemById,
} = require('../integrations/zoho/zohoInventoryClient')

function trimStr(v) {
  if (v == null) return ''
  return String(v).trim()
}

/** Many orgs store EAN/UPC in `sku`; catalogue codes often live in name / part_number / CF. */
function looksLikeNumericBarcode(s) {
  const t = trimStr(s)
  return t.length >= 8 && /^\d+$/.test(t)
}

function looksLikeCatalogCode(s) {
  const t = trimStr(s)
  if (t.length < 3) return false
  return /[A-Za-z]/.test(t)
}

/** Prefer hyphenated letter+digit codes (e.g. LIFEP17S-24-BEIGE) over long marketing titles. */
function scoreCatalogCandidate(s) {
  const t = trimStr(s)
  if (!looksLikeCatalogCode(t)) return -1
  let score = 0
  if (/^[A-Za-z]{2,}/.test(t)) score += 40
  if (/-/.test(t)) score += 35
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/i.test(t)) score += 30
  if (/\s{2,}/.test(t)) score -= 20
  if (/\s/.test(t)) score -= 12
  score -= Math.min(35, Math.max(0, t.length - 28))
  return score
}

function pickDisplaySku(identifiers) {
  let best = ''
  let bestScore = -Infinity
  for (const id of identifiers) {
    const sc = scoreCatalogCandidate(id)
    if (sc > bestScore) {
      bestScore = sc
      best = trimStr(id)
    }
  }
  if (bestScore >= 0) return best
  const barcodes = identifiers.filter(looksLikeNumericBarcode)
  if (barcodes.length) return trimStr(barcodes[0])
  return trimStr(identifiers[0]) || ''
}

/**
 * Every string we might match against All Prices "Item no." (case-insensitive on client).
 */
function collectRawIdentifiers(item, mappedSku, mappedName) {
  const out = []
  const push = (v) => {
    const t = trimStr(v)
    if (t) out.push(t)
  }

  if (item && typeof item === 'object') {
    push(item.sku)
    push(item.part_number)
    push(item.name)
    push(item.item_name)
    if (Array.isArray(item.custom_fields)) {
      for (const cf of item.custom_fields) {
        if (cf && cf.value != null) push(cf.value)
      }
    }
    for (const k of Object.keys(item)) {
      if (k.startsWith('cf_') && item[k] != null && typeof item[k] !== 'object') {
        push(item[k])
      }
    }
  }
  push(mappedSku)
  push(mappedName)
  return out
}

function uniqueMatchKeys(identifiers, max = 32) {
  const seen = new Set()
  const keys = []
  for (const id of identifiers) {
    const t = trimStr(id)
    const low = t.toLowerCase()
    if (!t || seen.has(low)) continue
    seen.add(low)
    keys.push(t)
    if (keys.length >= max) break
  }
  return keys
}

/**
 * Composite mapped_lines often put EAN/barcode in `sku`. Resolve catalogue identifiers from GET /items/{id}.
 * @param {object[]} mappedRows - raw Zoho mapped_items
 */
async function resolveComponentsFromMappedItems(mappedRows) {
  const preliminary = mappedRows
    .map((m) => ({
      item_id: m.item_id != null ? String(m.item_id) : '',
      sku_mapped: String(m.sku || '').trim(),
      name_mapped: m.name != null ? String(m.name) : '',
      quantity: Number(m.quantity),
      zoho_purchase_rate:
        m.purchase_rate != null && Number.isFinite(Number(m.purchase_rate))
          ? Number(m.purchase_rate)
          : null,
    }))
    .filter((c) => c.item_id && Number.isFinite(c.quantity) && c.quantity > 0)

  const uniqueIds = [...new Set(preliminary.map((c) => c.item_id))]
  const itemById = new Map()

  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const raw = await fetchItemById(id, { skipCache: true })
        itemById.set(id, raw && typeof raw === 'object' ? raw : null)
      } catch (err) {
        console.warn(`[composite-bom] GET /items/${id} failed:`, err.message || err)
        itemById.set(id, null)
      }
    })
  )

  return preliminary.map((c) => {
    const item = itemById.get(c.item_id)
    const identifiers = collectRawIdentifiers(item, c.sku_mapped, c.name_mapped)
    const match_keys = uniqueMatchKeys(identifiers)
    const sku = pickDisplaySku(identifiers)
    const name =
      trimStr(item && item.name) ||
      trimStr(item && item.item_name) ||
      trimStr(c.name_mapped) ||
      sku

    return {
      item_id: c.item_id,
      sku,
      name,
      match_keys,
      quantity: c.quantity,
      zoho_purchase_rate: c.zoho_purchase_rate,
    }
  })
}

function pickCompositeMatch(rows, sku) {
  const needle = String(sku || '').trim().toLowerCase()
  if (!needle || !rows.length) return null

  const exact = rows.filter((r) => String(r.sku || '').trim().toLowerCase() === needle)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    const e = new Error(
      `Multiple composite items in Zoho share SKU "${sku}". Fix duplicates or search with a unique code.`
    )
    e.code = 'COMPOSITE_SKU_AMBIGUOUS'
    throw e
  }

  const partial = rows.find((r) => String(r.sku || '').trim().toLowerCase().includes(needle))
  if (partial) return partial
  if (rows.length === 1) return rows[0]
  return null
}

/**
 * @param {string} rawSku
 * @returns {Promise<{ composite_item_id: string, sku: string, name: string, components: object[] }>}
 */
async function lookupCompositeItemBySku(rawSku) {
  const sku = String(rawSku || '').trim()
  if (!sku || sku.length > 120) {
    const e = new Error('Enter a composite item SKU (max 120 characters).')
    e.code = 'INVALID_SKU'
    throw e
  }

  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    const e = new Error('Zoho is not configured on the server.')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }

  let listJson
  try {
    listJson = await fetchCompositeItemsList({
      page: 1,
      per_page: 100,
      filter_by: 'Status.All',
      search_text: sku,
    })
  } catch (err) {
    const e = new Error(err.message || 'Zoho composite item search failed')
    e.code = err.code || 'ZOHO_API_ERROR'
    e.cause = err
    throw e
  }

  const rows = Array.isArray(listJson.composite_items) ? listJson.composite_items : []
  const match = pickCompositeMatch(rows, sku)

  if (!match || match.composite_item_id == null) {
    const e = new Error(
      `No composite item matched SKU "${sku}". Check Zoho Inventory → Composite Items, or try the exact SKU.`
    )
    e.code = 'COMPOSITE_SKU_NOT_FOUND'
    throw e
  }

  const cid = String(match.composite_item_id)

  let detailJson
  try {
    detailJson = await fetchCompositeItemDetail(cid)
  } catch (err) {
    const e = new Error(err.message || 'Failed to load composite item details from Zoho')
    e.code = err.code || 'ZOHO_API_ERROR'
    e.cause = err
    throw e
  }

  const entity = detailJson && detailJson.composite_item ? detailJson.composite_item : detailJson
  const mapped = Array.isArray(entity.mapped_items) ? entity.mapped_items : []

  const components = await resolveComponentsFromMappedItems(mapped)

  if (!components.length) {
    const e = new Error(
      'This composite item has no component lines with quantity in Zoho. Check mapped items on the composite record.'
    )
    e.code = 'COMPOSITE_NO_COMPONENTS'
    throw e
  }

  return {
    composite_item_id: String(entity.composite_item_id || cid),
    sku: String(entity.sku || match.sku || sku),
    name: entity.name != null ? String(entity.name) : String(match.name || ''),
    components,
  }
}

module.exports = {
  lookupCompositeItemBySku,
}

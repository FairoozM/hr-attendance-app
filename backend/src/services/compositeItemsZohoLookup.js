/**
 * On-demand Zoho composite item lookup by SKU (no full catalog sync).
 * Uses GET /compositeitems (search_text) + GET /compositeitems/{id} for BOM lines.
 */

const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
const {
  fetchCompositeItemsList,
  fetchCompositeItemDetail,
} = require('../integrations/zoho/zohoInventoryClient')

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

  const components = mapped
    .map((m) => ({
      item_id: m.item_id != null ? String(m.item_id) : '',
      sku: String(m.sku || '').trim(),
      name: m.name != null ? String(m.name) : '',
      quantity: Number(m.quantity),
      zoho_purchase_rate:
        m.purchase_rate != null && Number.isFinite(Number(m.purchase_rate))
          ? Number(m.purchase_rate)
          : null,
    }))
    .filter((c) => c.item_id && Number.isFinite(c.quantity) && c.quantity > 0)

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

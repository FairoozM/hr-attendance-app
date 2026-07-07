const { readZohoConfig, INVENTORY_V1 } = require('./zohoConfig')
const { zohoApiRequest } = require('./zohoInventoryClient')

const MAX_LINES_PER_ADJUSTMENT = 100

function buildJsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

/**
 * Create one quantity inventory adjustment in Zoho Inventory.
 * All IDs and quantities are passed as strings per Zoho guidance for large IDs.
 *
 * @param {object} params
 * @param {string} params.date YYYY-MM-DD
 * @param {string} params.reason
 * @param {string} [params.description]
 * @param {string} [params.reference_number]
 * @param {string} [params.warehouse_id]
 * @param {Array<{ item_id: string, quantity_adjusted: number|string, warehouse_id?: string, description?: string }>} params.line_items
 */
async function createQuantityInventoryAdjustment(params) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho is not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }

  const lineItems = (params.line_items || []).map((li) => {
    const out = {
      item_id: String(li.item_id),
      quantity_adjusted: String(li.quantity_adjusted),
    }
    if (li.description) out.description = String(li.description)
    const wh = li.warehouse_id || params.warehouse_id
    if (wh) {
      out.warehouse_id = String(wh)
      out.location_id = String(wh)
    }
    return out
  })

  const payload = {
    date: params.date,
    reason: params.reason,
    adjustment_type: 'quantity',
    line_items: lineItems,
  }
  if (params.description) payload.description = params.description
  if (params.reference_number) payload.reference_number = params.reference_number
  if (params.warehouse_id) {
    payload.warehouse_id = String(params.warehouse_id)
    payload.location_id = String(params.warehouse_id)
  }

  const json = await zohoApiRequest(
    `${INVENTORY_V1}/inventoryadjustments`,
    new URLSearchParams(),
    'POST',
    buildJsonStringBody(payload),
    {
      source: 'bulk_quantity_adjustment_create',
      skipCache: true,
      critical: true,
    },
  )

  const adj = json && json.inventory_adjustment ? json.inventory_adjustment : json
  const adjId = adj && adj.inventory_adjustment_id != null
    ? String(adj.inventory_adjustment_id)
    : ''

  return {
    inventory_adjustment_id: adjId,
    response: json,
    valuation_pending: adj && adj.is_inventory_valuation_pending === true,
  }
}

/**
 * Fetch adjustment detail for valuation refresh.
 * @param {string} inventoryAdjustmentId
 */
async function fetchInventoryAdjustmentDetail(inventoryAdjustmentId) {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho is not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const id = String(inventoryAdjustmentId || '').trim()
  if (!id) {
    const e = new Error('inventory_adjustment_id is required')
    e.code = 'INVALID_ADJUSTMENT_ID'
    throw e
  }
  const p = new URLSearchParams()
  p.set('organization_id', c.organizationId)
  const json = await zohoApiRequest(
    `${INVENTORY_V1}/inventoryadjustments/${encodeURIComponent(id)}`,
    p,
    'GET',
    undefined,
    {
      source: 'bulk_quantity_adjustment_detail',
      skipCache: true,
    },
  )
  const adj = json && json.inventory_adjustment ? json.inventory_adjustment : json
  return {
    inventory_adjustment_id: id,
    is_inventory_valuation_pending: adj && adj.is_inventory_valuation_pending === true,
    status: adj && adj.status ? String(adj.status) : '',
    total: adj && adj.total != null ? Number(adj.total) : null,
    line_items: Array.isArray(adj && adj.line_items) ? adj.line_items : [],
    raw: adj,
  }
}

/**
 * Split line items into safe batches for Zoho POST.
 * @param {object[]} lineItems
 * @param {number} [maxPerBatch]
 */
function chunkLineItems(lineItems, maxPerBatch = MAX_LINES_PER_ADJUSTMENT) {
  const items = Array.isArray(lineItems) ? lineItems : []
  const chunks = []
  for (let i = 0; i < items.length; i += maxPerBatch) {
    chunks.push(items.slice(i, i + maxPerBatch))
  }
  return chunks
}

module.exports = {
  createQuantityInventoryAdjustment,
  fetchInventoryAdjustmentDetail,
  chunkLineItems,
  MAX_LINES_PER_ADJUSTMENT,
}

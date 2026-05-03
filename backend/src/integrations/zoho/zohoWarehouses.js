/**
 * Fetches and caches the list of Zoho Inventory warehouses.
 * Used by the weekly-report warehouse filter dropdown.
 */

const { zohoApiRequest } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')

let _cache = null
const TTL_MS = 5 * 60 * 1000  // 5 minutes

/**
 * Returns all warehouses for the configured Zoho org.
 * Response is cached for 5 minutes to avoid hammering Zoho on every page load.
 *
 * Each warehouse object has at minimum:
 *   { warehouse_id, warehouse_name, is_primary, status }
 *
 * @returns {Promise<object[]>}
 */
async function fetchWarehouses() {
  if (_cache && Date.now() < _cache.expiresAt) {
    return _cache.warehouses
  }
  const json = await zohoApiRequest(`${INVENTORY_V1}/settings/warehouses`)
  const warehouses = Array.isArray(json?.warehouses) ? json.warehouses : []
  _cache = { warehouses, expiresAt: Date.now() + TTL_MS }
  console.log(`[zoho-warehouses] cached ${warehouses.length} warehouse(s)`)
  return warehouses
}

function clearWarehouseCache() {
  _cache = null
}

module.exports = { fetchWarehouses, clearWarehouseCache }

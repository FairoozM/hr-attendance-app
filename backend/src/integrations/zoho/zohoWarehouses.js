/**
 * Fetches and caches the list of Zoho Inventory warehouses.
 * Used by the weekly-report warehouse filter dropdown.
 */

const { zohoApiRequest } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')

let _cache = null
let _locationCache = null
const TTL_MS = 5 * 60 * 1000  // 5 minutes

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeWarehouseName(value) {
  return clean(value).replace(/\s+/g, ' ').toUpperCase()
}

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

async function fetchLocations() {
  if (_locationCache && Date.now() < _locationCache.expiresAt) {
    return _locationCache.locations
  }
  const json = await zohoApiRequest(`${INVENTORY_V1}/locations`)
  const locations = Array.isArray(json?.locations) ? json.locations : []
  _locationCache = { locations, expiresAt: Date.now() + TTL_MS }
  console.log(`[zoho-locations] cached ${locations.length} location(s)`)
  return locations
}

/**
 * Resolve the Zoho location/warehouse identifiers to use when posting inventory adjustments.
 * Never copies warehouse_id into location_id — that triggers "Invalid Element location_id".
 */
async function resolveAdjustmentLocation({ warehouseId, warehouseName }) {
  const wid = clean(warehouseId)
  const wname = normalizeWarehouseName(warehouseName)
  const warehouses = await fetchWarehouses()
  const locations = await fetchLocations()

  const warehouseById = warehouses.find((w) => {
    const id = clean(w.warehouse_id || w.location_id)
    return wid && id === wid
  })
  if (warehouseById) {
    const locId = clean(warehouseById.location_id)
    const whId = clean(warehouseById.warehouse_id || warehouseById.location_id)
    if (locId && locId !== whId) {
      return { location_id: locId, warehouse_id: whId || wid, source: 'warehouse.location_id' }
    }
  }

  const warehouseByName = warehouses.find((w) => (
    normalizeWarehouseName(w.warehouse_name || w.location_name || w.name) === wname
  ))
  if (warehouseByName) {
    const locId = clean(warehouseByName.location_id)
    const whId = clean(warehouseByName.warehouse_id || warehouseByName.location_id)
    if (locId && locId !== whId) {
      return { location_id: locId, warehouse_id: whId || wid, source: 'warehouse_name.location_id' }
    }
  }

  const location = locations.find((loc) => {
    const locId = clean(loc.location_id)
    const locName = normalizeWarehouseName(loc.location_name)
    return (wid && locId === wid) || (wname && locName === wname)
  })
  if (location && clean(location.location_id)) {
    return {
      location_id: clean(location.location_id),
      warehouse_id: wid || clean(location.location_id),
      source: 'locations_api',
    }
  }

  if (wid) {
    return { location_id: null, warehouse_id: wid, source: 'warehouse_id_only' }
  }
  return { location_id: null, warehouse_id: null, source: 'unresolved' }
}

function clearWarehouseCache() {
  _cache = null
  _locationCache = null
}

module.exports = {
  fetchWarehouses,
  fetchLocations,
  resolveAdjustmentLocation,
  clearWarehouseCache,
}

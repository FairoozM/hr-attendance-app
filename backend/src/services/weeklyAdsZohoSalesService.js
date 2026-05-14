/**
 * Weekly Ads report: Net Sales (AED) from Zoho Inventory **Sales by Item** report,
 * summed **with tax** per Zoho warehouse for the selected date range.
 *
 * Pin warehouse IDs with env `WEEKLY_ADS_ZOHO_WAREHOUSES_JSON`, e.g.:
 * `{"Amazon (UAE)":"4265011000000123456","Amazon (KSA)":"...","Noon":"...","Website":"..."}`
 * Keys must match the marketplace labels used in the UI row names.
 *
 * If unset, the service attempts a **best-effort** match on `warehouse_name` (see hints below).
 */

const { fetchWarehouses } = require('../integrations/zoho/zohoWarehouses')
const { aggregateReportSalesWithTaxForWarehouse } = require('../integrations/zoho/weeklyReportZohoTransactions')

/** @type {Record<string, string[][]>} marketplace label → list of token groups (AND within group) */
const MARKETPLACE_WAREHOUSE_NAME_HINTS = {
  'Amazon (UAE)': [
    ['amazon', 'uae'],
    ['amazon', 'ae'],
    ['amazon', 'emirates'],
    ['fba', 'uae'],
    ['fba', 'ae'],
  ],
  'Amazon (KSA)': [
    ['amazon', 'ksa'],
    ['amazon', 'saudi'],
    ['amazon', 'riyadh'],
    ['fba', 'ksa'],
    ['fba', 'saudi'],
  ],
  Noon: [['noon']],
  /** Avoid substring traps (e.g. "direct" inside "Directship"); see tokenMatchesInWarehouseName. */
  Website: [['website'], ['web store'], ['shopify'], ['woocommerce'], ['magento'], ['b2c'], ['direct']],
}

function escapeRegExpToken(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True if `token` appears in `warehouseNameLower` as a **whole word** (not a substring inside
 * another word like "direct" in "Directship").
 */
function tokenMatchesInWarehouseName(warehouseNameLower, tokenRaw) {
  const nm = String(warehouseNameLower || '').toLowerCase()
  const t = String(tokenRaw || '').toLowerCase().trim()
  if (!nm || !t) return false
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExpToken(t)}(?:[^a-z0-9]|$)`, 'i')
  return re.test(nm)
}

function readExplicitWarehouseMap() {
  const raw = process.env.WEEKLY_ADS_ZOHO_WAREHOUSES_JSON
  if (raw == null || String(raw).trim() === '') return {}
  try {
    const o = JSON.parse(String(raw).trim())
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const out = {}
    for (const [k, v] of Object.entries(o)) {
      if (v == null) continue
      const id = String(v).trim()
      if (id) out[String(k).trim()] = id
    }
    return out
  } catch {
    return {}
  }
}

function warehouseNameLower(w) {
  return String(w?.warehouse_name ?? '').toLowerCase()
}

function resolveWarehouseIdForMarketplace(marketplaceLabel, warehouses, explicit) {
  const key = String(marketplaceLabel || '').trim()
  if (explicit[key]) return explicit[key]
  const hints = MARKETPLACE_WAREHOUSE_NAME_HINTS[key]
  if (!hints || !Array.isArray(warehouses)) return ''
  for (const tokens of hints) {
    const hit = warehouses.find((wh) => {
      const nm = warehouseNameLower(wh)
      return tokens.every((t) => tokenMatchesInWarehouseName(nm, t))
    })
    if (hit?.warehouse_id) return String(hit.warehouse_id).trim()
  }
  return ''
}

/**
 * @param {object} opts
 * @param {string} opts.fromDate - YYYY-MM-DD
 * @param {string} opts.toDate - YYYY-MM-DD
 * @param {string[]} opts.marketplaceNames
 * @returns {Promise<object>}
 */
async function fetchWeeklyAdsZohoSalesWithTax({ fromDate, toDate, marketplaceNames }) {
  const names = Array.isArray(marketplaceNames)
    ? marketplaceNames.map((s) => String(s || '').trim()).filter(Boolean)
    : []
  if (!fromDate || !toDate) {
    const e = new Error('from_date and to_date are required')
    e.code = 'BAD_REQUEST'
    throw e
  }
  if (names.length === 0) {
    const e = new Error('marketplaces must be a non-empty array')
    e.code = 'BAD_REQUEST'
    throw e
  }

  const warehouses = await fetchWarehouses()
  const explicit = readExplicitWarehouseMap()
  const warnings = []

  /** @type {Record<string, string>} */
  const warehouseByMarketplace = {}
  for (const name of names) {
    warehouseByMarketplace[name] = resolveWarehouseIdForMarketplace(name, warehouses, explicit)
    if (!warehouseByMarketplace[name]) {
      warnings.push(
        `"${name}": no Zoho warehouse auto-matched. Map the row to a warehouse_id in WEEKLY_ADS_ZOHO_WAREHOUSES_JSON (keys must match these row names exactly).`,
      )
    } else if (!explicit[name]) {
      const wh = warehouses.find((w) => String(w.warehouse_id) === warehouseByMarketplace[name])
      if (wh?.warehouse_name) {
        warnings.push(
          `"${name}" was auto-linked to Zoho warehouse "${wh.warehouse_name}" (${warehouseByMarketplace[name]}). Confirm this is correct, then pin it in WEEKLY_ADS_ZOHO_WAREHOUSES_JSON.`,
        )
      }
    }
  }

  const uniqueIds = [...new Set(Object.values(warehouseByMarketplace).filter(Boolean))]
  /** @type {Map<string, { total: number, truncated: boolean, pages: number, row_count: number }>} */
  const aggByWh = new Map()
  for (const wid of uniqueIds) {
    const agg = await aggregateReportSalesWithTaxForWarehouse(fromDate, toDate, wid)
    aggByWh.set(wid, agg)
    if (agg.truncated) {
      warnings.push(
        `Zoho Sales by Item for warehouse ${wid} may be incomplete (pagination cap). Try a narrower date range if totals look wrong.`,
      )
    }
  }

  /** @type {Record<string, number|null>} */
  const sales = {}
  for (const name of names) {
    const wid = warehouseByMarketplace[name]
    if (!wid) {
      sales[name] = null
      continue
    }
    const agg = aggByWh.get(wid)
    sales[name] = agg ? agg.total : null
  }

  /** @type {Record<string, string|null>} */
  const warehouse_resolution = {}
  for (const name of names) {
    warehouse_resolution[name] = warehouseByMarketplace[name] || null
  }

  return {
    from_date: fromDate,
    to_date: toDate,
    sales,
    warehouse_resolution,
    warnings,
    source: 'zoho_inventory_reports_salesbyitem',
    amount_basis: 'tax_inclusive_where_available',
  }
}

module.exports = {
  fetchWeeklyAdsZohoSalesWithTax,
  _internals: { tokenMatchesInWarehouseName },
}

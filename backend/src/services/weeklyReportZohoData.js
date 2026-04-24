/**
 * Weekly report rows from `zohoAdapter.fetchAllItemsRaw()`: primary data source
 * is the Zoho adapter (not Deluge webhooks).
 *
 * For each `item_report_groups` member, intersect with the Zoho catalog. **Family**
 * is display metadata. On-hand **quantities** come from Items; period movement (sold, purchases, returns) from
 * reports and vendor credits. The API then exposes **monetary** opening / closing (qty × `purchase_rate` or `rate`)
 * and currency amounts; movement qtys are not returned on family rows.
 */

const { fetchAllItemsRaw } = require('../integrations/zoho/zohoAdapter')
const { readZohoConfig, orgEnvHint } = require('../integrations/zoho/zohoConfig')
const { normalizeZohoInventoryItem, parseFamilyFromZohoItem } = require('../integrations/zoho/zohoItemFamily')
const {
  getSales,
  getPurchases,
  getVendorCredits,
} = require('../integrations/zoho/weeklyReportZohoTransactions')
const {
  buildItemIdToSkuMap,
  sumLinesToMap,
  sumAmountsToMap,
  mapLookupForReportRow,
  applyTransactionMapsToRow,
} = require('./weeklyReportZohoLineMerge')
const {
  getResolvedReportVendor,
  assertReportVendorResolvedIfRequired,
  isReportVendorOptional,
} = require('./weeklyReportReportVendor')

/**
 * Map Zoho Inventory path → required OAuth scope. The single source of truth
 * for the scope set used by the weekly report. Keep in sync with
 * docs/weekly-report-zoho-transactions.md and docs/zoho-inventory-api-coverage.md.
 */
const ZOHO_INV_SCOPE_BY_PATH = [
  { re: /\/inventory\/v1\/items\b/,         scope: 'ZohoInventory.items.READ' },
  { re: /\/inventory\/v1\/invoices\b/,      scope: 'ZohoInventory.invoices.READ' },
  { re: /\/inventory\/v1\/bills\b/,         scope: 'ZohoInventory.bills.READ' },
  { re: /\/inventory\/v1\/vendorcredits\b/, scope: 'ZohoInventory.debitnotes.READ' },
  { re: /\/inventory\/v1\/contacts\b/,      scope: 'ZohoInventory.contacts.READ' },
]

const ZOHO_REQUIRED_SCOPES_SUMMARY =
  'ZohoInventory.items.READ, ZohoInventory.invoices.READ, ZohoInventory.bills.READ, ' +
  'ZohoInventory.debitnotes.READ (vendor credits)' +
  '. Re-issue the refresh token at https://api-console.zoho.com (Self Client → Generate Code → Generate Token) ' +
  'with these scopes.'

/**
 * Adds a “Required Zoho OAuth scope: …” hint to warnings that look like an
 * authentication/scope failure (HTTP 401 from Zoho or app-level code 57).
 * Pure formatting; no side effects.
 *
 * @param {string} msg
 * @returns {string}
 */
function enrichZohoWarning(msg) {
  const s = String(msg || '')
  const is401 = /\bHTTP\s*401\b/.test(s)
  const isCode57 =
    /\bcode\s*["':]?\s*57\b/.test(s) ||
    /You are not authorized to perform this operation/i.test(s)
  if (!is401 && !isCode57) return s
  for (const e of ZOHO_INV_SCOPE_BY_PATH) {
    if (e.re.test(s)) {
      return (
        `${s} → Missing Zoho OAuth scope: ${e.scope}. ` +
        `Re-issue the refresh token with this scope (https://api-console.zoho.com → Self Client). ` +
        `Full required scope set for the weekly report: ${ZOHO_REQUIRED_SCOPES_SUMMARY}`
      )
    }
  }
  return (
    `${s} → Zoho returned 401 / code 57 (not authorized). ` +
    `Required Zoho Inventory scopes for the weekly report: ${ZOHO_REQUIRED_SCOPES_SUMMARY}`
  )
}

/**
 * Exposed on JSON responses so the UI can show a one-line data-source note.
 * Copy remains short; the canonical gap analysis is in docs/zoho-inventory-api-coverage.md
 */
const ZOHO_WEEKLY_REPORT_INTEGRATION = {
  data_source: 'zoho_inventory_rest_v1',
  item_endpoint: 'GET /inventory/v1/items (pages)',
  // Same keys as prior API; phase 2 uses stock placeholders and zeros where noted below
  metrics_unavailable_in_this_integration: [
    'Point-in-time Zoho "stock on from_date" (historical) — opening is **not** that value; it is ' +
      'a **TEMPORARY** duplicate of current `stock_on_hand` (see transaction_debug, Phase 4).',
  ],
  metrics_populated: [
    'row keys: item_report_groups ∩ Zoho; item_name, sku, family; closing = current item stock; sold/returns/purch from APIs',
    'family: Zoho custom field via ZOHO_FAMILY_CUSTOMFIELD_ID when set, else ""',
  ],
  phase2_stock_placeholders: {
    /** Current stock on hand from Items API at request time (or available_* fallbacks) */
    closing_from_items_api: 'Zoho item stock (stock_on_hand or available_* fallback).',
    /** TEMPORARY (Phase 4): duplicate of `stock_on_hand` / `closing_from_items_api`; not ledger-backed */
    opening_stock: 'TEMPORARY: current stock_on_hand (same as closing) — not "stock on from_date."',
    sales_source: 'GET /invoices, all customers, date in [from_date,to_date], not void; line item quantities',
    purchases_source: 'GET /bills, filtered to REPORT vendor (REPORT_VENDOR_ID/NAME or group config); line item quantities',
    returns_source: 'GET /vendorcredits, same vendor; line item quantities',
  },
  documentation: 'docs/zoho-inventory-api-coverage.md, docs/weekly-report-zoho-transactions.md',
  /**
   * How metrics relate to Zoho / vendors. Stock and sales are never
   * “vendor-sliced” at row level: opening/closing are global item; SOLD
   * includes all sales. Vendor scoping is only for vendor-credits (returned
   * to wholesale) and optionally for purchases, per `WEEKLY_REPORT_VENDORS_JSON`
   * / related env. See `weeklyReportVendorConfig.js`.
   */
  metric_business_scopes: {
    sold: {
      include: 'all_sales',
      note: 'No vendor filter on sales lines; all vendors when transactions are wired.',
    },
    opening_stock: { scope: 'global_item' },
    closing_stock: { scope: 'global_item' },
    returned_to_wholesale: {
      meaning: 'vendor_credits',
      include: 'configured_vendor_credits_contact_only',
      note:
        'Vendor credit documents for the configured `vendor_credits_contact_id` ' +
        'per report group; other vendors excluded.',
    },
    purchases: {
      source: 'GET /bills',
      note: 'Bills in date range for REPORT_VENDOR_ID / per-group id / REPORT_VENDOR_NAME; other vendors excluded.',
    },
  },
}

function parseQty(s) {
  if (s === undefined || s === null) return 0
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * Single quantity for placeholder opening/closing from a Zoho item. Prefer
 * `stock_on_hand` as requested for Phase 2; fall back if Zoho omits it.
 *
 * @param {object} item
 * @returns {number} finite number, 0 if unknown
 */
function parseZohoStockOnHand(item) {
  if (!item || typeof item !== 'object') return 0
  const v =
    item.stock_on_hand != null
      ? item.stock_on_hand
      : item.available_stock != null
        ? item.available_stock
        : item.available_for_sale
  if (v === undefined || v === null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(String(v).replace(/,/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Per-unit **cost** for stock value: `purchase_rate`, else `selling` `rate`, else 0.
 * @param {object} item
 * @returns {number}
 */
function parseZohoUnitCost(item) {
  if (!item || typeof item !== 'object') return 0
  const pr = item.purchase_rate
  if (pr != null && pr !== '') {
    const n = parseQty(pr)
    if (n > 0) return n
  }
  const r = item.rate
  if (r != null && r !== '') {
    const n = parseQty(r)
    if (n > 0) return n
  }
  return 0
}

/**
 * @param {object} zohoItem
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string | null} familyFieldId
 * @see normalizeZohoInventoryItem
 */
function zohoItemToPlaceholderReportRow(zohoItem, fromDate, toDate, familyFieldId) {
  const n = normalizeZohoInventoryItem(zohoItem, familyFieldId)
  const sh = parseZohoStockOnHand(zohoItem)
  const unitCost = parseZohoUnitCost(zohoItem)
  // stock fields are **quantities** until `applyZohoWeeklyValueColumns` in fetchZohoItemRowsForGroupMembers
  return {
    sku: n.sku,
    item_name: n.name,
    item_id: n.item_id,
    family: n.family,
    opening_stock: sh,
    closing_stock: sh,
    purchases: 0,
    returned_to_wholesale: 0,
    sold: 0,
    _unit_cost: unitCost,
    _zoho: {
      from_date: fromDate,
      to_date: toDate,
      family: n.family,
    },
  }
}

/**
 * @param {object[]} rawZoho
 * @returns {{ bySku: Map, byName: Map, byItemId: Map }}
 */
/**
 * @param {object[]} rawZoho
 * @param {string | null} familyFieldId - from ZOHO_FAMILY_CUSTOMFIELD_ID (or null for label fallback)
 */
function buildZohoLookupMaps(rawZoho, familyFieldId) {
  const bySku = new Map()
  const byName = new Map()
  const byItemId = new Map()
  /** family value (lowercase) → active items with that family */
  const byFamily = new Map()
  if (!Array.isArray(rawZoho)) {
    return { bySku, byName, byItemId, byFamily }
  }
  for (const it of rawZoho) {
    if (!it || typeof it !== 'object') continue
    if (it.sku) {
      const k = String(it.sku).trim().toLowerCase()
      if (k) bySku.set(k, it)
    }
    if (it.name != null && String(it.name).trim() !== '') {
      byName.set(String(it.name).trim().toLowerCase(), it)
    }
    if (it.item_id != null && it.item_id !== '') {
      byItemId.set(String(it.item_id).trim(), it)
    }
    // Index by Family custom field value (active items only — caller decides inactive policy)
    const family = parseFamilyFromZohoItem(it, familyFieldId)
    if (family) {
      const fk = family.trim().toLowerCase()
      if (!byFamily.has(fk)) byFamily.set(fk, [])
      byFamily.get(fk).push(it)
    }
  }
  return { bySku, byName, byItemId, byFamily }
}

/**
 * Returns all Zoho items that match a single `item_report_groups` member.
 *
 * Matching priority:
 *  1. sku field set on member — exact SKU match (single item)
 *  2. item_id field set on member — exact Zoho item_id match (single item)
 *  3. item_name — treated as a Zoho **Family custom field** value.
 *     "FL SHINE" returns every active Zoho item whose Family = "FL SHINE".
 *     Falls back to exact item-name match only if no family match is found.
 *
 * @param {object} member - row from item_report_groups
 * @param {{ bySku: Map, byName: Map, byItemId: Map, byFamily: Map }} maps
 * @returns {object[]}  may be empty
 */
function findZohoItemsForMember(member, maps) {
  if (!member || typeof member !== 'object') return []

  // 1. SKU — single unique match
  if (member.sku != null && String(member.sku).trim() !== '') {
    const item = maps.bySku.get(String(member.sku).trim().toLowerCase())
    return item ? [item] : []
  }

  // 2. item_id — single unique match
  if (member.item_id != null && String(member.item_id).trim() !== '') {
    const item = maps.byItemId.get(String(member.item_id).trim())
    return item ? [item] : []
  }

  // 3. item_name is the Zoho Family custom field value
  if (member.item_name != null && String(member.item_name).trim() !== '') {
    const needle = String(member.item_name).trim().toLowerCase()

    // 3a. Family field match — primary path ("FL SHINE" → all items where Family = "FL SHINE")
    if (maps.byFamily && maps.byFamily.has(needle)) {
      return maps.byFamily.get(needle)
    }

    // 3b. Exact item-name fallback (e.g. "APRON" is both the item name AND it might
    //     not have a Family value set in Zoho)
    const exact = maps.byName.get(needle)
    if (exact) return [exact]
  }

  return []
}

/** @deprecated single-result shim — use findZohoItemsForMember */
function findZohoItemForMember(member, maps) {
  return findZohoItemsForMember(member, maps)[0] || null
}

/**
 * Aggregates individual item-level rows (one per Zoho item) into one summary
 * row per family. Sums only currency / value fields (no qty columns).
 *
 * @param {object[]} itemRows - output of the main item-matching loop
 * @returns {object[]} one row per distinct family value, sorted by family name
 */
function aggregateByFamily(itemRows) {
  /** @type {Map<string, object>} family (lowercase key) → accumulator */
  const map = new Map()
  for (const row of itemRows) {
    const familyDisplay = row.family || '(no family)'
    const key = familyDisplay.toLowerCase()
    let acc = map.get(key)
    if (!acc) {
      acc = {
        family: familyDisplay,
        opening_stock: 0,
        closing_stock: 0,
        sales_amount: 0,
        purchase_amount: 0,
        returned_to_wholesale: 0,
      }
      map.set(key, acc)
    }
    acc.opening_stock += row.opening_stock == null || Number.isNaN(Number(row.opening_stock)) ? 0 : Number(row.opening_stock)
    acc.closing_stock += row.closing_stock || 0
    acc.sales_amount += row.sales_amount || 0
    acc.purchase_amount += row.purchase_amount || 0
    acc.returned_to_wholesale += row.returned_to_wholesale || 0
  }
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family))
}

/**
 * Fetches all Zoho items, then for each `item_report_groups` member in order
 * includes at most one report row if a matching Zoho line exists. Members with
 * no Zoho item are **omitted** (intersection only).
 *
 * @param {object[]} members - from listMembersOfGroup
 * @param {string} fromDate
 * @param {string} toDate
 * @param {object} [vendorConfig] - passed for future use (per-group policy)
 * @param {string} [reportGroup] - used to resolve `REPORT_VENDOR_*` / group vendor id
 * @returns {Promise<{ items: object[], reportMeta: { warnings: string[], transaction_debug?: object } }>}
 */
async function fetchZohoItemRowsForGroupMembers(
  members,
  fromDate,
  toDate,
  _vendorConfig = null,
  reportGroup = '',
  warehouseId = null
) {
  void _vendorConfig
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    const missing = Array.isArray(cfg.missing) ? cfg.missing : []
    const e = new Error(
      missing.length
        ? `Zoho source not configured. Missing env vars: ${missing.join(', ')} (org alias accepted: ZOHO_INVENTORY_ORGANIZATION_ID).`
        : `Zoho source not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ` +
            `ZOHO_REFRESH_TOKEN, and ${orgEnvHint()}.`
    )
    e.code = 'ZOHO_NOT_CONFIGURED'
    e.missing = missing
    throw e
  }
  const familyFieldId = cfg.familyCustomFieldId

  // Resolve vendor synchronously upfront so we can start all async fetches
  // in parallel immediately below.
  assertReportVendorResolvedIfRequired(reportGroup)
  const rv = getResolvedReportVendor(reportGroup)

  const warnings = []
  const onWarning = (w) => {
    if (w) warnings.push(enrichZohoWarning(w))
  }

  if (isReportVendorOptional() && !rv.vendorId && !rv.vendorName) {
    onWarning(
      'WEEKLY_REPORT_VENDOR_OPTIONAL=1: no REPORT_VENDOR_ID / group vendor / name — purchases and returned_to_wholesale are 0.'
    )
  }

  // Fetch items AND all transactions in parallel — items (20 pages, ~27s) used to
  // take 27 extra seconds before transactions could even start.  Running them
  // concurrently means total time = max(items, invoices) instead of items + invoices.
  const t0All = Date.now()
  const [raw, salesR, purchR, vcR] = await Promise.all([
    fetchAllItemsRaw(),
    getSales(fromDate, toDate, { onWarning, warehouseId }),
    getPurchases(fromDate, toDate, rv.vendorId, { vendorName: rv.vendorName, onWarning, warehouseId }),
    getVendorCredits(fromDate, toDate, rv.vendorId, { vendorName: rv.vendorName, onWarning }),
  ])
  console.log(
    `[zoho-timing] parallel fetch ${Date.now() - t0All}ms — ` +
    `items=${raw.length}, invoices=${salesR.document_count ?? 0}, ` +
    `bills=${purchR ? (purchR.document_count ?? 0) : 0}, ` +
    `vendorcredits=${vcR ? (vcR.document_count ?? 0) : 0}`
  )

  // If ZOHO_FAMILY_CUSTOMFIELD_ID is not set, scan the first 100 items for a
  // custom field with label "Family" and log the id once.
  if (!familyFieldId && Array.isArray(raw)) {
    const scan = raw.slice(0, 100)
    for (const item of scan) {
      const cfs = Array.isArray(item && item.custom_fields) ? item.custom_fields : []
      const cf = cfs.find((c) => c && c.label === 'Family')
      if (cf && cf.customfield_id) {
        console.log(
          '[zoho-family] auto-detected Family field id:',
          cf.customfield_id,
          '— set ZOHO_FAMILY_CUSTOMFIELD_ID=' + cf.customfield_id + ' in backend/.env'
        )
        break
      }
    }
  }

  const maps = buildZohoLookupMaps(raw, familyFieldId)
  const out = []
  const skipReasons = []
  for (const m of members) {
    const label = m.sku || m.item_name || m.item_id || '?'
    const zohoMatches = findZohoItemsForMember(m, maps)
    if (zohoMatches.length === 0) {
      skipReasons.push(`"${label}" — no Zoho match (no Family="${label}" items found)`)
      continue
    }
    for (const z of zohoMatches) {
      // Skip inactive items — report only active inventory
      if (z.status && String(z.status).toLowerCase() === 'inactive') continue
      const sk = typeof z.sku === 'string' ? z.sku.trim() : ''
      if (!sk) {
        skipReasons.push(`"${z.name || label}" — no SKU in Zoho`)
        continue
      }
      out.push(zohoItemToPlaceholderReportRow(z, fromDate, toDate, familyFieldId))
    }
  }

  console.log(
    `[weekly-report] group "${reportGroup}": ${members.length} DB members → ${out.length} Zoho rows` +
    (skipReasons.length ? ` | skipped: ${skipReasons.join(' | ')}` : '')
  )

  if (out.length === 0) {
    console.log(`[weekly-report] group "${reportGroup}": no active items matched — returning empty`)
    return { items: [], reportMeta: { warnings: [] } }
  }

  if (!familyFieldId) {
    const sampleCustomFields = Array.isArray(raw)
      ? (raw.find(
          (it) => it && Array.isArray(it.custom_fields) && it.custom_fields.length > 0
        ) || {}).custom_fields
      : null
    const sampleHint = Array.isArray(sampleCustomFields)
      ? ` Sample custom_fields on this org: [${sampleCustomFields
          .slice(0, 6)
          .map((c) => `${c.label || c.api_name || '?'}=${c.customfield_id || '?'}`)
          .join(', ')}].`
      : ''
    onWarning(
      'family is blank because ZOHO_FAMILY_CUSTOMFIELD_ID is not set. ' +
        'Find the Family field id in Zoho Inventory (Settings → Preferences → Items → Custom Fields, ' +
        'or inspect any item from GET /inventory/v1/items and look at custom_fields[].customfield_id ' +
        'whose label is "Family"), then set ZOHO_FAMILY_CUSTOMFIELD_ID in backend/.env and restart the backend.' +
        sampleHint
    )
  }

  const idToSku = buildItemIdToSkuMap(raw)

  if (salesR.error) {
    onWarning(`Sales (invoices) not loaded: ${(salesR.error && salesR.error.message) || salesR.error}`)
  }
  if (purchR && purchR.error) {
    onWarning(`Purchases (bills) not loaded: ${(purchR.error && purchR.error.message) || purchR.error}`)
  }
  if (vcR && vcR.error) {
    onWarning(`Vendor credits not loaded: ${(vcR && vcR.error && vcR.error.message) || vcR.error}`)
  }
  if (salesR.list_truncated || (purchR && purchR.list_truncated) || (vcR && vcR.list_truncated)) {
    onWarning('One or more Zoho list endpoints may be incomplete (pagination cap). Narrow the date range if totals look off.')
  }

  const salesLines = (salesR && salesR.lines) || []
  const purchLines = (purchR && purchR.lines) || []
  const retLines = (vcR && vcR.lines) || []
  const sm = sumLinesToMap(
    salesLines.map((a) => ({ item_id: a.item_id, name: a.name, quantity: a.quantity })),
    idToSku
  )
  const pm = sumLinesToMap(
    purchLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, quantity: a.quantity })),
    idToSku
  )
  const rm = sumLinesToMap(
    retLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, quantity: a.quantity })),
    idToSku
  )
  // Amount maps (currency): sum of item_total per item for sales and purchases
  const salesAmountMap = sumAmountsToMap(
    salesLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, item_total: a.item_total })),
    idToSku
  )
  const purchAmountMap = sumAmountsToMap(
    purchLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, item_total: a.item_total })),
    idToSku
  )
  const retAmountMap = sumAmountsToMap(
    retLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, item_total: a.item_total })),
    idToSku
  )

  for (const row of out) {
    applyTransactionMapsToRow(row, sm, pm, rm, salesAmountMap, purchAmountMap)
  }

  for (const row of out) {
    const cost = row._unit_cost != null && Number.isFinite(row._unit_cost) ? row._unit_cost : 0
    const qC = Number(row.closing_stock) || 0
    const p = Number(row.purchases) || 0
    const s = Number(row.sold) || 0
    const rQty = Number(row.returned_to_wholesale) || 0
    const rFromVc = mapLookupForReportRow(retAmountMap, row)
    const rMoney = rFromVc > 0 ? rFromVc : rQty * cost
    const qO = qC - p + s + rQty
    row.opening_stock = qO * cost
    row.closing_stock = qC * cost
    row.returned_to_wholesale = rMoney
    delete row.purchases
    delete row.sold
    delete row._unit_cost
  }

  // Collapse individual item rows into one summary row per family
  const familyRows = aggregateByFamily(out)
  console.log(
    `[weekly-report] group "${reportGroup}": aggregated ${out.length} item rows → ${familyRows.length} family rows`
  )

  const isDevDebug = process.env.NODE_ENV !== 'production' || process.env.WEEKLY_REPORT_VENDOR_DEBUG === '1'
  const reportMeta = {
    warnings: [...new Set(warnings)].filter(Boolean),
  }
  if (isDevDebug) {
    const vfa = !!(rv.vendorId || rv.vendorName)
    reportMeta.transaction_debug = {
      sales_source_count: salesLines.length,
      purchases_source_count: purchLines.length,
      credits_source_count: retLines.length,
      opening_stock_derived: true,
      vendor_filter_applied: vfa,
      report_vendor: { vendorId: rv.vendorId, vendorName: rv.vendorName, source: rv.source },
      sales: {
        list_truncated: !!(salesR && salesR.list_truncated),
        line_count: (salesR && salesR.line_count) ?? salesLines.length,
        sample_doc_ids: [...new Set(salesLines.map((l) => l && l.document_id).filter(Boolean))].slice(0, 12),
      },
      purchases: {
        list_truncated: !!(purchR && purchR.list_truncated),
        line_count: (purchR && purchR.line_count) ?? purchLines.length,
        sample_doc_ids: [...new Set(purchLines.map((l) => l && l.document_id).filter(Boolean))].slice(0, 12),
      },
      returned_to_wholesale: {
        list_truncated: !!(vcR && vcR.list_truncated),
        line_count: (vcR && vcR.line_count) ?? retLines.length,
        sample_doc_ids: [...new Set(retLines.map((l) => l && l.document_id).filter(Boolean))].slice(0, 12),
      },
    }
  }

  return { items: familyRows, reportMeta }
}

module.exports = {
  fetchZohoItemRowsForGroupMembers,
  ZOHO_WEEKLY_REPORT_INTEGRATION,
  /**
   * @see parseFamilyFromZohoItem
   */
  pickFamilyValue: parseFamilyFromZohoItem,
  _internals: {
    zohoItemToPlaceholderReportRow,
    parseZohoStockOnHand,
    parseZohoUnitCost,
    buildZohoLookupMaps,
    findZohoItemForMember,
    findZohoItemsForMember,
    aggregateByFamily,
    parseQty,
  },
}

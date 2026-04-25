/**
 * Weekly report rows from `zohoAdapter.fetchAllItemsRaw()`: primary data source
 * is the Zoho adapter (not Deluge webhooks).
 *
 * For each `item_report_groups` member, intersect with the Zoho catalog. **Family**
 * is display metadata. On-hand **quantities** come from Items; period movement (sold, purchases, returns) from
 * reports and vendor credits. The API then exposes **monetary** opening / closing and **purchase**
 * (period purchase qty × Zoho `rate`, same sales price as stock) plus **pre-tax** sales $ from Zoho Sales by Item (`amount` — no added VAT in code), etc.
 * If no unit can be resolved (Zoho `rate` / `purchase_rate`, or implied `sales_amount/sold` for the
 * item), opening / closing and purchase $ (when period purchase qty is positive) are `null`;
 * return $ uses vendor line total when present, else qty × `rate` with the same rule.
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
  selectRepresentativeZohoItemForFamily,
  getPinnedRepresentativeSkuForFamilyLabel,
  normalizeSkuKey,
} = require('./zohoRepresentativeItem')
const {
  getResolvedReportVendor,
  assertReportVendorResolvedIfRequired,
  isReportVendorOptional,
} = require('./weeklyReportReportVendor')
const { listAllActiveMemberRows } = require('./itemReportGroupsService')

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
 * Per-unit **selling** (list) price from the Zoho Inventory item (`rate`).
 * @param {object} item
 * @returns {number|null}
 */
function parseZohoUnitSalesPrice(item) {
  if (!item || typeof item !== 'object') return null
  const r = item.rate
  if (r == null || r === '') return null
  const n = parseQty(r)
  return n > 0 && Number.isFinite(n) ? n : null
}

/**
 * Zoho `purchase_rate` (cost) when the selling `rate` is empty — many orgs only fill one of them.
 * @param {object} item
 * @returns {number|null}
 */
function parseZohoUnitPurchasePrice(item) {
  if (!item || typeof item !== 'object') return null
  const r = item.purchase_rate
  if (r == null || r === '') return null
  const n = parseQty(r)
  return n > 0 && Number.isFinite(n) ? n : null
}

/**
 * Picks a positive unit price to turn quantities into $ for the weekly report: selling rate,
 * else purchase cost, else **implied** average from period `sales_amount / sold` (same item).
 * The implied path fixes rows where Zoho has sales but no item-level rate (e.g. LIFEP* SKUs).
 *
 * @param {object | null} item  raw Zoho item (from GET /items) or null
 * @param {{ sold?: number, sales_amount?: number }} row  same row after `applyTransactionMapsToRow`
 * @returns {number|null}
 */
function resolveUnitPriceForStockValuation(item, row) {
  if (item && typeof item === 'object') {
    const a = parseZohoUnitSalesPrice(item)
    if (a != null) return a
    const b = parseZohoUnitPurchasePrice(item)
    if (b != null) return b
  }
  const s = Number(row.sold) || 0
  const amt = Number(row.sales_amount) || 0
  if (s > 0 && amt > 0) {
    const u = amt / s
    return u > 0 && Number.isFinite(u) ? u : null
  }
  return null
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
  const unitSales = parseZohoUnitSalesPrice(zohoItem) ?? parseZohoUnitPurchasePrice(zohoItem)
  // stock fields are **quantities** until the value pass in `fetchZohoItemRowsForGroupMembers`
  const hasImage =
    zohoItem &&
    zohoItem.image_id != null &&
    zohoItem.image_id !== ''
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
    _unit_sales_price: unitSales,
    _zoho: {
      from_date: fromDate,
      to_date: toDate,
      family: n.family,
      has_image: !!hasImage,
      is_active: !zohoItem.status || String(zohoItem.status).toLowerCase() !== 'inactive',
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

const NOT_FOUND_IN_GROUPS_SUFFIX = ' (not found in groups)'

/**
 * @param {object} acc - family accumulator (has `family` display string)
 * @returns {string} key for `maps.byFamily` (Zoho family value, lowercased)
 */
function zohoByFamilyKeyFromAcc(acc) {
  if (!acc || acc.family == null) return ''
  let s = String(acc.family)
  if (s.endsWith(NOT_FOUND_IN_GROUPS_SUFFIX)) {
    s = s.slice(0, -NOT_FOUND_IN_GROUPS_SUFFIX.length).trim()
  }
  return s ? s.trim().toLowerCase() : ''
}

/**
 * Add every Zoho line in this Family to representative candidates (active + inactive, with or
 * without image). Selection uses `zohoRepresentativeItem.js` (text score + has_image + active + tiebreak).
 */
function mergeZohoFamilyRepCandidates(acc, byFamily, familyFieldId, fromDate, toDate) {
  if (!byFamily || typeof byFamily.get !== 'function' || !acc) return
  const fk = zohoByFamilyKeyFromAcc(acc)
  if (!fk) return
  const famItems = byFamily.get(fk)
  if (!Array.isArray(famItems) || famItems.length === 0) return
  const seen = new Set((acc._repCandidates || []).map((c) => c && c.iid).filter(Boolean))
  for (const z of famItems) {
    if (!z) continue
    const iid = z.item_id != null && String(z.item_id).trim() !== '' ? String(z.item_id).trim() : ''
    if (!iid || seen.has(iid)) continue
    const row = zohoItemToPlaceholderReportRow(z, fromDate, toDate, familyFieldId)
    acc._repCandidates.push({ iid, row })
    seen.add(iid)
  }
}

/**
 * Pinned LIFEP* family→SKU images must work even when that item is not indexed under
 * the same Zoho Family custom value (so it never appears in `mergeZohoFamilyRepCandidates`).
 * Resolve the SKU from the full `bySku` map and add one rep candidate.
 *
 * @param {object} acc
 * @param {{ byFamily?: Map, bySku?: Map, familyFieldId?: string | null, fromDate: string, toDate: string }} zohoCatalogCtx
 */
function mergePinnedThumbnailIfNeeded(acc, zohoCatalogCtx) {
  if (!acc || !zohoCatalogCtx || !zohoCatalogCtx.bySku) return
  const pin = getPinnedRepresentativeSkuForFamilyLabel(acc.family)
  if (!pin) return
  const want = normalizeSkuKey(pin)
  const cands = acc._repCandidates
  if (!cands) return
  if (cands.some((c) => c && c.row && normalizeSkuKey(c.row.sku) === want)) return
  const { bySku } = zohoCatalogCtx
  let z =
    (typeof bySku.get === 'function' && (bySku.get(String(pin).trim().toLowerCase()) || bySku.get(want))) || null
  if (!z) {
    for (const it of bySku.values()) {
      if (it && it.sku != null && normalizeSkuKey(String(it.sku)) === want) {
        z = it
        break
      }
    }
  }
  if (!z || z.item_id == null || String(z.item_id).trim() === '') return
  const iid = String(z.item_id).trim()
  if (cands.some((c) => c && c.iid === iid)) return
  const row = zohoItemToPlaceholderReportRow(
    z,
    zohoCatalogCtx.fromDate,
    zohoCatalogCtx.toDate,
    zohoCatalogCtx.familyFieldId != null ? zohoCatalogCtx.familyFieldId : null
  )
  cands.push({ iid, row })
}

/**
 * @param {object[]} itemRows - output of the main item-matching loop
 * @param {{ byFamily?: Map<string, object[]>, bySku?: Map<string, object>, familyFieldId?: string | null, fromDate?: string, toDate?: string } | null} [zohoCatalogCtx] - if set, every Zoho item in each family can contribute a thumbnail candidate, and pinned LIFEP* SKUs are merged from bySku if missing (item may be outside the Family field in Zoho)
 * @returns {object[]} one row per distinct family value, sorted by family name
 */
function aggregateByFamily(itemRows, zohoCatalogCtx = null) {
  /** @type {Map<string, object>} family (lowercase key) → accumulator */
  const map = new Map()
  const isUsable = (v) => v != null && !Number.isNaN(Number(v))
  for (const row of itemRows) {
    const familyDisplay = row._familyDisplayOverride || row.family || '(no family)'
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
        _openingN: 0,
        _closingN: 0,
        _returnedN: 0,
        _purchaseN: 0,
        _repAny: null,
        _repCandidates: /** @type {{ iid: string, row: object }[]} */ ([]),
      }
      map.set(key, acc)
    }
    const iid = row.item_id != null && String(row.item_id).trim() !== '' ? String(row.item_id).trim() : ''
    if (iid) {
      if (acc._repAny == null) acc._repAny = iid
      if (row._zoho) {
        const seen = new Set((acc._repCandidates || []).map((c) => c.iid))
        if (!seen.has(iid)) acc._repCandidates.push({ iid, row })
      }
    }
    if (isUsable(row.opening_stock)) {
      acc.opening_stock += Number(row.opening_stock)
      acc._openingN += 1
    }
    if (isUsable(row.closing_stock)) {
      acc.closing_stock += Number(row.closing_stock)
      acc._closingN += 1
    }
    if (isUsable(row.returned_to_wholesale)) {
      acc.returned_to_wholesale += Number(row.returned_to_wholesale)
      acc._returnedN += 1
    }
    if (isUsable(row.purchase_amount)) {
      acc.purchase_amount += Number(row.purchase_amount)
      acc._purchaseN += 1
    }
    acc.sales_amount += row.sales_amount || 0
  }
  if (zohoCatalogCtx && zohoCatalogCtx.fromDate && zohoCatalogCtx.toDate) {
    for (const acc of map.values()) {
      if (zohoCatalogCtx.byFamily) {
        mergeZohoFamilyRepCandidates(
          acc,
          zohoCatalogCtx.byFamily,
          zohoCatalogCtx.familyFieldId != null ? zohoCatalogCtx.familyFieldId : null,
          zohoCatalogCtx.fromDate,
          zohoCatalogCtx.toDate
        )
      }
      mergePinnedThumbnailIfNeeded(acc, zohoCatalogCtx)
    }
  }
  const out = []
  for (const acc of map.values()) {
    if (acc._openingN === 0) acc.opening_stock = null
    if (acc._closingN === 0) acc.closing_stock = null
    if (acc._returnedN === 0) acc.returned_to_wholesale = null
    if (acc._purchaseN === 0) acc.purchase_amount = null
    const rep = selectRepresentativeZohoItemForFamily(acc._repCandidates, { familyLabel: acc.family })
    acc.zoho_representative_item_id = rep.zoho_representative_item_id || acc._repAny || null
    acc.zoho_representative_sku = rep.zoho_representative_sku
    acc.zoho_representative_name = rep.zoho_representative_name
    if (rep.zoho_representative_score != null && Number.isFinite(Number(rep.zoho_representative_score))) {
      acc.zoho_representative_score = rep.zoho_representative_score
    }
    acc.zoho_representative_image_selection_version = rep.zoho_representative_image_selection_version
    if (
      process.env.WEEKLY_REPORT_ZOHO_REP_DEBUG === '1' ||
      (process.env.NODE_ENV !== 'production' && process.env.WEEKLY_REPORT_EXPOSE_REP_REASON === '1')
    ) {
      acc.zoho_representative_reason = rep.zoho_representative_reason
    }
    delete acc._repAny
    delete acc._repCandidates
    delete acc._openingN
    delete acc._closingN
    delete acc._returnedN
    delete acc._purchaseN
    out.push(acc)
  }
  return out.sort((a, b) => a.family.localeCompare(b.family))
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

  /**
   * For other_family "not in groups" Zoho families: a family is only unmapped if no **active**
   * `item_report_groups` row in **any** report_group (slow_moving, other_family, …) resolves to
   * at least one Zoho item with that Family — otherwise the family would repeat under other_family
   * even when it is only listed under e.g. slow_moving.
   */
  const claimedFamilyKeys = new Set()
  if (reportGroup === 'other_family') {
    const allGroupRows = await listAllActiveMemberRows()
    for (const m of allGroupRows) {
      const zohoMatches = findZohoItemsForMember(m, maps)
      for (const z of zohoMatches) {
        if (z.status && String(z.status).toLowerCase() === 'inactive') continue
        const fam = parseFamilyFromZohoItem(z, familyFieldId)
        if (fam && String(fam).trim() !== '') {
          claimedFamilyKeys.add(String(fam).trim().toLowerCase())
        }
      }
    }
  }

  const out = []
  const includedItemSkus = new Set()
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
      includedItemSkus.add(String(sk).trim().toLowerCase())
      out.push(zohoItemToPlaceholderReportRow(z, fromDate, toDate, familyFieldId))
    }
  }

  // other_family: Zoho families with no item_report_groups row in any group — label so ops can add mappings
  if (reportGroup === 'other_family' && maps.byFamily && maps.byFamily.size > 0) {
    let addedUnmapped = 0
    for (const [fk, famItems] of maps.byFamily) {
      if (claimedFamilyKeys.has(fk)) continue
      for (const z of famItems) {
        if (z.status && String(z.status).toLowerCase() === 'inactive') continue
        const sk = typeof z.sku === 'string' ? z.sku.trim() : ''
        if (!sk) continue
        const skL = String(sk).trim().toLowerCase()
        if (includedItemSkus.has(skL)) continue
        const row = zohoItemToPlaceholderReportRow(z, fromDate, toDate, familyFieldId)
        const base = (row.family && String(row.family).trim()) || fk
        row._familyDisplayOverride = `${base}${NOT_FOUND_IN_GROUPS_SUFFIX}`
        out.push(row)
        includedItemSkus.add(skL)
        addedUnmapped += 1
      }
    }
    if (addedUnmapped > 0) {
      console.log(
        `[weekly-report] group "other_family": +${addedUnmapped} Zoho item row(s) from families in no item_report_groups row in any group (label: …${NOT_FOUND_IN_GROUPS_SUFFIX})`
      )
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
  /** @type {Map<string, object>} */
  const skuToZohoItem = new Map()
  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (it && it.sku && String(it.sku).trim() !== '') {
        skuToZohoItem.set(String(it.sku).trim().toLowerCase(), it)
      }
    }
  }

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
  const salesAmountMap = sumAmountsToMap(
    salesLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, item_total: a.item_total })),
    idToSku
  )
  const retAmountMap = sumAmountsToMap(
    retLines.map((a) => ({ item_id: a.item_id, sku: a.sku, name: a.name, item_total: a.item_total })),
    idToSku
  )

  for (const row of out) {
    applyTransactionMapsToRow(row, sm, pm, rm, salesAmountMap, null)
  }

  for (const row of out) {
    const zItem = row.sku
      ? skuToZohoItem.get(String(row.sku).trim().toLowerCase()) || null
      : null
    const praw = resolveUnitPriceForStockValuation(zItem, row)
    const canValueStock = praw != null && Number.isFinite(praw) && praw > 0
    const unit = canValueStock ? praw : null
    const qC = Number(row.closing_stock) || 0
    const p = Number(row.purchases) || 0
    const s = Number(row.sold) || 0
    const rQty = Number(row.returned_to_wholesale) || 0
    const rFromVc = mapLookupForReportRow(retAmountMap, row)
    const qO = qC - p + s + rQty
    if (canValueStock) {
      row.opening_stock = qO * unit
      row.closing_stock = qC * unit
      row.purchase_amount = Math.round(p * unit * 100) / 100
    } else {
      row.opening_stock = null
      row.closing_stock = null
      row.purchase_amount = p > 0 ? null : 0
    }
    // Returned to wholesale: **vendor-credit quantity × same unit price as sales/stock** (Zoho
    // item `rate` / `purchase_rate`, else implied from period sales $ / sold). This matches
    // the Sales Amount column (pre-tax) logic. If no unit price, fall back to line total on the VC.
    if (rQty > 0) {
      if (canValueStock) {
        row.returned_to_wholesale = Math.round(rQty * unit * 100) / 100
      } else {
        row.returned_to_wholesale = rFromVc > 0 ? rFromVc : null
      }
    } else {
      row.returned_to_wholesale = 0
    }
    delete row.purchases
    delete row.sold
    delete row._unit_sales_price
  }

  // Collapse individual item rows into one summary row per family. Thumbnail rep id
  // also considers every Zoho item in the same Family (byFamily), not only group members.
  const familyRows = aggregateByFamily(out, {
    byFamily: maps.byFamily,
    bySku: maps.bySku,
    familyFieldId,
    fromDate,
    toDate,
  })
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
  NOT_FOUND_IN_GROUPS_SUFFIX,
  fetchZohoItemRowsForGroupMembers,
  ZOHO_WEEKLY_REPORT_INTEGRATION,
  /**
   * @see parseFamilyFromZohoItem
   */
  pickFamilyValue: parseFamilyFromZohoItem,
  _internals: {
    zohoItemToPlaceholderReportRow,
    parseZohoStockOnHand,
    parseZohoUnitSalesPrice,
    parseZohoUnitPurchasePrice,
    resolveUnitPriceForStockValuation,
    buildZohoLookupMaps,
    findZohoItemForMember,
    findZohoItemsForMember,
    aggregateByFamily,
    selectRepresentativeZohoItemForFamily: require('./zohoRepresentativeItem').selectRepresentativeZohoItemForFamily,
    scoreZohoNameSkuText: require('./zohoRepresentativeItem').scoreZohoNameSkuText,
    classifyRepresentativeType: require('./zohoRepresentativeItem').classifyRepresentativeType,
    extractCapacityLiters: require('./zohoRepresentativeItem').extractCapacityLiters,
    extractDiameterCm: require('./zohoRepresentativeItem').extractDiameterCm,
    extractRepresentativeSize: require('./zohoRepresentativeItem').extractRepresentativeSize,
    parseQty,
    NOT_FOUND_IN_GROUPS_SUFFIX,
  },
}

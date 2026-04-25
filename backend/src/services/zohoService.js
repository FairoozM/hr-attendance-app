/**
 * Zoho-sourced weekly inventory: `weeklyReportZohoData` uses the Zoho adapter
 * (Inventory REST) and `item_report_groups` as the only business membership
 * source. Rows are built by intersecting group members with Zoho items, then
 * strict validation (see `weeklyReportZohoData` for placeholder stock numbers).
 *
 * Vendor scoping for **credits** and **optional purchases** is loaded via
 * `weeklyReportVendorConfig` and passed to `fetchZohoItemRowsForGroupMembers` for
 * when period transactions are implemented; SOLD and stock are never vendor-filtered.
 *
 * The legacy Deluge path is not used; see `zohoDelugeWebhookAdapter.deprecated.js`
 * in integrations if referenced elsewhere.
 *
 * Error codes: see `docs/integrations-zoho.md` (e.g. ZOHO_NOT_CONFIGURED, ZOHO_OAUTH_ERROR,
 * ZOHO_API_TIMEOUT, ZOHO_API_ERROR, WEBHOOK_INVALID_RESPONSE for bad row data — name kept
 * for API stability)
 */

const { listMembersOfGroup } = require('./itemReportGroupsService')
const { fetchZohoItemRowsForGroupMembers } = require('./weeklyReportZohoData')
const { getVendorConfigForGroup } = require('./weeklyReportVendorConfig')

const MAX_REPORTED_ERRORS = 10
const NUMERIC_FIELDS = [
  'opening_stock',
  'closing_stock',
  'purchase_amount',
  'returned_to_wholesale',
  'sales_amount',
]

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function makeInvalidResponseError(errors) {
  const visible = errors.slice(0, MAX_REPORTED_ERRORS)
  const overflow = errors.length - visible.length
  const lines = visible.map((m, i) => `  ${i + 1}. ${m}`).join('\n')
  const tail  = overflow > 0 ? `\n  …and ${overflow} more validation error(s).` : ''
  const e = new Error(
    `Zoho data failed validation (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}${tail}`
  )
  e.code = 'WEBHOOK_INVALID_RESPONSE'
  e.validation_errors = errors
  return e
}

// ---------------------------------------------------------------------------
// Per-row validation + normalisation
// ---------------------------------------------------------------------------

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Null/absent in API mode = "column not available from this integration" (N/A in UI).
 * Omitted in old webhook rows meant "0"; new pipeline always sets all five keys.
 */
function validateNumericField(raw, field, rowLabel) {
  const v = raw[field]
  if (v === null) {
    return { value: null, error: null }
  }
  if (v === undefined) {
    return { value: 0, error: null }
  }
  if (isFiniteNumber(v)) {
    return { value: v, error: null }
  }
  return {
    value: 0,
    error:
      `${rowLabel}: field "${field}" must be a JSON number, null, or absent (for 0). ` +
      `Got ${typeof v}: ${JSON.stringify(v)}.`,
  }
}

/**
 * Validate + normalise a single report row.
 *
 * Supports two shapes:
 *  - **Family-level row** (new): `family` is the primary identifier, no `sku` required.
 *    Produced by `aggregateByFamily()` in weeklyReportZohoData.
 *  - **Item-level row** (legacy/fallback): `sku` is the primary identifier.
 *
 * A row is treated as family-level when `family` is present and `sku` is absent.
 *
 * Returns { item, errors }.
 */
function validateAndNormaliseItem(raw, index) {
  const errors = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      item: null,
      errors: [`items[${index}]: row must be a JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`],
    }
  }

  // Determine row type: family-level when family present and sku absent
  const isFamilyRow = raw.family != null && (raw.sku === undefined || raw.sku === null || raw.sku === '')

  let sku = ''
  if (!isFamilyRow) {
    const skuRaw = raw.sku
    if (skuRaw === undefined || skuRaw === null || skuRaw === '') {
      errors.push(`items[${index}]: "sku" is required and must be a non-empty string.`)
    } else if (typeof skuRaw !== 'string') {
      errors.push(`items[${index}]: "sku" must be a string. Got ${typeof skuRaw}.`)
    } else {
      sku = skuRaw.trim()
      if (!sku) {
        errors.push(`items[${index}]: "sku" must be a non-empty string after trimming.`)
      }
    }
  }

  const itemName =
    typeof raw.item_name === 'string' ? raw.item_name.trim() :
    typeof raw.item      === 'string' ? raw.item.trim()      :
    ''

  const itemId =
    typeof raw.item_id === 'string' ? raw.item_id.trim() :
    raw.item_id != null && raw.item_id !== '' ? String(raw.item_id).trim() :
    ''

  const rowLabel = isFamilyRow
    ? `items[${index}] (family="${String(raw.family || '').trim()}")`
    : `items[${index}] (sku="${sku || '?'}")`

  let family = ''
  if (raw.family === undefined) {
    if (!isFamilyRow) {
      // item-level rows: family is metadata, optional
      family = ''
    }
  } else if (raw.family === null) {
    errors.push(
      `items[${index}]: "family" must be a JSON string, not null (use "" if no Family).`
    )
  } else if (typeof raw.family !== 'string') {
    errors.push(
      `${rowLabel}: "family" must be a string (Zoho Family metadata). Got ${typeof raw.family}.`
    )
  } else {
    family = raw.family.trim()
  }

  // Family-level rows must have a non-empty family value
  if (isFamilyRow && !family) {
    errors.push(`items[${index}]: family-level row must have a non-empty "family" string.`)
  }

  const numeric = {}
  for (const field of NUMERIC_FIELDS) {
    const { value, error } = validateNumericField(raw, field, rowLabel)
    if (error) errors.push(error)
    numeric[field] = value
  }

  if (errors.length > 0) return { item: null, errors }

  const item = {
    family,
    ...numeric,
  }
  if (!isFamilyRow) {
    item.sku = sku
    item.item_name = itemName
    item.item_id = itemId
  } else {
    // aggregateByFamily sets this for Zoho product image lookup; do not drop it
    const zrid = raw.zoho_representative_item_id
    if (zrid != null && String(zrid).trim() !== '') {
      item.zoho_representative_item_id = String(zrid).trim()
    }
    const zsku = raw.zoho_representative_sku
    if (zsku != null && String(zsku).trim() !== '') {
      item.zoho_representative_sku = String(zsku).trim()
    }
    const zn = raw.zoho_representative_name
    if (zn != null && String(zn).trim() !== '') {
      item.zoho_representative_name = String(zn).trim()
    }
    const zver = raw.zoho_representative_image_selection_version
    if (zver != null && (typeof zver === 'number' || (typeof zver === 'string' && zver.trim() !== ''))) {
      item.zoho_representative_image_selection_version =
        typeof zver === 'number' ? zver : parseInt(String(zver).trim(), 10) || 0
    }
    const zreason = raw.zoho_representative_reason
    if (zreason != null && String(zreason).trim() !== '') {
      item.zoho_representative_reason = String(zreason).trim()
    }
    const zscore = raw.zoho_representative_score
    if (zscore != null && (typeof zscore === 'number' || (typeof zscore === 'string' && zscore.trim() !== ''))) {
      const n = typeof zscore === 'number' ? zscore : parseFloat(String(zscore).trim())
      if (Number.isFinite(n)) item.zoho_representative_score = n
    }
  }
  if (raw._zoho && typeof raw._zoho === 'object' && !Array.isArray(raw._zoho)) {
    item._zoho = {
      from_date: typeof raw._zoho.from_date === 'string' ? raw._zoho.from_date : undefined,
      to_date:   typeof raw._zoho.to_date   === 'string' ? raw._zoho.to_date   : undefined,
      family,
    }
  } else {
    item._zoho = { family }
  }
  return { item, errors: [] }
}

// ---------------------------------------------------------------------------
// Membership filter
// ---------------------------------------------------------------------------

function buildMatcher(members) {
  const skus  = new Set()
  const names = new Set()
  for (const m of members) {
    if (m.sku) {
      skus.add(String(m.sku).trim().toLowerCase())
    } else if (m.item_name) {
      names.add(String(m.item_name).trim().toLowerCase())
    }
  }
  return (item) => {
    if (item.sku && skus.has(item.sku.toLowerCase())) return true
    if (item.item_name && names.has(item.item_name.toLowerCase())) return true
    return false
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Membership first (`item_report_groups`), then Zoho-adapter data for matching
 * items only (intersection). Rows and grand totals in the API match this list.
 */
async function getInventoryByGroup(group, fromDate, toDate, warehouseId = null, excludeWarehouseId = null, options = {}) {
  const members = await listMembersOfGroup(group)
  // other_family: still call Zoho so we can list families that exist in Zoho but have no
  // item_report_groups row, with a "(not found in groups)" label (see weeklyReportZohoData).
  if (members.length === 0 && group !== 'other_family') {
    return { items: [], reportMeta: { warnings: [] } }
  }

  const vendorConfig = getVendorConfigForGroup(group)
  const { items: raw, reportMeta: fetchMeta, itemDetails } = await fetchZohoItemRowsForGroupMembers(
    members,
    fromDate,
    toDate,
    vendorConfig,
    group,
    warehouseId,
    excludeWarehouseId,
    options
  )

  const items = []
  const errors = []
  for (let i = 0; i < raw.length; i += 1) {
    const { item, errors: rowErrors } = validateAndNormaliseItem(raw[i], i)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      if (errors.length >= MAX_REPORTED_ERRORS) break
    } else {
      items.push(item)
    }
  }

  if (errors.length > 0) throw makeInvalidResponseError(errors)

  return {
    items,
    reportMeta: fetchMeta && typeof fetchMeta === 'object' ? fetchMeta : { warnings: [] },
    itemDetails: Array.isArray(itemDetails) ? itemDetails : [],
  }
}

/**
 * Item-level drill-down details for one family inside a report group/date range.
 */
async function getFamilyDetailsByGroup(
  group,
  family,
  fromDate,
  toDate,
  warehouseId = null,
  excludeWarehouseId = null
) {
  const familyKey = String(family || '').trim().toLowerCase()
  const members = await listMembersOfGroup(group)
  if (members.length === 0 && group !== 'other_family') {
    return { family, items: [] }
  }
  const vendorConfig = getVendorConfigForGroup(group)
  const { itemDetails = [] } = await fetchZohoItemRowsForGroupMembers(
    members,
    fromDate,
    toDate,
    vendorConfig,
    group,
    warehouseId,
    excludeWarehouseId,
    { includeItemDetails: true }
  )
  const items = itemDetails.filter((r) => String(r.family_display || r.family || '').trim().toLowerCase() === familyKey)
  return { family, items }
}

async function getSlowMovingInventory(fromDate, toDate) {
  const { items } = await getInventoryByGroup('slow_moving', fromDate, toDate)
  return items
}

module.exports = {
  getInventoryByGroup,
  getFamilyDetailsByGroup,
  getSlowMovingInventory,
  _internals: {
    validateAndNormaliseItem,
    buildMatcher,
  },
}

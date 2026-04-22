/**
 * Zoho-sourced weekly inventory: Zoho Inventory REST (OAuth + Items API) via
 * `weeklyReportZohoData`, then strict row validation, then `item_report_groups` membership.
 *
 * Business report groups (slow_moving, …) live only in `item_report_groups`. The
 * `family` field is Zoho metadata (see ZOHO_FAMILY_CUSTOMFIELD_ID).
 *
 * No Deluge / webhook. See docs/zoho-inventory-api-coverage.md for what the
 * public API can supply vs. the old Deluge "Inventory Summary" style numbers.
 *
 * Error codes: ZOHO_NOT_CONFIGURED, ZOHO_OAUTH_ERROR, ZOHO_API_ERROR, ZOHO_API_NETWORK_ERROR,
 * WEBHOOK_INVALID_RESPONSE (validation; name kept for API stability)
 */

const { listMembersOfGroup } = require('./itemReportGroupsService')
const { fetchZohoItemRowsUnfiltered } = require('./weeklyReportZohoData')

const MAX_REPORTED_ERRORS = 10
const NUMERIC_FIELDS = [
  'opening_stock',
  'purchases',
  'returned_to_wholesale',
  'closing_stock',
  'sold',
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
 * Validate + normalise a single item row. Drops internal `_zoho` keys.
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

  const skuRaw = raw.sku
  let sku = ''
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

  const itemName =
    typeof raw.item_name === 'string' ? raw.item_name.trim() :
    typeof raw.item      === 'string' ? raw.item.trim()      :
    ''

  const itemId =
    typeof raw.item_id === 'string' ? raw.item_id.trim() :
    raw.item_id != null && raw.item_id !== '' ? String(raw.item_id).trim() :
    ''

  const rowLabel = `items[${index}] (sku="${sku || '?'}")`

  let family = ''
  if (raw.family === undefined) {
    errors.push(
      `items[${index}]: "family" is required (Zoho Family metadata as a string; use "" if none).`
    )
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

  const numeric = {}
  for (const field of NUMERIC_FIELDS) {
    const { value, error } = validateNumericField(raw, field, rowLabel)
    if (error) errors.push(error)
    numeric[field] = value
  }

  if (errors.length > 0) return { item: null, errors }

  return {
    item: {
      sku,
      item_name: itemName,
      item_id:   itemId,
      family,
      ...numeric,
    },
    errors: [],
  }
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
 * Fetches all items from Zoho, validates rows, then filters to group members.
 */
async function getInventoryByGroup(group, fromDate, toDate) {
  const members = await listMembersOfGroup(group)
  if (members.length === 0) return []

  const raw = await fetchZohoItemRowsUnfiltered(fromDate, toDate)
  // Strip any internal fields before validate (defensive)
  const clean = raw.map((r) => {
    if (!r || typeof r !== 'object') return r
    const { _zoho, ...rest } = r
    return rest
  })

  const items   = []
  const errors  = []
  for (let i = 0; i < clean.length; i += 1) {
    const { item, errors: rowErrors } = validateAndNormaliseItem(clean[i], i)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      if (errors.length >= MAX_REPORTED_ERRORS) break
    } else {
      items.push(item)
    }
  }

  if (errors.length > 0) throw makeInvalidResponseError(errors)

  const match = buildMatcher(members)
  return items.filter(match)
}

async function getSlowMovingInventory(fromDate, toDate) {
  return getInventoryByGroup('slow_moving', fromDate, toDate)
}

module.exports = {
  getInventoryByGroup,
  getSlowMovingInventory,
  _internals: {
    validateAndNormaliseItem,
    buildMatcher,
  },
}

/**
 * Vendor scope for **transactional** weekly metrics: returned to wholesale
 * (vendor credits) and (optionally) purchases. **Sales and stock are never
 * vendor-filtered** — SOLD = all vendors; opening/closing = global item.
 *
 * Configuration is per `report_group` (future-proof) with flat env fallbacks
 * for single-tenant setups. **Prefer Zoho contact / vendor id** over name.
 *
 * @typedef {'unfiltered' | 'by_contact_id'} WeeklyReportPurchasesMode
 *
 * @typedef {object} GroupVendorConfig
 * @property {string} [vendor_credits_contact_id] — Zoho **contact** id to scope
 *   `returned_to_wholesale` to **Vendor Credit** lines for that contact only
 *   (credits from other vendors excluded).
 * @property {object} [purchases] — `mode: "unfiltered"` (default) or
 *   `by_contact_id` with `contact_id` when the business only counts purchases
 *   for one vendor. No filter on stock or sales.
 */

const EMPTY_CONFIG = {
  /** @type {string|undefined} */
  vendor_credits_contact_id: undefined,
  /** @type {{ mode: WeeklyReportPurchasesMode, contact_id?: string }|undefined} */
  purchases: undefined,
}

function readVendorsJsonMap() {
  const raw = process.env.WEEKLY_REPORT_VENDORS_JSON
  if (raw == null || String(raw).trim() === '') return {}
  try {
    const j = JSON.parse(String(raw))
    if (j && typeof j === 'object' && !Array.isArray(j)) return j
  } catch {
    // ignore; fall back to flat env
  }
  return {}
}

/**
 * Merged config for a report group. JSON keys per `report_group` override
 * global env fallbacks (`WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID`, purchases mode).
 */
function getVendorConfigForGroup(reportGroup) {
  const fromJson = readVendorsJsonMap()
  const g =
    (fromJson[reportGroup] && typeof fromJson[reportGroup] === 'object'
      ? { ...fromJson[reportGroup] }
      : {}) || {}

  const out = { ...EMPTY_CONFIG, ...g }

  const flatCredits = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  if (!out.vendor_credits_contact_id && flatCredits != null && String(flatCredits).trim() !== '') {
    out.vendor_credits_contact_id = String(flatCredits).trim()
  }

  if (!out.purchases) {
    const mode = (process.env.WEEKLY_REPORT_PURCHASES_MODE || 'unfiltered').toLowerCase()
    const pContact = process.env.WEEKLY_REPORT_PURCHASES_CONTACT_ID
    if (mode === 'by_contact_id' && pContact != null && String(pContact).trim() !== '') {
      out.purchases = { mode: 'by_contact_id', contact_id: String(pContact).trim() }
    } else {
      out.purchases = { mode: 'unfiltered' }
    }
  } else if (typeof out.purchases === 'object' && out.purchases !== null) {
    const m = (out.purchases.mode || 'unfiltered').toLowerCase()
    if (m !== 'unfiltered' && m !== 'by_contact_id') {
      out.purchases = { mode: 'unfiltered' }
    } else if (m === 'by_contact_id' && (out.purchases.contact_id == null || String(out.purchases.contact_id).trim() === '')) {
      out.purchases = { mode: 'unfiltered' }
    } else {
      out.purchases = { mode: m, ...out.purchases }
    }
  } else {
    out.purchases = { mode: 'unfiltered' }
  }

  return out
}

/**
 * @param {object} vendorConfig
 * @param {string} [reportGroup] — if set, per-group `vendor_credits_contact_id` is read
 * @returns {{ sold: boolean, returned_to_wholesale: boolean, purchases: boolean }}
 */
function buildFilterAppliedObject(vendorConfig, reportGroup) {
  const c =
    reportGroup && typeof reportGroup === 'string' && reportGroup
      ? getVendorConfigForGroup(reportGroup)
      : vendorConfig || {}
  const creditsId = c && c.vendor_credits_contact_id
  const credits = typeof creditsId === 'string' && String(creditsId).trim() !== ''
  const p = c && c.purchases
  const purchasesByContact =
    p &&
    p.mode === 'by_contact_id' &&
    typeof p.contact_id === 'string' &&
    String(p.contact_id).trim() !== ''
  const eid = process.env.REPORT_VENDOR_ID && String(process.env.REPORT_VENDOR_ID).trim()
  const ename = process.env.REPORT_VENDOR_NAME && String(process.env.REPORT_VENDOR_NAME).trim()
  const fromEnv = !!(eid || ename)
  const vendorScopable = credits || fromEnv
  return {
    sold: false,
    returned_to_wholesale: vendorScopable,
    purchases: vendorScopable || purchasesByContact,
  }
}

/**
 * @param {string} reportGroup
 * @returns {object|undefined} Only present when `shouldIncludeVendorFilterDebug()`.
 */
function getVendorFilterDebugForGroup(reportGroup) {
  return { filter_applied: buildFilterAppliedObject(null, reportGroup) }
}

function shouldIncludeVendorFilterDebug() {
  if (process.env.WEEKLY_REPORT_VENDOR_DEBUG === '1') return true
  if (process.env.NODE_ENV === 'production') return false
  return true
}

function mergeZohoWithVendorContext(zohoBase, reportGroup) {
  const o = { ...zohoBase }
  if (shouldIncludeVendorFilterDebug() && reportGroup) {
    o.vendor_filter_debug = getVendorFilterDebugForGroup(reportGroup)
  }
  return o
}

module.exports = {
  getVendorConfigForGroup,
  getVendorFilterDebugForGroup,
  shouldIncludeVendorFilterDebug,
  mergeZohoWithVendorContext,
  _internals: { buildFilterAppliedObject, readVendorsJsonMap },
}

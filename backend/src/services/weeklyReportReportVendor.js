/**
 * Resolves the single wholesale / report vendor for **purchases** and
 * **returned to wholesale (vendor credits)**. Prefer contact/vendor id;
 * `REPORT_VENDOR_NAME` is matched case-insensitively on `vendor_id` or `vendor_name`
 * fields returned by Zoho.
 *
 * Integrates with `WEEKLY_REPORT_VENDORS_JSON` / per-group
 * `vendor_credits_contact_id` from `weeklyReportVendorConfig` when
 * `REPORT_VENDOR_ID` is unset.
 */

const { getVendorConfigForGroup } = require('./weeklyReportVendorConfig')

/**
 * @typedef {object} ReportVendor
 * @property {string|undefined} vendorId - Zoho vendor/contact id
 * @property {string|undefined} vendorName - used when vendorId is absent
 * @property {string} source - for logs only
 */

/**
 * @param {string} reportGroup
 * @returns {ReportVendor}
 */
function getResolvedReportVendor(reportGroup) {
  const eid = process.env.REPORT_VENDOR_ID && String(process.env.REPORT_VENDOR_ID).trim()
  if (eid) {
    return { vendorId: eid, vendorName: undefined, source: 'REPORT_VENDOR_ID' }
  }
  const g = getVendorConfigForGroup(reportGroup)
  if (g.vendor_credits_contact_id) {
    return { vendorId: String(g.vendor_credits_contact_id).trim(), vendorName: undefined, source: 'WEEKLY_REPORT_VENDORS_JSON' }
  }
  const ename = process.env.REPORT_VENDOR_NAME && String(process.env.REPORT_VENDOR_NAME).trim()
  if (ename) {
    return { vendorId: undefined, vendorName: ename, source: 'REPORT_VENDOR_NAME' }
  }
  return { vendorId: undefined, vendorName: undefined, source: 'none' }
}

/**
 * When `true`, missing `REPORT_VENDOR_ID` (and no per-group / name fallback) only
 * yields a warning and zero purch/credits (not for production).
 * When `false` (default), a non-empty report with no resolved vendor returns 400
 * `REPORT_VENDOR_NOT_CONFIGURED`.
 */
function isReportVendorOptional() {
  return String(process.env.WEEKLY_REPORT_VENDOR_OPTIONAL || '').trim() === '1'
}

/**
 * @param {string} reportGroup
 * @throws {Error} code `REPORT_VENDOR_NOT_CONFIGURED` if vendor required but missing
 */
function assertReportVendorResolvedIfRequired(reportGroup) {
  if (isReportVendorOptional()) return
  const r = getResolvedReportVendor(reportGroup)
  if (r.vendorId || r.vendorName) return
  const e = new Error(
    'REPORT_VENDOR_ID is not set. Set it to your Zoho `vendor_id` (e.g. 4265011000000080014) ' +
      'for bills and vendor credits, or set `vendor_credits_contact_id` in WEEKLY_REPORT_VENDORS_JSON for this group, ' +
      'or REPORT_VENDOR_NAME. For local tests only, set WEEKLY_REPORT_VENDOR_OPTIONAL=1.'
  )
  e.code = 'REPORT_VENDOR_NOT_CONFIGURED'
  throw e
}

/** @deprecated use isReportVendorOptional; inverse of old REPORT_VENDOR_STRICT=1 */
function isReportVendorStrictlyRequired() {
  return !isReportVendorOptional()
}

module.exports = {
  getResolvedReportVendor,
  isReportVendorOptional,
  assertReportVendorResolvedIfRequired,
  isReportVendorStrictlyRequired,
}

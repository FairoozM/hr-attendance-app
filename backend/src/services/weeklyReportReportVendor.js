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
 * yields a warning and zero purch/credits.
 *
 * Production safety: in `NODE_ENV=production` the flag is honored only when
 * `WEEKLY_REPORT_VENDOR_OPTIONAL_ALLOW_PROD=1` is also set, so a stray
 * `WEEKLY_REPORT_VENDOR_OPTIONAL=1` in a prod environment cannot silently
 * publish zero-vendor reports.
 *
 * When `false` (default), a non-empty report with no resolved vendor returns 400
 * `REPORT_VENDOR_NOT_CONFIGURED`.
 */
function isReportVendorOptional() {
  const on = String(process.env.WEEKLY_REPORT_VENDOR_OPTIONAL || '').trim() === '1'
  if (!on) return false
  if (process.env.NODE_ENV === 'production') {
    const allow =
      String(process.env.WEEKLY_REPORT_VENDOR_OPTIONAL_ALLOW_PROD || '').trim() === '1'
    return allow
  }
  return true
}

function getOptionalFlagDecision() {
  const flag = String(process.env.WEEKLY_REPORT_VENDOR_OPTIONAL || '').trim() === '1'
  const allowProd =
    String(process.env.WEEKLY_REPORT_VENDOR_OPTIONAL_ALLOW_PROD || '').trim() === '1'
  const isProd = process.env.NODE_ENV === 'production'
  return {
    flag,
    allowProd,
    isProd,
    effective: flag && (!isProd || allowProd),
    suppressedInProd: flag && isProd && !allowProd,
  }
}

/**
 * @param {string} reportGroup
 * @throws {Error} code `REPORT_VENDOR_NOT_CONFIGURED` if vendor required but missing
 */
function assertReportVendorResolvedIfRequired(reportGroup) {
  if (isReportVendorOptional()) return
  const r = getResolvedReportVendor(reportGroup)
  if (r.vendorId || r.vendorName) return

  const decision = getOptionalFlagDecision()
  const tried = []
  if (!process.env.REPORT_VENDOR_ID) tried.push('REPORT_VENDOR_ID (unset)')
  if (!process.env.REPORT_VENDOR_NAME) tried.push('REPORT_VENDOR_NAME (unset)')
  tried.push(`vendor_credits_contact_id for group "${reportGroup}" in WEEKLY_REPORT_VENDORS_JSON (none)`)

  const localHint =
    'For local development, set WEEKLY_REPORT_VENDOR_OPTIONAL=1 in backend/.env and restart the backend ' +
    '(node --watch does not reload .env).'
  const prodHint = decision.suppressedInProd
    ? 'WEEKLY_REPORT_VENDOR_OPTIONAL=1 was set but is being ignored because NODE_ENV=production. ' +
      'To opt-in for production explicitly, also set WEEKLY_REPORT_VENDOR_OPTIONAL_ALLOW_PROD=1.'
    : ''

  const e = new Error(
    [
      'REPORT_VENDOR_NOT_CONFIGURED: no report vendor could be resolved.',
      `Tried: ${tried.join('; ')}.`,
      'Fix in production by setting REPORT_VENDOR_ID to your Zoho `vendor_id` (e.g. 4265011000000080014), ' +
        'or REPORT_VENDOR_NAME, or `vendor_credits_contact_id` in WEEKLY_REPORT_VENDORS_JSON for this group.',
      localHint,
      prodHint,
    ]
      .filter(Boolean)
      .join(' ')
  )
  e.code = 'REPORT_VENDOR_NOT_CONFIGURED'
  e.tried = tried
  e.optionalFlag = decision
  throw e
}

/** @deprecated use isReportVendorOptional; inverse of old REPORT_VENDOR_STRICT=1 */
function isReportVendorStrictlyRequired() {
  return !isReportVendorOptional()
}

module.exports = {
  getResolvedReportVendor,
  isReportVendorOptional,
  getOptionalFlagDecision,
  assertReportVendorResolvedIfRequired,
  isReportVendorStrictlyRequired,
}

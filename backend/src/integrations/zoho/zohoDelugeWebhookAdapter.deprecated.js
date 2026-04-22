/**
 * @fileoverview **Deprecated** — Zoho Deluge / custom function webhooks as the
 * “report engine” for weekly inventory. The app no longer fetches report rows this way.
 *
 * Primary integration: OAuth + `GET /inventory/v1/items` through
 * `zohoAdapter.js` → `zohoInventoryClient.js`. Historical contract:
 * `docs/weekly-reports-zoho-webhook.md` (archival).
 *
 * This file exists only to document the old surface. Nothing in the runtime
 * weekly report path imports it.
 */

/**
 * @deprecated
 * @returns {never}
 */
function assertDelugeReportEngineRemoved() {
  const e = new Error(
    'Zoho Deluge custom-function report fetch is not available. ' +
    'Use ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, and ' +
    'ZOHO_ORGANIZATION_ID (see .env.example).',
  )
  e.code = 'ZohoDelugeReportDeprecated'
  throw e
}

module.exports = {
  assertDelugeReportEngineRemoved,
}

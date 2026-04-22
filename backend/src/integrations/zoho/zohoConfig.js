/**
 * Zoho Inventory API + OAuth configuration (env).
 * See docs/zoho-inventory-api-coverage.md for what the public API can and
 * cannot supply for weekly report columns.
 */

const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_ACCOUNTS_BASE = 'https://accounts.zoho.com'
const DEFAULT_API_BASE = 'https://www.zohoapis.com'
const INVENTORY_V1 = '/inventory/v1'

/**
 * @returns {object|{ code: 'ZOHO_NOT_CONFIGURED' }}
 */
function readZohoInventoryConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID
  const clientSecret = process.env.ZOHO_CLIENT_SECRET
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN
  const organizationId = process.env.ZOHO_INVENTORY_ORGANIZATION_ID

  if (!clientId || !clientSecret || !refreshToken || !organizationId) {
    return {
      code: 'ZOHO_NOT_CONFIGURED',
    }
  }

  return {
    code: 'ok',
    clientId: String(clientId).trim(),
    clientSecret: String(clientSecret).trim(),
    refreshToken: String(refreshToken).trim(),
    organizationId: String(organizationId).trim(),
    accountsBase: (process.env.ZOHO_ACCOUNTS_BASE || DEFAULT_ACCOUNTS_BASE).replace(/\/$/, ''),
    apiBase: (process.env.ZOHO_INVENTORY_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    familyCustomFieldId: process.env.ZOHO_FAMILY_CUSTOMFIELD_ID
      ? String(process.env.ZOHO_FAMILY_CUSTOMFIELD_ID).trim()
      : null,
    timeoutMs: Math.max(1000, Number(process.env.ZOHO_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  }
}

function isConfigured() {
  const c = readZohoInventoryConfig()
  return c.code === 'ok'
}

module.exports = {
  readZohoInventoryConfig,
  isConfigured,
  INVENTORY_V1,
  DEFAULT_TIMEOUT_MS,
}

/**
 * Zoho Inventory API + OAuth — env-based configuration.
 *
 * Primary variable names (use these in new deployments):
 *   ZOHO_ORGANIZATION_ID, ZOHO_API_BASE_URL
 * Legacy aliases remain supported: ZOHO_INVENTORY_ORGANIZATION_ID, ZOHO_INVENTORY_API_BASE
 *
 * See docs/integrations-zoho.md and docs/zoho-inventory-api-coverage.md.
 */

const DEFAULT_TIMEOUT_MS = 45000
const DEFAULT_ACCOUNTS_BASE = 'https://accounts.zoho.com'
const DEFAULT_API_BASE = 'https://www.zohoapis.com'
const INVENTORY_V1 = '/inventory/v1'

/**
 * @returns {{ code: 'ok', clientId: string, clientSecret: string, refreshToken: string, organizationId: string, accountsBase: string, apiBase: string, redirectUri: string | null, familyCustomFieldId: string | null, timeoutMs: number } | { code: 'ZOHO_NOT_CONFIGURED', missing: string[] }}
 */
function readZohoConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID
  const clientSecret = process.env.ZOHO_CLIENT_SECRET
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN
  const organizationId =
    process.env.ZOHO_ORGANIZATION_ID || process.env.ZOHO_INVENTORY_ORGANIZATION_ID
  const missing = []
  if (!clientId) missing.push('ZOHO_CLIENT_ID')
  if (!clientSecret) missing.push('ZOHO_CLIENT_SECRET')
  if (!refreshToken) missing.push('ZOHO_REFRESH_TOKEN')
  if (!organizationId) missing.push('ZOHO_ORGANIZATION_ID')
  if (missing.length) {
    return { code: 'ZOHO_NOT_CONFIGURED', missing }
  }
  const apiBaseRaw =
    process.env.ZOHO_API_BASE_URL || process.env.ZOHO_INVENTORY_API_BASE || DEFAULT_API_BASE
  return {
    code: 'ok',
    clientId: String(clientId).trim(),
    clientSecret: String(clientSecret).trim(),
    refreshToken: String(refreshToken).trim(),
    organizationId: String(organizationId).trim(),
    accountsBase: (process.env.ZOHO_ACCOUNTS_BASE || DEFAULT_ACCOUNTS_BASE).replace(/\/$/, ''),
    apiBase: String(apiBaseRaw).replace(/\/$/, ''),
    redirectUri: process.env.ZOHO_REDIRECT_URI
      ? String(process.env.ZOHO_REDIRECT_URI).trim()
      : null,
    familyCustomFieldId: process.env.ZOHO_FAMILY_CUSTOMFIELD_ID
      ? String(process.env.ZOHO_FAMILY_CUSTOMFIELD_ID).trim()
      : null,
    timeoutMs: Math.max(1000, Number(process.env.ZOHO_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  }
}

/** @deprecated use readZohoConfig — alias for backward compatibility */
const readZohoInventoryConfig = readZohoConfig

function isConfigured() {
  return readZohoConfig().code === 'ok'
}

function orgEnvHint() {
  return 'ZOHO_ORGANIZATION_ID (or legacy ZOHO_INVENTORY_ORGANIZATION_ID)'
}

module.exports = {
  readZohoConfig,
  readZohoInventoryConfig,
  isConfigured,
  orgEnvHint,
  INVENTORY_V1,
  DEFAULT_TIMEOUT_MS,
}

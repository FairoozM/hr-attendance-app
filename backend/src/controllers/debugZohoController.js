/**
 * TEMPORARY — remove when Zoho integration is stable.
 * GET /api/debug/zoho/items
 *
 * Calls `zohoAdapter.getItems()` and `fetchAllItemsRaw()` (parallel). Rows are
 * merged by index: name/sku/family from getItems, stock and custom_fields from
 * the raw Zoho object (getItems does not return those). Large orgs: two full
 * list scans — remove this endpoint in production once stable.
 */

const { getItems, fetchAllItemsRaw, readZohoConfig, orgEnvHint } = require('../integrations/zoho/zohoAdapter')
const { parseFamilyFromZohoItem } = require('../integrations/zoho/zohoItemFamily')

const PREVIEW = 20

/**
 * @param {object} item
 * @returns {number | string | null}
 */
function stockOnHandField(item) {
  if (!item || typeof item !== 'object') return null
  const v =
    item.stock_on_hand != null
      ? item.stock_on_hand
      : item.available_stock != null
        ? item.available_stock
        : item.available_for_sale
  if (v === undefined || v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : v
  }
  return v
}

/**
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 */
async function getZohoDebugItems(_req, res) {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    return res.status(503).json({
      error: 'Zoho is not configured for this server.',
      code: 'ZOHO_NOT_CONFIGURED',
      detail: `Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, and ${orgEnvHint()}.`,
    })
  }
  const familyFieldId = cfg.familyCustomFieldId
  try {
    const [normalized, raw] = await Promise.all([getItems(), fetchAllItemsRaw()])
    const n = Math.min(PREVIEW, normalized.length, Array.isArray(raw) ? raw.length : 0)
    if (n === 0) {
      return res.json({
        items: [],
        count: 0,
        total_in_zoho: Array.isArray(raw) ? raw.length : 0,
        limited_to: PREVIEW,
        note: 'Zoho returned no items (or getItems/ raw lists were empty).',
      })
    }
    const items = []
    for (let i = 0; i < n; i += 1) {
      const m = normalized[i]
      const r = raw[i]
      items.push({
        name: m && typeof m.name === 'string' ? m.name : '',
        sku: m && typeof m.sku === 'string' ? m.sku : '',
        stock_on_hand: stockOnHandField(r),
        custom_fields: r && Array.isArray(r.custom_fields) ? r.custom_fields : [],
        // Prefer adapter getItems() family; fallback parse from raw (should match)
        family:
          m && typeof m.family === 'string' ? m.family : parseFamilyFromZohoItem(r, familyFieldId),
      })
    }
    return res.json({
      items,
      count: items.length,
      total_in_zoho: raw.length,
      limited_to: PREVIEW,
    })
  } catch (err) {
    return sendZohoDebugError(res, err)
  }
}

/**
 * @param {import('express').Response} res
 * @param {Error & { code?: string, oauth?: object, httpStatus?: number, zohoPath?: string, zohoResponse?: object, cause?: Error }} err
 */
function sendZohoDebugError(res, err) {
  const code = err.code || 'UNKNOWN'
  if (code === 'ZOHO_OAUTH_ERROR') {
    return res.status(502).json({
      error: 'Zoho authentication failed. The refresh token may be invalid or revoked, or client id/secret may be wrong.',
      code: 'ZOHO_OAUTH_ERROR',
      detail: err.message,
      oauth: err.oauth || null,
    })
  }
  if (code === 'ZOHO_NOT_CONFIGURED') {
    return res.status(503).json({
      error: 'Zoho is not configured for this server.',
      code: 'ZOHO_NOT_CONFIGURED',
      detail: `Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, and ${orgEnvHint()}.`,
    })
  }
  if (code === 'ZOHO_API_TIMEOUT') {
    return res.status(504).json({
      error: 'Zoho API request timed out.',
      code: 'ZOHO_API_TIMEOUT',
      detail: err.message,
    })
  }
  if (code === 'ZOHO_API_NETWORK_ERROR') {
    return res.status(502).json({
      error: 'Network error calling Zoho.',
      code: 'ZOHO_API_NETWORK_ERROR',
      detail: err.message,
    })
  }
  if (code === 'ZOHO_API_ERROR') {
    return res.status(502).json({
      error: 'Zoho API returned an error (raw payload for debugging).',
      code: 'ZOHO_API_ERROR',
      detail: err.message,
      zoho: {
        httpStatus: err.httpStatus ?? null,
        path: err.zohoPath ?? null,
        response: err.zohoResponse != null ? err.zohoResponse : null,
        cause: err.cause && err.cause.message ? err.cause.message : null,
      },
    })
  }
  console.error('[debugZoho] unexpected error:', err)
  return res.status(502).json({
    error: 'Unexpected Zoho error.',
    code,
    detail: err.message,
  })
}

module.exports = { getZohoDebugItems, sendZohoDebugError, stockOnHandField }

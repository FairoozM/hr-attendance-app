/** Prevent repeating the auto-detect log on every item when no env var is set. */
let _familyIdLoggedOnce = false

/**
 * Zoho Inventory item: parse the "Family" value from the `custom_fields` array.
 *
 * Lookup order:
 *  1. If `ZOHO_FAMILY_CUSTOMFIELD_ID` is set, match by `customfield_id` exactly (fast, stable).
 *  2. Otherwise, fall back to the first field whose `label` equals "Family" (case-sensitive).
 *     Logs the discovered `customfield_id` exactly once per process so you can promote it to
 *     the env var.
 *
 * @param {object} item - raw Zoho `items` API object
 * @param {string | null} familyFieldId - `readZohoConfig().familyCustomFieldId`
 * @returns {string} trimmed value or ""
 */
function parseFamilyFromZohoItem(item, familyFieldId) {
  if (!item) return ''

  // Fast path: the Zoho /items list endpoint flattens custom fields directly
  // onto each item object as `cf_<fieldname>` (e.g. `cf_family`).
  // This is the normal case when working with paginated item lists.
  if (item.cf_family != null && item.cf_family !== '') {
    return String(item.cf_family).trim()
  }

  // Slow path: individual item GET responses include a `custom_fields` array.
  const custom = item.custom_fields
  if (!Array.isArray(custom) || custom.length === 0) return ''
  if (familyFieldId) {
    const f = custom.find(
      (c) => c && String(c.customfield_id) === String(familyFieldId),
    )
    if (f && f.value != null && f.value !== '') {
      return String(f.value).trim()
    }
    return ''
  }
  // Label-based fallback: find the first custom field with label === "Family".
  const f = custom.find((c) => c && c.label === 'Family')
  if (!f) return ''
  const val = f.value != null && f.value !== '' ? String(f.value).trim() : ''
  if (f.customfield_id && !_familyIdLoggedOnce) {
    _familyIdLoggedOnce = true
    console.log(
      '[zoho-family] auto-detected Family field id:',
      f.customfield_id,
      '— set ZOHO_FAMILY_CUSTOMFIELD_ID=' + f.customfield_id + ' in backend/.env to suppress this log',
    )
  }
  return val
}

/** Reset the one-time log flag (for tests only). */
function _resetFamilyIdLoggedOnce() {
  _familyIdLoggedOnce = false
}

/**
 * Phase-1 normalized inventory item (no weekly-report period fields).
 *
 * @param {object} raw - raw Zoho item from GET /inventory/v1/items
 * @param {string | null} familyFieldId
 * @returns {{ item_id: string, sku: string, name: string, family: string }}
 */
function normalizeZohoInventoryItem(raw, familyFieldId) {
  const z = raw || {}
  const sku = typeof z.sku === 'string' ? z.sku.trim() : ''
  const name = typeof z.name === 'string' ? z.name.trim() : ''
  const iid = z.item_id
  const itemId = iid == null || iid === '' ? '' : String(iid)
  const family = parseFamilyFromZohoItem(z, familyFieldId)
  return {
    item_id: itemId,
    sku,
    name,
    family,
  }
}

module.exports = { parseFamilyFromZohoItem, normalizeZohoInventoryItem, _resetFamilyIdLoggedOnce }

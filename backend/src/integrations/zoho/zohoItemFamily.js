/**
 * Zoho Inventory item: parse the "Family" value from the `custom_fields` array.
 * Requires `ZOHO_FAMILY_CUSTOMFIELD_ID` in env (via config) to match a field; if
 * unset, we cannot select a field by id and return "" (see adapter JSDoc).
 *
 * @param {object} item - raw Zoho `items` API object
 * @param {string | null} familyFieldId - `readZohoConfig().familyCustomFieldId`
 * @returns {string} trimmed value or ""
 */
function parseFamilyFromZohoItem(item, familyFieldId) {
  const custom = item && item.custom_fields
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
  return ''
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

module.exports = { parseFamilyFromZohoItem, normalizeZohoInventoryItem }

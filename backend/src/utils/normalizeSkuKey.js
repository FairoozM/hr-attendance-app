/**
 * Canonical match key for SKU Channel Coverage (Zoho ↔ Amazon ↔ Noon).
 * Exact matching only — no fuzzy product-name logic.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSkuKey(value) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  return raw.replace(/\s+/g, ' ').toUpperCase()
}

module.exports = {
  normalizeSkuKey,
}

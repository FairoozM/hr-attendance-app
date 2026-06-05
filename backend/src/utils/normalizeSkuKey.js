const { normalizeSku } = require('./normalizeSku')

/**
 * Canonical match key for SKU Channel Coverage (Zoho ↔ Amazon ↔ Noon).
 * Uses the same normalization as Amazon/Zoho stock comparison (Unicode dashes, etc.).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSkuKey(value) {
  const key = normalizeSku(value)
  return key || null
}

module.exports = {
  normalizeSkuKey,
}

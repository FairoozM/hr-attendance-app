/**
 * Canonical SKU key for Amazon/Zoho/Vigil joins.
 * Listings reports often use Unicode dashes (– —) while FBA API returns ASCII (-).
 */
function normalizeSku(sku) {
  return String(sku == null ? '' : sku)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

module.exports = {
  normalizeSku,
}

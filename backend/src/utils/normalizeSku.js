function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase()
}

module.exports = {
  normalizeSku,
}

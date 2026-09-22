/**
 * Zoho's base currency is AED, so every ledger figure must be AED.
 *
 * Zoho documents carry their own currency (KSA invoices are SAR) plus an
 * exchange_rate, and the document itself stores the posted base-currency
 * amount in bcy_* fields. Zoho reports (salesbycustomer, P&L, Expense by
 * Category) are already base currency, which is why opening and closing
 * balances are AED — raw `total` from a list endpoint is not.
 */

const { clean, toNumber, round2 } = require('./accountNature')

const BASE_CURRENCY_CODE = (process.env.ZOHO_BASE_CURRENCY_CODE || 'AED').toUpperCase()

function currencyCodeOf(row) {
  const code = clean(row?.currency_code || row?.currencyCode).toUpperCase()
  return code || BASE_CURRENCY_CODE
}

function isBaseCurrencyRow(row) {
  return currencyCodeOf(row) === BASE_CURRENCY_CODE
}

/**
 * Amount converted to Zoho's base currency.
 * Prefers the document's own bcy_* value; falls back to amount × exchange_rate.
 *
 * @param {object} row Zoho invoice / credit note / expense
 * @param {string} [field] amount field on the row (`total`, `sub_total`, …)
 */
function baseAmount(row, field = 'total') {
  const raw = toNumber(row?.[field])
  if (!row || isBaseCurrencyRow(row)) return round2(raw)

  const posted = row[`bcy_${field}`]
  if (posted != null && posted !== '') return round2(toNumber(posted))

  const rate = toNumber(row.exchange_rate)
  if (rate > 0) return round2(raw * rate)
  return round2(raw)
}

/**
 * Currency provenance for a row, or null when it is already base currency.
 * Lets exports show what was converted without changing the AED figures.
 */
function foreignCurrencyInfo(row, field = 'total') {
  if (!row || isBaseCurrencyRow(row)) return null
  return {
    currencyCode: currencyCodeOf(row),
    originalAmount: round2(toNumber(row[field])),
    exchangeRate: toNumber(row.exchange_rate) || null,
  }
}

module.exports = {
  BASE_CURRENCY_CODE,
  currencyCodeOf,
  isBaseCurrencyRow,
  baseAmount,
  foreignCurrencyInfo,
}

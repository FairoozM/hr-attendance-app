const { query } = require('../db')

const PREF_ALL_PRICES_EC = 'all_prices_ecommerce_v1'

/** Commission is fixed for the Custom module — not stored or editable. */
const FIXED_COMMISSION_PCT = 15

const DEFAULT_CUSTOM_RATES = {
  vatPct: 5,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
    this.code = 'VALIDATION'
  }
}

async function ensureUaePricesCustomRatesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS uae_prices_custom_rates (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      vat_pct NUMERIC(8,4) NOT NULL DEFAULT 5,
      advertising_pct NUMERIC(8,4) NOT NULL DEFAULT 15,
      required_profit_pct NUMERIC(8,4) NOT NULL DEFAULT 25,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uae_prices_custom_rates_singleton CHECK (id = 1),
      CONSTRAINT uae_prices_custom_rates_vat_chk CHECK (vat_pct >= 0 AND vat_pct <= 100),
      CONSTRAINT uae_prices_custom_rates_adv_chk CHECK (advertising_pct >= 0 AND advertising_pct <= 100),
      CONSTRAINT uae_prices_custom_rates_profit_chk CHECK (required_profit_pct >= 0 AND required_profit_pct <= 100)
    )
  `)
  await query(`
    INSERT INTO uae_prices_custom_rates (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
function parsePct(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${label} must be a number`)
  }
  if (n < 0 || n > 100) {
    throw new ValidationError(`${label} must be between 0 and 100`)
  }
  return n
}

/**
 * VAT + fixed commission + advertising + required profit must stay under 100%.
 * @param {number} vatPct
 * @param {number} advertisingPct
 * @param {number} requiredProfitPct
 */
function assertDenominatorValid(vatPct, advertisingPct, requiredProfitPct) {
  const sum = vatPct + FIXED_COMMISSION_PCT + advertisingPct + requiredProfitPct
  if (!(sum < 100)) {
    throw new ValidationError(
      `VAT + ${FIXED_COMMISSION_PCT}% commission + advertising + profit must be under 100% (currently ${sum}%)`,
    )
  }
}

function normalizeRatesRow(row) {
  if (!row) return null
  return {
    vatPct: Number(row.vat_pct),
    advertisingPct: Number(row.advertising_pct),
    requiredProfitPct: Number(row.required_profit_pct),
    commissionPct: FIXED_COMMISSION_PCT,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
  }
}

async function getCustomRates() {
  await ensureUaePricesCustomRatesTable()
  const r = await query(`SELECT * FROM uae_prices_custom_rates WHERE id = 1`)
  const normalized = normalizeRatesRow(r.rows[0])
  if (normalized) return normalized
  return {
    ...DEFAULT_CUSTOM_RATES,
    commissionPct: FIXED_COMMISSION_PCT,
    updatedAt: null,
    updatedBy: null,
  }
}

/**
 * @param {{ vatPct?: unknown, advertisingPct?: unknown, requiredProfitPct?: unknown }} patch
 * @param {{ userId?: number | null }} [meta]
 */
async function updateCustomRates(patch, meta = {}) {
  await ensureUaePricesCustomRatesTable()
  const cur = await getCustomRates()

  const next = {
    vatPct: patch.vatPct != null ? parsePct(patch.vatPct, 'VAT %') : cur.vatPct,
    advertisingPct:
      patch.advertisingPct != null
        ? parsePct(patch.advertisingPct, 'Advertising %')
        : cur.advertisingPct,
    requiredProfitPct:
      patch.requiredProfitPct != null
        ? parsePct(patch.requiredProfitPct, 'Profit %')
        : cur.requiredProfitPct,
  }

  assertDenominatorValid(next.vatPct, next.advertisingPct, next.requiredProfitPct)

  const userId = Number.isFinite(Number(meta.userId)) ? Number(meta.userId) : null

  await query(
    `UPDATE uae_prices_custom_rates SET
      vat_pct = $1,
      advertising_pct = $2,
      required_profit_pct = $3,
      updated_by = $4,
      updated_at = NOW()
    WHERE id = 1`,
    [next.vatPct, next.advertisingPct, next.requiredProfitPct, userId],
  )

  return getCustomRates()
}

/**
 * Shared UAE catalog from the most recently updated All Prices (UAE) prefs bundle.
 * Strips wholesale sales prices — Custom module only uses purchase + shipping.
 */
async function getSharedUaeCatalog() {
  const r = await query(
    `SELECT pref_value, updated_at FROM user_preferences
     WHERE pref_key = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [PREF_ALL_PRICES_EC],
  )
  const row = r.rows[0]
  if (!row) {
    return { rows: [], updatedAt: null }
  }

  const bundle = row.pref_value && typeof row.pref_value === 'object' ? row.pref_value : {}
  const rawRows = Array.isArray(bundle.rows) ? bundle.rows : []
  const rows = rawRows.map((item, index) => ({
    id: item?.id != null ? String(item.id) : `uae-custom-${index}`,
    itemNo: item?.itemNo != null ? String(item.itemNo) : '',
    purchasePrice: item?.purchasePrice ?? '',
    shipping: item?.shipping ?? '',
    dateOfPrices: item?.dateOfPrices != null ? String(item.dateOfPrices) : '',
  }))

  return {
    rows,
    updatedAt: row.updated_at || null,
  }
}

module.exports = {
  FIXED_COMMISSION_PCT,
  DEFAULT_CUSTOM_RATES,
  ValidationError,
  ensureUaePricesCustomRatesTable,
  parsePct,
  assertDenominatorValid,
  getCustomRates,
  updateCustomRates,
  getSharedUaeCatalog,
}

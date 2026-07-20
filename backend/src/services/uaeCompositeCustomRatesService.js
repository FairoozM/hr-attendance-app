const { query } = require('../db')

const PREF_ALL_PRICES_EC = 'all_prices_ecommerce_v1'

const DEFAULT_COMPOSITE_CUSTOM_RATES = {
  vatPct: 5,
  commissionPct: 15,
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
 * VAT + commission + advertising + required profit must stay under 100%.
 * @param {number} vatPct
 * @param {number} commissionPct
 * @param {number} advertisingPct
 * @param {number} requiredProfitPct
 */
function assertDenominatorValid(vatPct, commissionPct, advertisingPct, requiredProfitPct) {
  const sum = vatPct + commissionPct + advertisingPct + requiredProfitPct
  if (!(sum < 100)) {
    throw new ValidationError(
      `VAT + commission + advertising + profit must be under 100% (currently ${sum}%)`,
    )
  }
}

/**
 * Read rates from the most recently updated All Prices (UAE) prefs bundle.
 * @returns {Promise<{ vatPct: number, commissionPct: number, advertisingPct: number, requiredProfitPct: number }>}
 */
async function readSeedRatesFromAllPrices() {
  const r = await query(
    `SELECT pref_value FROM user_preferences
     WHERE pref_key = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [PREF_ALL_PRICES_EC],
  )
  const row = r.rows[0]
  const bundle = row?.pref_value && typeof row.pref_value === 'object' ? row.pref_value : {}
  const rates = bundle.rates && typeof bundle.rates === 'object' ? bundle.rates : {}

  const vatPct = Number(rates.vatPct)
  const commissionPct = Number(rates.commissionPct)
  const advertisingPct = Number(rates.advertisingPct)
  const requiredProfitPct = Number(rates.requiredProfitPct)

  return {
    vatPct: Number.isFinite(vatPct) ? vatPct : DEFAULT_COMPOSITE_CUSTOM_RATES.vatPct,
    commissionPct: Number.isFinite(commissionPct)
      ? commissionPct
      : DEFAULT_COMPOSITE_CUSTOM_RATES.commissionPct,
    advertisingPct: Number.isFinite(advertisingPct)
      ? advertisingPct
      : DEFAULT_COMPOSITE_CUSTOM_RATES.advertisingPct,
    requiredProfitPct: Number.isFinite(requiredProfitPct)
      ? requiredProfitPct
      : DEFAULT_COMPOSITE_CUSTOM_RATES.requiredProfitPct,
  }
}

function normalizeRatesRow(row) {
  if (!row) return null
  return {
    vatPct: Number(row.vat_pct),
    commissionPct: Number(row.commission_pct),
    advertisingPct: Number(row.advertising_pct),
    requiredProfitPct: Number(row.required_profit_pct),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
  }
}

async function ensureUaeCompositeCustomRatesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS uae_composite_custom_rates (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      vat_pct NUMERIC(8,4) NOT NULL DEFAULT 5,
      commission_pct NUMERIC(8,4) NOT NULL DEFAULT 15,
      advertising_pct NUMERIC(8,4) NOT NULL DEFAULT 15,
      required_profit_pct NUMERIC(8,4) NOT NULL DEFAULT 25,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uae_composite_custom_rates_singleton CHECK (id = 1),
      CONSTRAINT uae_composite_custom_rates_vat_chk CHECK (vat_pct >= 0 AND vat_pct <= 100),
      CONSTRAINT uae_composite_custom_rates_comm_chk CHECK (commission_pct >= 0 AND commission_pct <= 100),
      CONSTRAINT uae_composite_custom_rates_adv_chk CHECK (advertising_pct >= 0 AND advertising_pct <= 100),
      CONSTRAINT uae_composite_custom_rates_profit_chk CHECK (required_profit_pct >= 0 AND required_profit_pct <= 100)
    )
  `)

  const existing = await query(`SELECT id FROM uae_composite_custom_rates WHERE id = 1`)
  if (existing.rows[0]) return

  const seed = await readSeedRatesFromAllPrices()
  try {
    assertDenominatorValid(seed.vatPct, seed.commissionPct, seed.advertisingPct, seed.requiredProfitPct)
  } catch {
    Object.assign(seed, DEFAULT_COMPOSITE_CUSTOM_RATES)
  }

  await query(
    `INSERT INTO uae_composite_custom_rates (
      id, vat_pct, commission_pct, advertising_pct, required_profit_pct
    ) VALUES (1, $1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING`,
    [seed.vatPct, seed.commissionPct, seed.advertisingPct, seed.requiredProfitPct],
  )
}

async function getCompositeCustomRates() {
  await ensureUaeCompositeCustomRatesTable()
  const r = await query(`SELECT * FROM uae_composite_custom_rates WHERE id = 1`)
  const normalized = normalizeRatesRow(r.rows[0])
  if (normalized) return normalized
  return {
    ...DEFAULT_COMPOSITE_CUSTOM_RATES,
    updatedAt: null,
    updatedBy: null,
  }
}

/**
 * @param {{
 *   vatPct?: unknown,
 *   commissionPct?: unknown,
 *   advertisingPct?: unknown,
 *   requiredProfitPct?: unknown
 * }} patch
 * @param {{ userId?: number | null }} [meta]
 */
async function updateCompositeCustomRates(patch, meta = {}) {
  await ensureUaeCompositeCustomRatesTable()
  const cur = await getCompositeCustomRates()

  const next = {
    vatPct: patch.vatPct != null ? parsePct(patch.vatPct, 'VAT %') : cur.vatPct,
    commissionPct:
      patch.commissionPct != null ? parsePct(patch.commissionPct, 'Commission %') : cur.commissionPct,
    advertisingPct:
      patch.advertisingPct != null
        ? parsePct(patch.advertisingPct, 'Advertising %')
        : cur.advertisingPct,
    requiredProfitPct:
      patch.requiredProfitPct != null
        ? parsePct(patch.requiredProfitPct, 'Profit %')
        : cur.requiredProfitPct,
  }

  assertDenominatorValid(next.vatPct, next.commissionPct, next.advertisingPct, next.requiredProfitPct)

  const userId = Number.isFinite(Number(meta.userId)) ? Number(meta.userId) : null

  await query(
    `UPDATE uae_composite_custom_rates SET
      vat_pct = $1,
      commission_pct = $2,
      advertising_pct = $3,
      required_profit_pct = $4,
      updated_by = $5,
      updated_at = NOW()
    WHERE id = 1`,
    [next.vatPct, next.commissionPct, next.advertisingPct, next.requiredProfitPct, userId],
  )

  return getCompositeCustomRates()
}

module.exports = {
  DEFAULT_COMPOSITE_CUSTOM_RATES,
  ValidationError,
  parsePct,
  assertDenominatorValid,
  readSeedRatesFromAllPrices,
  ensureUaeCompositeCustomRatesTable,
  getCompositeCustomRates,
  updateCompositeCustomRates,
}

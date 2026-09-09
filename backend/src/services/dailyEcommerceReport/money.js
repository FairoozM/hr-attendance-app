'use strict'

/**
 * Decimal-safe money helpers for the Daily Ecommerce Report.
 *
 * SAR→AED uses the same configurable rate as Amazon KSA legacy payment clearing
 * (`AMAZON_KSA_LEGACY_SAR_TO_AED`, default 3.67/3.75). Documented in exchangeRate
 * metadata on every API response — never a silent unexplained constant.
 */

const DEFAULT_SAR_TO_AED = 3.67 / 3.75

function round2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getSarToAedRate() {
  const raw = process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  if (raw == null || String(raw).trim() === '') {
    return {
      rate: DEFAULT_SAR_TO_AED,
      source: 'default_3.67_div_3.75',
      envVar: 'AMAZON_KSA_LEGACY_SAR_TO_AED',
      configured: false,
    }
  }
  const rate = Number(raw)
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      rate: DEFAULT_SAR_TO_AED,
      source: 'default_3.67_div_3.75_invalid_env',
      envVar: 'AMAZON_KSA_LEGACY_SAR_TO_AED',
      configured: false,
      warning: `Invalid AMAZON_KSA_LEGACY_SAR_TO_AED="${raw}"; using default 3.67/3.75`,
    }
  }
  return {
    rate,
    source: 'AMAZON_KSA_LEGACY_SAR_TO_AED',
    envVar: 'AMAZON_KSA_LEGACY_SAR_TO_AED',
    configured: true,
  }
}

/**
 * @param {number} amount
 * @param {string} currency - AED | SAR | other
 * @param {{ rate: number }} fx
 */
function toAed(amount, currency, fx) {
  const n = toFiniteNumber(amount, 0)
  const c = String(currency || 'AED').trim().toUpperCase()
  if (c === 'AED' || c === 'DH' || c === 'DHS') return round2(n)
  if (c === 'SAR' || c === 'SR') return round2(n * fx.rate)
  // Unknown currency: leave amount as-is but flag via caller warnings
  return round2(n)
}

/**
 * Sum only finite numbers; skip null/undefined (unavailable / not configured).
 * @param {Array<number|null|undefined>} values
 */
function sumAvailable(values) {
  let total = 0
  let used = 0
  for (const v of values) {
    if (v == null) continue
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    total += n
    used += 1
  }
  return { total: round2(total), used }
}

module.exports = {
  DEFAULT_SAR_TO_AED,
  round2,
  toFiniteNumber,
  getSarToAedRate,
  toAed,
  sumAvailable,
}

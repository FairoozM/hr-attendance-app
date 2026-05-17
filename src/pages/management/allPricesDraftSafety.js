/** Fingerprinting and dirty-state helpers for All Prices draft vs active saved list. */

import { DEFAULT_RATES, normalizeAllPricesRates, normalizeAllPricesRows } from './allPricesEcommerceUtils'

/**
 * @typedef {'saved' | 'unsaved' | 'conflict'} ActiveListSaveStatus
 * @typedef {'idle' | 'saving' | 'saved' | 'error'} DraftSaveStatus
 */

/**
 * @param {object} rates
 */
export function normalizeRatesForFingerprint(rates) {
  const n = normalizeAllPricesRates(rates || DEFAULT_RATES)
  return {
    vatPct: n.vatPct,
    commissionPct: n.commissionPct,
    advertisingPct: n.advertisingPct,
    requiredProfitPct: n.requiredProfitPct,
  }
}

/**
 * @param {unknown[]} rows
 */
export function normalizeRowsForFingerprint(rows) {
  const normalized = normalizeAllPricesRows(rows) || []
  return normalized
    .map((r) => ({
      itemNo: String(r.itemNo || '').trim(),
      purchasePrice: r.purchasePrice === '' || r.purchasePrice == null ? '' : String(r.purchasePrice),
      shipping: r.shipping === '' || r.shipping == null ? '' : String(r.shipping),
      dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
    }))
    .sort((a, b) => {
      const itemCmp = a.itemNo.localeCompare(b.itemNo)
      if (itemCmp !== 0) return itemCmp
      return 0
    })
}

/**
 * @param {{ activeSavedListId?: string | null, rates?: object, rows?: unknown[] }} input
 */
export function buildFingerprintPayload(input) {
  return {
    activeSavedListId: input.activeSavedListId != null ? String(input.activeSavedListId) : null,
    rates: normalizeRatesForFingerprint(input.rates),
    rows: normalizeRowsForFingerprint(input.rows || []),
  }
}

/**
 * FNV-1a 32-bit hash for stable fingerprints (sync, test-friendly).
 * @param {string} str
 */
export function hashFingerprintString(str) {
  let hash = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * @param {{ activeSavedListId?: string | null, rates?: object, rows?: unknown[] }} input
 * @returns {string}
 */
export function computeDraftFingerprint(input) {
  return hashFingerprintString(JSON.stringify(buildFingerprintPayload(input)))
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function fingerprintsEqual(a, b) {
  return String(a || '') === String(b || '')
}

/**
 * @param {object} params
 * @param {string | null | undefined} params.activeSavedListId
 * @param {string | null | undefined} params.loadedFingerprint
 * @param {string} params.currentFingerprint
 * @param {boolean} [params.revisionConflict]
 */
export function hasUnsavedChangesToActiveList({
  activeSavedListId,
  loadedFingerprint,
  currentFingerprint,
  revisionConflict = false,
}) {
  if (!activeSavedListId) return false
  if (revisionConflict) return true
  if (!loadedFingerprint) return true
  return !fingerprintsEqual(loadedFingerprint, currentFingerprint)
}

/**
 * @param {object} params
 * @param {string | null | undefined} params.activeSavedListId
 * @param {string | null | undefined} params.loadedFingerprint
 * @param {string} params.currentFingerprint
 * @param {boolean} [params.revisionConflict]
 * @returns {ActiveListSaveStatus}
 */
export function deriveActiveListSaveStatus({
  activeSavedListId,
  loadedFingerprint,
  currentFingerprint,
  revisionConflict = false,
}) {
  if (!activeSavedListId) return 'saved'
  if (revisionConflict) return 'conflict'
  if (hasUnsavedChangesToActiveList({ activeSavedListId, loadedFingerprint, currentFingerprint })) {
    return 'unsaved'
  }
  return 'saved'
}

/**
 * @param {number} oldCount
 * @param {number} newCount
 */
export function isSignificantRowCountChange(oldCount, newCount) {
  const oldN = Math.max(0, Number(oldCount) || 0)
  const newN = Math.max(0, Number(newCount) || 0)
  if (oldN < 50) return false
  const absDiff = Math.abs(newN - oldN)
  if (absDiff >= 100) return true
  const pct = oldN > 0 ? absDiff / oldN : 1
  return pct >= 0.25
}

/**
 * @param {object} rates
 */
export function formatRatesSummary(rates) {
  const r = normalizeRatesForFingerprint(rates)
  return `VAT ${r.vatPct}% · Comm ${r.commissionPct}% · Adv ${r.advertisingPct}% · Profit ${r.requiredProfitPct}%`
}

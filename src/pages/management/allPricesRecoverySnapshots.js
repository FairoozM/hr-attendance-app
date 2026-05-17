/** Recovery snapshots for All Prices destructive actions (max 20 per user). */

import { PREF_ALL_PRICES_RECOVERY_SNAPSHOTS } from '../../constants/userPreferenceKeys'
import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import { makeRowId, normalizeAllPricesRates, normalizeAllPricesRows, parseLastSavedAt } from './allPricesEcommerceUtils'

export const RECOVERY_SNAPSHOT_MAX = 20

/** @typedef {'before-update-saved-list' | 'before-delete-saved-list' | 'before-bulk-replace' | 'before-reset-rates' | 'before-load-other-list'} RecoverySnapshotReason */

/**
 * @param {unknown} reason
 * @returns {RecoverySnapshotReason | null}
 */
export function normalizeRecoveryReason(reason) {
  const r = String(reason || '').trim()
  if (
    r === 'before-update-saved-list' ||
    r === 'before-delete-saved-list' ||
    r === 'before-bulk-replace' ||
    r === 'before-reset-rates' ||
    r === 'before-load-other-list'
  ) {
    return r
  }
  return null
}

export function makeRecoverySnapshotId() {
  return `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * @param {unknown} raw
 */
function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id != null ? String(raw.id).trim() : ''
  if (!id) return null
  const reason = normalizeRecoveryReason(raw.reason)
  if (!reason) return null
  const createdAt = parseLastSavedAt(raw.createdAt) || new Date().toISOString()
  return {
    id,
    reason,
    createdAt,
    sourceSavedListId: raw.sourceSavedListId != null ? String(raw.sourceSavedListId) : undefined,
    sourceSavedListName: raw.sourceSavedListName != null ? String(raw.sourceSavedListName) : undefined,
    rates: normalizeAllPricesRates(raw.rates),
    rows: (normalizeAllPricesRows(raw.rows) || []).map((r) => ({
      ...r,
      id: r.id || makeRowId(),
    })),
  }
}

/**
 * @returns {import('./allPricesRecoverySnapshots').RecoverySnapshot[]}
 */
export function readRecoverySnapshots() {
  const raw = getUserPrefKey(PREF_ALL_PRICES_RECOVERY_SNAPSHOTS, null)
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeSnapshot).filter(Boolean)
}

/**
 * @param {import('./allPricesRecoverySnapshots').RecoverySnapshot[]} snapshots
 */
export function persistRecoverySnapshots(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots.map(normalizeSnapshot).filter(Boolean) : []
  requestUserPrefSave(PREF_ALL_PRICES_RECOVERY_SNAPSHOTS, list.slice(0, RECOVERY_SNAPSHOT_MAX))
  return list.slice(0, RECOVERY_SNAPSHOT_MAX)
}

/**
 * @param {object} params
 * @param {RecoverySnapshotReason} params.reason
 * @param {object} params.rates
 * @param {unknown[]} params.rows
 * @param {string} [params.sourceSavedListId]
 * @param {string} [params.sourceSavedListName]
 * @param {import('./allPricesRecoverySnapshots').RecoverySnapshot[]} [params.existing]
 */
export function pushRecoverySnapshot({
  reason,
  rates,
  rows,
  sourceSavedListId,
  sourceSavedListName,
  existing,
}) {
  const snapshot = normalizeSnapshot({
    id: makeRecoverySnapshotId(),
    reason,
    createdAt: new Date().toISOString(),
    sourceSavedListId,
    sourceSavedListName,
    rates,
    rows,
  })
  if (!snapshot) return readRecoverySnapshots()
  const base = Array.isArray(existing) ? existing : readRecoverySnapshots()
  return persistRecoverySnapshots([snapshot, ...base.filter((s) => s.id !== snapshot.id)].slice(0, RECOVERY_SNAPSHOT_MAX))
}

/**
 * @param {string} id
 * @param {import('./allPricesRecoverySnapshots').RecoverySnapshot[]} [existing]
 */
export function findRecoverySnapshot(id, existing) {
  const list = Array.isArray(existing) ? existing : readRecoverySnapshots()
  return list.find((s) => s.id === id) || null
}

/**
 * @param {string} id
 * @param {import('./allPricesRecoverySnapshots').RecoverySnapshot[]} [existing]
 */
export function removeRecoverySnapshot(id, existing) {
  const base = Array.isArray(existing) ? existing : readRecoverySnapshots()
  return persistRecoverySnapshots(base.filter((s) => s.id !== id))
}

/** Named All Prices snapshots — persisted via user preferences (PREF_ALL_PRICES_SAVED_LISTS). */

import { PREF_ALL_PRICES_SAVED_LISTS } from '../../constants/userPreferenceKeys'
import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import {
  formatLastSavedAt,
  isBrkhTemplateSeedRows,
  isProductionBuild,
  normalizeAllPricesRates,
  normalizeAllPricesRows,
  parseLastSavedAt,
} from './allPricesEcommerceUtils'

/** @deprecated One-time migration source only */
export const LEGACY_LOCAL_STORAGE_KEY = 'lifeSmile_allPrices_savedLists'

export function makeSavedListId() {
  const suffix = Math.random().toString(36).slice(2, 9)
  return `price-list-${Date.now()}-${suffix}`
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function formatSavedListName(date = new Date()) {
  return `Saved Prices - ${formatLastSavedAt(date.toISOString())}`
}

/**
 * @returns {{ activeSavedListId: string | null, savedLists: object[] }}
 */
export function emptySavedListsStore() {
  return { activeSavedListId: null, savedLists: [] }
}

/**
 * @param {unknown} raw
 * @returns {{ activeSavedListId: string | null, savedLists: object[] }}
 */
export function normalizeSavedListsStore(raw) {
  if (!raw || typeof raw !== 'object') return emptySavedListsStore()
  const activeSavedListId =
    raw.activeSavedListId != null && String(raw.activeSavedListId).trim()
      ? String(raw.activeSavedListId).trim()
      : null
  const savedLists = Array.isArray(raw.savedLists)
    ? raw.savedLists
        .map(normalizeSavedListEntry)
        .filter(Boolean)
    : []
  return { activeSavedListId, savedLists }
}

/**
 * @param {unknown} entry
 */
function normalizeSavedListEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = entry.id != null ? String(entry.id).trim() : ''
  if (!id) return null
  const createdAt = parseLastSavedAt(entry.createdAt) || new Date().toISOString()
  const updatedAt = parseLastSavedAt(entry.updatedAt) || createdAt
  const rows = normalizeAllPricesRows(entry.rows) || []
  if (isProductionBuild() && isBrkhTemplateSeedRows(rows)) return null
  return {
    id,
    name: entry.name != null ? String(entry.name) : formatSavedListName(new Date(updatedAt)),
    createdAt,
    updatedAt,
    rates: normalizeAllPricesRates(entry.rates),
    rows,
  }
}

export function readSavedListsStore() {
  const raw = getUserPrefKey(PREF_ALL_PRICES_SAVED_LISTS, null)
  return normalizeSavedListsStore(raw)
}

/**
 * @param {{ activeSavedListId?: string | null, savedLists?: object[] }} store
 */
export function persistSavedListsStore(store) {
  const normalized = normalizeSavedListsStore(store)
  requestUserPrefSave(PREF_ALL_PRICES_SAVED_LISTS, normalized)
  return normalized
}

/**
 * @param {object} rates
 * @param {unknown[]} rows
 * @param {{ id?: string, name?: string, createdAt?: string }} [options]
 */
export function buildSavedListEntry(rates, rows, options = {}) {
  const now = new Date().toISOString()
  const normalizedRows = normalizeAllPricesRows(rows) || []
  if (isProductionBuild() && isBrkhTemplateSeedRows(normalizedRows)) {
    return { blocked: true, entry: null }
  }
  const id = options.id || makeSavedListId()
  const createdAt = parseLastSavedAt(options.createdAt) || now
  return {
    blocked: false,
    entry: {
      id,
      name: options.name || formatSavedListName(new Date(now)),
      createdAt,
      updatedAt: now,
      rates: normalizeAllPricesRates(rates),
      rows: normalizedRows,
    },
  }
}

/**
 * @param {{ activeSavedListId: string | null, savedLists: object[] }} store
 * @param {string} id
 * @param {object} rates
 * @param {unknown[]} rows
 */
export function updateSavedListInStore(store, id, rates, rows) {
  const { entry, blocked } = buildSavedListEntry(rates, rows, {
    id,
    name: store.savedLists.find((l) => l.id === id)?.name,
    createdAt: store.savedLists.find((l) => l.id === id)?.createdAt,
  })
  if (blocked || !entry) return { store, blocked: true }
  const savedLists = store.savedLists.map((l) => (l.id === id ? entry : l))
  return {
    store: { activeSavedListId: store.activeSavedListId, savedLists },
    blocked: false,
    entry,
  }
}

/**
 * @param {{ activeSavedListId: string | null, savedLists: object[] }} store
 * @param {object} rates
 * @param {unknown[]} rows
 */
export function addSavedListToStore(store, rates, rows) {
  const { entry, blocked } = buildSavedListEntry(rates, rows)
  if (blocked || !entry) return { store, blocked: true, entry: null }
  return {
    store: {
      activeSavedListId: entry.id,
      savedLists: [entry, ...store.savedLists.filter((l) => l.id !== entry.id)],
    },
    blocked: false,
    entry,
  }
}

/**
 * @param {{ activeSavedListId: string | null, savedLists: object[] }} store
 * @param {string} id
 */
export function removeSavedListFromStore(store, id) {
  const savedLists = store.savedLists.filter((l) => l.id !== id)
  const activeSavedListId =
    store.activeSavedListId === id
      ? savedLists[0]?.id || null
      : store.activeSavedListId
  return { activeSavedListId, savedLists }
}

/**
 * One-time import from legacy localStorage key (if present).
 * @returns {{ activeSavedListId: string | null, savedLists: object[] } | null}
 */
export function readLegacySavedListsFromLocalStorage() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const store = normalizeSavedListsStore(parsed)
    if (!store.savedLists.length) return null
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
    return store
  } catch {
    return null
  }
}

import {
  PREF_ALL_PRICES_CLEANUP_BATCHES,
  PREF_ALL_PRICES_HISTORY,
  PREF_ALL_PRICES_IMPORT_BATCHES,
} from '../../constants/userPreferenceKeys'
import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import { normalizeItemNo } from './allPricesVersioning'

const MAX_BATCHES = 100

function asArray(value) {
  return Array.isArray(value) ? value : []
}

export function normalizeHistoricalPricesStore(raw) {
  const store = raw && typeof raw === 'object' ? raw : {}
  return {
    version: 1,
    rows: asArray(store.rows).map((row) => ({
      ...row,
      historicalPriceId: row.historicalPriceId || row.id || `hist-${Math.random().toString(36).slice(2, 9)}`,
      normalizedItemNo: row.normalizedItemNo || normalizeItemNo(row.itemNo),
    })),
  }
}

export function readHistoricalPricesStore() {
  return normalizeHistoricalPricesStore(getUserPrefKey(PREF_ALL_PRICES_HISTORY, null))
}

export function persistHistoricalPricesStore(store) {
  const normalized = normalizeHistoricalPricesStore(store)
  requestUserPrefSave(PREF_ALL_PRICES_HISTORY, normalized)
  return normalized
}

export function appendHistoricalPrices(rows) {
  const incoming = asArray(rows)
  if (!incoming.length) return readHistoricalPricesStore()
  const store = readHistoricalPricesStore()
  const existingIds = new Set(store.rows.map((row) => row.historicalPriceId))
  const nextRows = [...store.rows]
  incoming.forEach((row) => {
    const id = row.historicalPriceId || row.id
    if (id && existingIds.has(id)) return
    nextRows.unshift({
      ...row,
      historicalPriceId: id || `hist-${Math.random().toString(36).slice(2, 9)}`,
      normalizedItemNo: row.normalizedItemNo || normalizeItemNo(row.itemNo),
    })
  })
  return persistHistoricalPricesStore({ ...store, rows: nextRows })
}

export function filterHistoricalPrices(rows, filters = {}) {
  const q = String(filters.search || '').trim().toUpperCase()
  const source = String(filters.source || '').trim()
  const reason = String(filters.reason || '').trim().toLowerCase()
  const priceFrom = String(filters.priceDateFrom || '').trim()
  const priceTo = String(filters.priceDateTo || '').trim()
  const movedFrom = String(filters.movedFrom || '').trim()
  const movedTo = String(filters.movedTo || '').trim()

  return asArray(rows).filter((row) => {
    if (q && !normalizeItemNo(row.itemNo).includes(q)) return false
    if (source && row.source !== source) return false
    if (reason && !String(row.reason || '').toLowerCase().includes(reason)) return false
    const priceDate = String(row.originalDateOfPrices || '').slice(0, 10)
    if (priceFrom && (!priceDate || priceDate < priceFrom)) return false
    if (priceTo && (!priceDate || priceDate > priceTo)) return false
    const movedDate = String(row.movedAt || row.replacedAt || '').slice(0, 10)
    if (movedFrom && (!movedDate || movedDate < movedFrom)) return false
    if (movedTo && (!movedDate || movedDate > movedTo)) return false
    return true
  })
}

function normalizeBatchStore(raw) {
  const store = raw && typeof raw === 'object' ? raw : {}
  return { version: 1, batches: asArray(store.batches) }
}

function readBatchStore(key) {
  return normalizeBatchStore(getUserPrefKey(key, null))
}

function appendBatch(key, batch) {
  const store = readBatchStore(key)
  const batches = [batch, ...store.batches].slice(0, MAX_BATCHES)
  const next = { ...store, batches }
  requestUserPrefSave(key, next)
  return next
}

export function readCleanupBatchesStore() {
  return readBatchStore(PREF_ALL_PRICES_CLEANUP_BATCHES)
}

export function appendCleanupBatch(batch) {
  return appendBatch(PREF_ALL_PRICES_CLEANUP_BATCHES, batch)
}

export function readImportBatchesStore() {
  return readBatchStore(PREF_ALL_PRICES_IMPORT_BATCHES)
}

export function appendImportBatch(batch) {
  return appendBatch(PREF_ALL_PRICES_IMPORT_BATCHES, batch)
}

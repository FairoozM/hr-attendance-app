import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import { getAllPricesMarket, PRICES_MARKET_KSA, PRICES_MARKET_UAE } from './allPricesMarket'
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

/** @param {string} [marketId] */
export function historyPrefKeyForMarket(marketId) {
  return getAllPricesMarket(marketId).prefs.history
}

/** @param {string} [marketId] */
export function readHistoricalPricesStore(marketId = PRICES_MARKET_UAE) {
  return normalizeHistoricalPricesStore(getUserPrefKey(historyPrefKeyForMarket(marketId), null))
}

/** @param {object} store @param {string} [marketId] */
export function persistHistoricalPricesStore(store, marketId = PRICES_MARKET_UAE) {
  const normalized = normalizeHistoricalPricesStore(store)
  requestUserPrefSave(historyPrefKeyForMarket(marketId), normalized)
  return normalized
}

/** @param {unknown[]} rows @param {string} [marketId] */
export function appendHistoricalPrices(rows, marketId = PRICES_MARKET_UAE) {
  const incoming = asArray(rows)
  if (!incoming.length) return readHistoricalPricesStore(marketId)
  const store = readHistoricalPricesStore(marketId)
  const existingIds = new Set(store.rows.map((row) => row.historicalPriceId))
  const nextRows = [...store.rows]
  incoming.forEach((row) => {
    const id = row.historicalPriceId || row.id
    if (id && existingIds.has(id)) return
    nextRows.unshift({
      ...row,
      market: marketId,
      historicalPriceId: id || `hist-${Math.random().toString(36).slice(2, 9)}`,
      normalizedItemNo: row.normalizedItemNo || normalizeItemNo(row.itemNo),
    })
  })
  return persistHistoricalPricesStore({ ...store, rows: nextRows }, marketId)
}

/** Combined UAE + KSA rows for historical audit screens. */
export function readAllHistoricalPriceRows() {
  const uae = readHistoricalPricesStore(PRICES_MARKET_UAE).rows.map((row) => ({
    ...row,
    market: row.market || PRICES_MARKET_UAE,
  }))
  const ksa = readHistoricalPricesStore(PRICES_MARKET_KSA).rows.map((row) => ({
    ...row,
    market: row.market || PRICES_MARKET_KSA,
  }))
  return [...ksa, ...uae]
}

export function filterHistoricalPrices(rows, filters = {}) {
  const region = String(filters.region || '').trim().toLowerCase()
  const q = String(filters.search || '').trim().toUpperCase()
  const source = String(filters.source || '').trim()
  const reason = String(filters.reason || '').trim().toLowerCase()
  const priceFrom = String(filters.priceDateFrom || '').trim()
  const priceTo = String(filters.priceDateTo || '').trim()
  const movedFrom = String(filters.movedFrom || '').trim()
  const movedTo = String(filters.movedTo || '').trim()

  return asArray(rows).filter((row) => {
    if (region && region !== 'all' && String(row.market || PRICES_MARKET_UAE) !== region) return false
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

export function readCleanupBatchesStore(marketId = PRICES_MARKET_UAE) {
  return readBatchStore(getAllPricesMarket(marketId).prefs.cleanupBatches)
}

export function appendCleanupBatch(batch, marketId = PRICES_MARKET_UAE) {
  return appendBatch(getAllPricesMarket(marketId).prefs.cleanupBatches, batch)
}

export function readImportBatchesStore(marketId = PRICES_MARKET_UAE) {
  return readBatchStore(getAllPricesMarket(marketId).prefs.importBatches)
}

export function appendImportBatch(batch, marketId = PRICES_MARKET_UAE) {
  return appendBatch(getAllPricesMarket(marketId).prefs.importBatches, batch)
}

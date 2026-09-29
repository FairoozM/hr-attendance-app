'use strict'

/**
 * Stripe payout list for Management → Stripe.
 *
 * - getCachedPayoutList: database only. Never calls Stripe or Zoho.
 * - refreshPayoutList: explicit "Reload payouts". Reads the latest payouts and their balance
 *   transactions from Stripe (read-only), then replaces the cache in one transaction. A failed
 *   refresh leaves the previous cache untouched. Never calls Zoho, never posts anything.
 */

const defaultSources = require('./stripeClearingSources')
const cacheStore = require('./stripePayoutListCacheStore')
const { summarizeComposition } = require('./stripePayoutPreviewService')

const { PAYOUT_LIST_SIZE } = cacheStore
// A payout's balance transactions are fixed once Stripe has finished with it.
const FINAL_PAYOUT_STATUS = new Set(['paid', 'failed', 'canceled'])
const BALANCE_TXN_CONCURRENCY = 4

function defaultStore() {
  const db = require('../../db')
  return {
    list: () => cacheStore.listCachedPayouts(db),
    async replace(payouts, refreshedAt) {
      const client = await db.pool.connect()
      try {
        await cacheStore.replaceCachedPayouts(client, payouts, refreshedAt)
      } finally {
        client.release()
      }
    },
  }
}

function defaultDeps() {
  return { sources: defaultSources, store: defaultStore(), now: () => new Date() }
}

function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100
}

function publicRow(row) {
  return {
    payoutId: row.payoutId,
    status: row.status,
    amount: toMajor(row.amountMinor),
    currency: row.currency,
    arrivalDate: row.arrivalDate,
    createdAt: row.createdAt,
    composition: row.composition,
  }
}

function response(rows, source) {
  const refreshedAt = rows.reduce((latest, r) => (r.refreshedAt && (!latest || r.refreshedAt > latest) ? r.refreshedAt : latest), null)
  return { rows: rows.map(publicRow), refreshedAt, count: rows.length, maxRows: PAYOUT_LIST_SIZE, source }
}

/** Cached payouts, newest first. Database only. */
async function getCachedPayoutList(overrides = {}) {
  const { store } = { ...defaultDeps(), ...overrides }
  return response(await store.list(), 'cache')
}

function canReuseComposition(cached, payout) {
  return Boolean(cached)
    && FINAL_PAYOUT_STATUS.has(payout.status)
    && cached.status === payout.status
    && cached.amountMinor === payout.amountMinor
    && cached.currency === payout.currency
    && cached.composition
    && cached.composition.reconciles === true
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function runRefresh(deps) {
  const { sources, store, now } = deps
  const payouts = await sources.listStripePayouts({ limit: PAYOUT_LIST_SIZE })
  const cachedById = new Map((await store.list()).map((r) => [r.payoutId, r]))
  const fetchedAt = now().toISOString()
  let balanceTransactionFetches = 0
  const rows = await mapWithConcurrency(payouts.slice(0, PAYOUT_LIST_SIZE), BALANCE_TXN_CONCURRENCY, async (payout) => {
    const cached = cachedById.get(payout.payoutId)
    if (canReuseComposition(cached, payout)) {
      return { ...payout, composition: cached.composition, compositionFetchedAt: cached.compositionFetchedAt, refreshedAt: fetchedAt }
    }
    balanceTransactionFetches += 1
    const txns = await sources.listPayoutBalanceTransactions(payout.payoutId)
    return { ...payout, composition: summarizeComposition(payout, txns), compositionFetchedAt: fetchedAt, refreshedAt: fetchedAt }
  })
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.payoutId.localeCompare(a.payoutId))
  await store.replace(rows, fetchedAt)
  return { ...response(rows, 'stripe'), balanceTransactionFetches }
}

let inFlight = null

/**
 * Explicit refresh from Stripe (read-only). Concurrent calls share one refresh.
 */
async function refreshPayoutList(overrides = {}) {
  if (!inFlight) inFlight = runRefresh({ ...defaultDeps(), ...overrides }).finally(() => { inFlight = null })
  return inFlight
}

module.exports = {
  PAYOUT_LIST_SIZE,
  getCachedPayoutList,
  refreshPayoutList,
  canReuseComposition,
}

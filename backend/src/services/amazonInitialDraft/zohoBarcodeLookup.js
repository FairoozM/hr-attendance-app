'use strict'

/**
 * Exact-SKU Zoho barcode lookup for the Amazon Initial Draft Generator.
 *
 * Reuses the existing Zoho Inventory client and the zoho_item_cache table. Matching is
 * exact on the trimmed SKU string (no fuzzy expansion). The Zoho barcode itself is never
 * rewritten — only read as text for the GTIN transform step.
 *
 * The generator runs inside one HTTP request behind CloudFront, whose origin read timeout
 * is 30s, and Zoho's shared rate limiter can park a single call for 15s. So this module is
 * cache-first: the whole SKU set is resolved in one database query, and live Zoho calls are
 * only used to fill in a missing barcode, under a hard call count and wall-clock budget.
 * Anything the budget cannot reach is reported as missing rather than delaying the draft.
 */

const { fetchItemById } = require('../../integrations/zoho/zohoInventoryClient')
const { findItemsBySkus } = require('../zohoBulkInvoiceStore')

/** Live Zoho item-detail calls allowed per pipeline run. */
const DEFAULT_MAX_API_CALLS = Number(process.env.AMAZON_INITIAL_DRAFT_ZOHO_MAX_CALLS || 10)
/** Wall-clock budget for all live Zoho calls in one pipeline run. */
const DEFAULT_BUDGET_MS = Number(process.env.AMAZON_INITIAL_DRAFT_ZOHO_BUDGET_MS || 6000)
const DEFAULT_CONCURRENCY = Number(process.env.AMAZON_INITIAL_DRAFT_ZOHO_CONCURRENCY || 4)

function cleanSku(value) {
  return String(value == null ? '' : value).trim()
}

/**
 * Exact match key. Case is folded because the workbook and Zoho disagree on casing for the
 * same SKU, and the cache query itself matches on LOWER(sku). No other normalisation: a
 * differing separator or suffix is a different SKU.
 */
function skuKey(value) {
  return cleanSku(value).toLowerCase()
}

function extractBarcodeText(item) {
  if (!item || typeof item !== 'object') return ''
  const rawJson = item.raw_json && typeof item.raw_json === 'object' ? item.raw_json : null
  const candidates = [item.upc, item.ean, item.isbn, rawJson?.upc, rawJson?.ean, rawJson?.isbn]
  for (const candidate of candidates) {
    const text = String(candidate == null ? '' : candidate).trim()
    if (text) return text
  }
  return ''
}

function pickExactSkuMatches(items, sku) {
  const needle = skuKey(sku)
  if (!needle) return []
  return (Array.isArray(items) ? items : []).filter((item) => skuKey(item?.sku) === needle)
}

function result(sku, status, { zohoSku = '', itemId = '', barcode = '', reason = null } = {}) {
  return { sku, status, zohoSku, itemId, barcode, reason }
}

/**
 * Awaits `promise` but gives up once `deadline` passes, so one rate-limited Zoho call
 * cannot hold the whole request open. The abandoned promise is drained, not left to
 * reject unhandled.
 */
function withDeadline(promise, deadline) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.resolve({ timedOut: true, value: null })

  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, value: null }), remaining)
  })

  return Promise.race([
    promise.then(
      (value) => ({ timedOut: false, value }),
      () => ({ timedOut: false, value: null })
    ),
    timeout,
  ]).finally(() => clearTimeout(timer))
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items]
  const runners = []
  const size = Math.max(1, Math.min(limit, queue.length))
  for (let i = 0; i < size; i += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const next = queue.shift()
          if (next === undefined) return
          await worker(next)
        }
      })()
    )
  }
  await Promise.all(runners)
}

/**
 * Resolves the Zoho barcode for every SKU in one pass.
 *
 * @param {string[]} skus
 * @param {{ maxApiCalls?: number, budgetMs?: number, concurrency?: number }} [options]
 * @returns {Promise<Map<string, object>>}
 */
async function lookupZohoBarcodesByExactSkus(skus, options = {}) {
  const maxApiCalls = Number.isFinite(options.maxApiCalls) ? options.maxApiCalls : DEFAULT_MAX_API_CALLS
  const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : DEFAULT_BUDGET_MS
  const concurrency = Number.isFinite(options.concurrency) ? options.concurrency : DEFAULT_CONCURRENCY

  const unique = []
  const seen = new Set()
  for (const sku of Array.isArray(skus) ? skus : []) {
    const clean = cleanSku(sku)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    unique.push(clean)
  }

  const map = new Map()
  if (!unique.length) return map

  let cachedRows = []
  try {
    cachedRows = await findItemsBySkus(unique)
  } catch (err) {
    for (const sku of unique) {
      map.set(sku, result(sku, 'error', { reason: (err && err.message) || 'zoho-cache-query-failed' }))
    }
    return map
  }

  // Needs a live detail call: the cached row exists but carries no barcode.
  const needsEnrichment = []

  for (const sku of unique) {
    const matches = pickExactSkuMatches(cachedRows, sku)

    if (matches.length > 1) {
      map.set(sku, result(sku, 'ambiguous', { reason: 'zoho-sku-ambiguous' }))
      continue
    }

    const row = matches[0]
    if (!row) {
      map.set(sku, result(sku, 'not-found', { reason: 'zoho-sku-not-in-cache' }))
      continue
    }

    const itemId = row.item_id != null ? String(row.item_id) : ''
    const barcode = extractBarcodeText(row)

    if (barcode) {
      map.set(sku, result(sku, 'found', { zohoSku: cleanSku(row.sku), itemId, barcode }))
      continue
    }

    map.set(sku, result(sku, 'not-found', { zohoSku: cleanSku(row.sku), itemId, reason: 'zoho-barcode-blank' }))
    if (itemId) needsEnrichment.push({ sku, itemId })
  }

  if (!needsEnrichment.length || maxApiCalls <= 0 || budgetMs <= 0) return map

  const deadline = Date.now() + budgetMs
  let callsUsed = 0
  let budgetExhausted = false

  await runWithConcurrency(needsEnrichment, concurrency, async ({ sku, itemId }) => {
    if (budgetExhausted) return
    if (callsUsed >= maxApiCalls || Date.now() >= deadline) {
      budgetExhausted = true
      return
    }
    callsUsed += 1

    // Cache enabled on purpose: a repeated draft run for the same SKUs costs no quota.
    const detail = await withDeadline(
      fetchItemById(itemId, { source: 'amazon_initial_draft_zoho_barcode_detail' }),
      deadline
    )

    if (detail.timedOut) {
      budgetExhausted = true
      return
    }
    if (!detail.value || skuKey(detail.value.sku) !== skuKey(sku)) return

    const barcode = extractBarcodeText(detail.value)
    if (!barcode) return
    map.set(sku, result(sku, 'found', { zohoSku: cleanSku(detail.value.sku), itemId, barcode }))
  })

  if (budgetExhausted) {
    for (const { sku } of needsEnrichment) {
      const current = map.get(sku)
      if (current && current.status !== 'found') {
        map.set(sku, { ...current, reason: 'zoho-lookup-budget-exceeded' })
      }
    }
  }

  return map
}

/** Single-SKU convenience wrapper over the batch path. */
async function lookupZohoBarcodeByExactSku(sku, options = {}) {
  const needle = cleanSku(sku)
  if (!needle) return result('', 'not-found', { reason: 'sku-blank' })
  const map = await lookupZohoBarcodesByExactSkus([needle], options)
  return map.get(needle) || result(needle, 'not-found', { reason: 'zoho-sku-not-in-cache' })
}

module.exports = {
  extractBarcodeText,
  lookupZohoBarcodeByExactSku,
  lookupZohoBarcodesByExactSkus,
  pickExactSkuMatches,
}

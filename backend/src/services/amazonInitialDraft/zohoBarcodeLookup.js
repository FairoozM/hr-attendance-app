'use strict'

/**
 * Barcode lookup for the Amazon Initial Draft Generator.
 *
 * How Life Smile's Zoho data is actually shaped, verified against the whole item cache
 * (1,484 items) and live item detail:
 *
 *   - the Zoho SKU field holds the barcode        e.g. sku  = '6294021012386'
 *   - the Zoho item name holds the seller SKU     e.g. name = 'LIFEP17S-6-2-BEIGE'
 *   - upc / ean / isbn / part_number are empty on every item, so they are not read
 *
 * So an Amazon seller SKU is matched against the Zoho item NAME, and the barcode is read
 * out of the Zoho SKU field. Matching is exact on the trimmed string, case-insensitively,
 * because the workbook and Zoho disagree on casing for the same code. Nothing else is
 * normalised: a differing separator or suffix is a different product.
 *
 * Both fields arrive in the cached items-list payload, so a whole upload is resolved in a
 * single database query with no Zoho API call. That matters — the generator runs inside
 * one HTTP request behind a 30s CloudFront origin timeout, and Zoho's rate limiter can
 * park a single call for 15s.
 *
 * Zoho is only ever read here. The barcode stored in Zoho is never rewritten.
 */

const { findItemsByNames } = require('../zohoBulkInvoiceStore')

function cleanText(value) {
  return String(value == null ? '' : value).trim()
}

/** Exact match key: trimmed, case folded. */
function matchKey(value) {
  return cleanText(value).toLowerCase()
}

/**
 * The barcode as Zoho stores it. The SKU field is the source; upc/ean/isbn are still
 * checked first so that an item which does get a real barcode field later wins over the
 * SKU field without a code change.
 */
function extractBarcodeText(item) {
  if (!item || typeof item !== 'object') return ''
  const rawJson = item.raw_json && typeof item.raw_json === 'object' ? item.raw_json : null
  const candidates = [
    item.upc,
    item.ean,
    item.isbn,
    rawJson?.upc,
    rawJson?.ean,
    rawJson?.isbn,
    item.sku,
    rawJson?.sku,
  ]
  for (const candidate of candidates) {
    const text = cleanText(candidate)
    if (text) return text
  }
  return ''
}

/**
 * The item cache is keyed on the Zoho SKU, which here is the barcode, so changing an
 * item's barcode in Zoho leaves the old row behind under the same item name. Rows left
 * over from an earlier sync are dropped rather than reported as ambiguous: a row is stale
 * when it was last synced well before the freshest row for the same name. The window is
 * generous because one sync run timestamps its rows seconds apart, and two genuinely
 * distinct items sharing a name must still come out ambiguous.
 */
const STALE_ROW_WINDOW_MS = 60 * 60 * 1000

function syncedAtMs(row) {
  const value = row && row.last_synced_at ? new Date(row.last_synced_at).getTime() : NaN
  return Number.isFinite(value) ? value : null
}

function dropStaleDuplicates(rows) {
  if (rows.length < 2) return rows
  const timestamps = rows.map(syncedAtMs).filter((value) => value !== null)
  if (timestamps.length !== rows.length) return rows

  const newest = Math.max(...timestamps)
  return rows.filter((row) => newest - syncedAtMs(row) <= STALE_ROW_WINDOW_MS)
}

/** Cached rows whose Zoho item name equals `sellerSku`. */
function pickExactNameMatches(items, sellerSku) {
  const needle = matchKey(sellerSku)
  if (!needle) return []
  return (Array.isArray(items) ? items : []).filter((item) => {
    const rawJson = item?.raw_json && typeof item.raw_json === 'object' ? item.raw_json : null
    return matchKey(item?.name) === needle || matchKey(rawJson?.name) === needle
  })
}

function result(sku, status, { zohoSku = '', zohoItemName = '', itemId = '', barcode = '', reason = null } = {}) {
  return { sku, status, zohoSku, zohoItemName, itemId, barcode, reason }
}

/**
 * Resolves the Zoho barcode for every seller SKU in one database query.
 *
 * @param {string[]} sellerSkus seller SKUs exactly as they appear in the workbook
 * @returns {Promise<Map<string, {
 *   sku: string,
 *   status: 'found'|'not-found'|'ambiguous'|'error',
 *   zohoSku: string,
 *   zohoItemName: string,
 *   itemId: string,
 *   barcode: string,
 *   reason: string|null,
 * }>>}
 */
async function lookupZohoBarcodesByExactSkus(sellerSkus) {
  const unique = []
  const seen = new Set()
  for (const sellerSku of Array.isArray(sellerSkus) ? sellerSkus : []) {
    const clean = cleanText(sellerSku)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    unique.push(clean)
  }

  const map = new Map()
  if (!unique.length) return map

  let rows = []
  try {
    rows = await findItemsByNames(unique)
  } catch (err) {
    for (const sellerSku of unique) {
      map.set(sellerSku, result(sellerSku, 'error', { reason: (err && err.message) || 'zoho-cache-query-failed' }))
    }
    return map
  }

  for (const sellerSku of unique) {
    const matches = dropStaleDuplicates(pickExactNameMatches(rows, sellerSku))

    if (matches.length > 1) {
      map.set(sellerSku, result(sellerSku, 'ambiguous', { reason: 'zoho-item-name-ambiguous' }))
      continue
    }

    const row = matches[0]
    if (!row) {
      map.set(sellerSku, result(sellerSku, 'not-found', { reason: 'zoho-item-name-not-found' }))
      continue
    }

    const barcode = extractBarcodeText(row)
    const common = {
      zohoSku: cleanText(row.sku),
      zohoItemName: cleanText(row.name),
      itemId: row.item_id != null ? String(row.item_id) : '',
    }

    if (!barcode) {
      map.set(sellerSku, result(sellerSku, 'not-found', { ...common, reason: 'zoho-barcode-blank' }))
      continue
    }

    map.set(sellerSku, result(sellerSku, 'found', { ...common, barcode }))
  }

  return map
}

/** Single-SKU convenience wrapper over the batch path. */
async function lookupZohoBarcodeByExactSku(sellerSku) {
  const needle = cleanText(sellerSku)
  if (!needle) return result('', 'not-found', { reason: 'sku-blank' })
  const map = await lookupZohoBarcodesByExactSkus([needle])
  return map.get(needle) || result(needle, 'not-found', { reason: 'zoho-item-name-not-found' })
}

module.exports = {
  extractBarcodeText,
  lookupZohoBarcodeByExactSku,
  lookupZohoBarcodesByExactSkus,
  pickExactNameMatches,
}

'use strict'

/**
 * Amazon seller SKU → Zoho item suggestion for the Control Tower SKU master.
 *
 * Unlike the stock-comparison index (first Zoho row wins per key), every Zoho item reachable from
 * the Amazon SKU is collected. Exactly one distinct item → AUTO_MATCHED (a suggestion, never
 * CONFIRMED). More than one → REVIEW_REQUIRED with all candidates. None → UNMAPPED.
 *
 * Keys, strongest first:
 *   EXACT_ITEM_CODE       normalizeSku(Zoho sku/item code) === normalizeSku(Amazon SKU)
 *   EXACT_ITEM_NAME       normalizeSku(Zoho item name)     === normalizeSku(Amazon SKU)
 *   NORMALIZED_ITEM_CODE  same after dash / space / underscore folding (expandExactMatchVariants)
 *   NORMALIZED_ITEM_NAME  same, against the item name
 */

const { normalizeSku } = require('../../utils/normalizeSku')
const { expandExactMatchVariants } = require('../../utils/purchasePlanningSkuMatcher')

const MAPPING_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  AUTO_MATCHED: 'AUTO_MATCHED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  UNMAPPED: 'UNMAPPED',
})

const MATCH_METHOD = Object.freeze({
  EXACT_ITEM_CODE: 'EXACT_ITEM_CODE',
  EXACT_ITEM_NAME: 'EXACT_ITEM_NAME',
  NORMALIZED_ITEM_CODE: 'NORMALIZED_ITEM_CODE',
  NORMALIZED_ITEM_NAME: 'NORMALIZED_ITEM_NAME',
})

const METHOD_CONFIDENCE: Record<string, number> = {
  EXACT_ITEM_CODE: 1,
  EXACT_ITEM_NAME: 0.95,
  NORMALIZED_ITEM_CODE: 0.85,
  NORMALIZED_ITEM_NAME: 0.8,
}
const METHOD_RANK: Record<string, number> = {
  EXACT_ITEM_CODE: 0,
  EXACT_ITEM_NAME: 1,
  NORMALIZED_ITEM_CODE: 2,
  NORMALIZED_ITEM_NAME: 3,
}
const AMBIGUOUS_CONFIDENCE_CAP = 0.5

type ZohoCatalogItem = { zohoItemId: string; itemCode: string | null; itemName: string | null }

type MatchCandidate = {
  zohoItemId: string
  itemCode: string | null
  itemName: string | null
  method: string
  confidence: number
}

type MatchResult = {
  status: 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'UNMAPPED'
  zohoItemId: string | null
  itemCode: string | null
  itemName: string | null
  method: string | null
  confidence: number | null
  candidates: MatchCandidate[]
}

type MatchIndex = {
  exactCode: Map<string, Set<string>>
  exactName: Map<string, Set<string>>
  foldedCode: Map<string, Set<string>>
  foldedName: Map<string, Set<string>>
  items: Map<string, ZohoCatalogItem>
}

function addKey(map: Map<string, Set<string>>, key: string, itemId: string) {
  if (!key) return
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(itemId)
}

/** Separator-insensitive form used for the "normalized" tiers. */
function foldKey(raw: string): string {
  return normalizeSku(raw).replace(/[\s_-]+/g, '')
}

function foldedVariants(raw: string): string[] {
  const out = new Set<string>()
  for (const v of expandExactMatchVariants(raw)) {
    const folded = foldKey(v)
    if (folded) out.add(folded)
  }
  return [...out]
}

function buildZohoMatchIndex(catalog: ZohoCatalogItem[]): MatchIndex {
  const index: MatchIndex = {
    exactCode: new Map(),
    exactName: new Map(),
    foldedCode: new Map(),
    foldedName: new Map(),
    items: new Map(),
  }
  for (const item of catalog || []) {
    const id = String(item?.zohoItemId || '').trim()
    if (!id || index.items.has(id)) continue
    index.items.set(id, item)
    const code = String(item.itemCode || '')
    const name = String(item.itemName || '')
    addKey(index.exactCode, normalizeSku(code), id)
    addKey(index.exactName, normalizeSku(name), id)
    for (const v of foldedVariants(code)) addKey(index.foldedCode, v, id)
    for (const v of foldedVariants(name)) addKey(index.foldedName, v, id)
  }
  return index
}

function matchAmazonSku(sellerSku: string, index: MatchIndex): MatchResult {
  const exact = normalizeSku(sellerSku)
  const folded = foldedVariants(sellerSku)
  const best = new Map<string, string>()
  const consider = (ids: Set<string> | undefined, method: string) => {
    if (!ids) return
    for (const id of ids) {
      const prev = best.get(id)
      if (!prev || METHOD_RANK[method] < METHOD_RANK[prev]) best.set(id, method)
    }
  }
  if (exact) {
    consider(index.exactCode.get(exact), MATCH_METHOD.EXACT_ITEM_CODE)
    consider(index.exactName.get(exact), MATCH_METHOD.EXACT_ITEM_NAME)
  }
  for (const key of folded) {
    consider(index.foldedCode.get(key), MATCH_METHOD.NORMALIZED_ITEM_CODE)
    consider(index.foldedName.get(key), MATCH_METHOD.NORMALIZED_ITEM_NAME)
  }

  const candidates: MatchCandidate[] = [...best.entries()]
    .map(([id, method]) => {
      const item = index.items.get(id) as ZohoCatalogItem
      return {
        zohoItemId: id,
        itemCode: item.itemCode || null,
        itemName: item.itemName || null,
        method,
        confidence: METHOD_CONFIDENCE[method],
      }
    })
    .sort((a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method] || a.zohoItemId.localeCompare(b.zohoItemId))

  if (candidates.length === 0) {
    return { status: 'UNMAPPED', zohoItemId: null, itemCode: null, itemName: null, method: null, confidence: null, candidates: [] }
  }
  const top = candidates[0]
  if (candidates.length === 1) {
    return {
      status: 'AUTO_MATCHED',
      zohoItemId: top.zohoItemId,
      itemCode: top.itemCode,
      itemName: top.itemName,
      method: top.method,
      confidence: top.confidence,
      candidates,
    }
  }
  return {
    status: 'REVIEW_REQUIRED',
    zohoItemId: null,
    itemCode: null,
    itemName: null,
    method: top.method,
    confidence: Math.min(top.confidence, AMBIGUOUS_CONFIDENCE_CAP),
    candidates: candidates.slice(0, 10),
  }
}

module.exports = {
  MAPPING_STATUS,
  MATCH_METHOD,
  buildZohoMatchIndex,
  matchAmazonSku,
  _internals: { foldKey, foldedVariants },
}

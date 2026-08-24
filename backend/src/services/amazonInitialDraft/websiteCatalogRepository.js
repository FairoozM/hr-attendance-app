'use strict'

/**
 * Catalog reads for the Initial Draft Generator.
 *
 * One parameterized round trip covers a whole upload. Seller SKUs are matched against
 * the approved union of `products.item_code` and `product_variants.item_code`.
 *
 * The catalog genuinely contains ambiguous codes — 17 item codes appear on more than
 * one product, and 35 appear on both a product and an unrelated product's variant — so
 * a SKU resolving to more than one row is reported as ambiguous and nothing is written
 * for it. Collapsing those silently would put one product's data on another's listing.
 */

const lifesmileWebsiteDb = require('../../db/lifesmileWebsiteDb')
const { cleanText, normalizeSpecEntries } = require('./specParsers')

/**
 * Matching is case-insensitive and trimmed at the SQL layer so that a near miss can be
 * reported as a case mismatch rather than silently disappearing. Only an exactly equal
 * trimmed code is ever treated as a match.
 */
const CATALOG_QUERY = `
WITH requested AS (
  SELECT DISTINCT upper(btrim(code)) AS lookup_key
  FROM unnest($1::text[]) AS code
  WHERE btrim(code) <> ''
)
SELECT
  'product'::text                       AS match_source,
  p.id                                  AS product_id,
  NULL::int                             AS variant_id,
  btrim(p.item_code)                    AS item_code,
  p.name                                AS product_name,
  p.variant_type::text                  AS variant_type,
  p.status::text                        AS status,
  p.color                               AS color,
  p.size                                AS size,
  p.material                            AS material,
  NULL::text                            AS parent_item_code,
  (
    SELECT count(*) FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
  )                                     AS variant_count,
  ps.short_description                  AS short_description,
  ps.long_description                   AS long_description,
  ps.en_specifications                  AS en_specifications,
  ps.weight_dimensions                  AS weight_dimensions,
  pc.name                               AS category_name,
  sc.name                               AS sub_category_name
FROM products p
LEFT JOIN product_specifications ps ON ps.product_id = p.id AND ps.deleted_at IS NULL
LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.deleted_at IS NULL
LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id AND sc.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND upper(btrim(p.item_code)) IN (SELECT lookup_key FROM requested)
UNION ALL
SELECT
  'variant'::text,
  parent.id,
  v.id,
  btrim(v.item_code),
  parent.name,
  parent.variant_type::text,
  v.status::text,
  v.color,
  v.size,
  v.material,
  btrim(parent.item_code),
  0,
  ps.short_description,
  ps.long_description,
  ps.en_specifications,
  ps.weight_dimensions,
  pc.name,
  sc.name
FROM product_variants v
JOIN products parent ON parent.id = v.product_id AND parent.deleted_at IS NULL
LEFT JOIN product_specifications ps ON ps.product_id = parent.id AND ps.deleted_at IS NULL
LEFT JOIN product_categories pc ON pc.id = parent.category_id AND pc.deleted_at IS NULL
LEFT JOIN sub_categories sc ON sc.id = parent.sub_category_id AND sc.deleted_at IS NULL
WHERE v.deleted_at IS NULL
  AND upper(btrim(v.item_code)) IN (SELECT lookup_key FROM requested)
`

/** Shapes one database row into the object the mapping layer consumes. */
function toCatalogItem(row) {
  return {
    matchSource: row.match_source,
    productId: row.product_id,
    variantId: row.variant_id,
    itemCode: cleanText(row.item_code),
    productName: row.product_name,
    variantType: row.variant_type,
    status: row.status,
    color: row.color,
    size: row.size,
    material: row.material,
    parentItemCode: row.parent_item_code,
    variantCount: Number(row.variant_count) || 0,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    specs: normalizeSpecEntries(row.en_specifications),
    weightDimensions: normalizeSpecEntries(row.weight_dimensions),
    categoryName: row.category_name,
    subCategoryName: row.sub_category_name,
  }
}

function describeCandidate(item) {
  return {
    matchSource: item.matchSource,
    productId: item.productId,
    variantId: item.variantId,
    itemCode: item.itemCode,
    productName: cleanText(item.productName),
    status: item.status,
  }
}

/**
 * Resolves seller SKUs to catalog items.
 *
 * @param {string[]} skus seller SKUs exactly as they appear in the workbook
 * @param {{ readQuery?: Function }} [deps] injection point for tests
 * @returns {Promise<Map<string, object>>} keyed by the trimmed SKU as supplied
 */
async function findCatalogItemsBySku(skus, deps = {}) {
  const readQuery = deps.readQuery || lifesmileWebsiteDb.readQuery

  const requested = []
  const seen = new Set()
  for (const sku of skus || []) {
    const trimmed = cleanText(sku)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    requested.push(trimmed)
  }

  const resolved = new Map()
  if (!requested.length) return resolved

  const result = await readQuery(CATALOG_QUERY, [requested])
  const rows = (result && result.rows) || []

  const byLookupKey = new Map()
  for (const row of rows) {
    const item = toCatalogItem(row)
    const key = item.itemCode.toUpperCase()
    if (!byLookupKey.has(key)) byLookupKey.set(key, [])
    byLookupKey.get(key).push(item)
  }

  for (const sku of requested) {
    // Only letter case and surrounding whitespace are normalised for the lookup. Internal
    // hyphens, underscores and every other character are significant, so `LS_POT_24` never
    // reaches `LS-POT-24`.
    const candidates = byLookupKey.get(sku.toUpperCase()) || []
    const exact = candidates.filter((item) => item.itemCode === sku)

    if (exact.length === 1) {
      // An exact match always wins, even when the catalog also holds a differently cased
      // code for another product.
      resolved.set(sku, {
        status: 'matched',
        matchKind: 'exact',
        item: exact[0],
        candidates: exact.map(describeCandidate),
      })
    } else if (exact.length > 1) {
      resolved.set(sku, {
        status: 'ambiguous',
        item: null,
        candidates: exact.map(describeCandidate),
        reason: 'sku-resolves-to-multiple-catalog-rows',
      })
    } else if (candidates.length === 1) {
      // No exact match, and exactly one catalog item differs by letter case alone, so the
      // intent is unambiguous. The seller's own SKU text stays in the workbook untouched.
      resolved.set(sku, {
        status: 'matched',
        matchKind: 'case-insensitive',
        item: candidates[0],
        candidates: candidates.map(describeCandidate),
        reason: 'matched-ignoring-letter-case',
      })
    } else if (candidates.length > 1) {
      // Several products share this code once case is ignored. Picking one would risk
      // putting one product's content on another's listing.
      resolved.set(sku, {
        status: 'ambiguous',
        item: null,
        candidates: candidates.map(describeCandidate),
        reason: 'case-insensitive-match-resolves-to-multiple-catalog-rows',
      })
    } else {
      resolved.set(sku, { status: 'unmatched', item: null, candidates: [], reason: 'not-in-catalog' })
    }
  }

  return resolved
}

module.exports = {
  CATALOG_QUERY,
  findCatalogItemsBySku,
  toCatalogItem,
}

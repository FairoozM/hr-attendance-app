const {
  normalizeSku,
  buildVigilIndexes,
  matchZohoSkuToVigilWithIndexes,
  expandExactMatchVariants,
} = require('../utils/purchasePlanningSkuMatcher')

const STATUS = {
  READY: 'Ready to Update',
  NO_STOCK: 'No Stock Available',
  ZOHO_NOT_MATCHED: 'Zoho SKU Not Matched',
  VIGIL_NOT_MATCHED: 'Vigil Not Matched',
  COLOR_BASE: 'Color/Base Match Used',
  MANUAL_REVIEW: 'Needs Manual Review',
}

const MATCH_METHOD = {
  DIRECT: 'direct',
  COLOR_BASE: 'color_base',
  MANUAL: 'manual',
  NONE: 'none',
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function resolveMaxRecommendedQty(bodyMax) {
  if (bodyMax != null && bodyMax !== '') {
    const n = toNumber(bodyMax, NaN)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  const envRaw = process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY
  if (envRaw == null || envRaw === '') return null
  const envN = toNumber(envRaw, NaN)
  return Number.isFinite(envN) && envN >= 0 ? Math.floor(envN) : null
}

function buildZohoLookup(zohoRows) {
  const map = new Map()
  for (const row of Array.isArray(zohoRows) ? zohoRows : []) {
    const sku = clean(row.sku || row.normalizedSku)
    const key = normalizeSku(sku)
    if (!key) continue
    if (!map.has(key)) map.set(key, row)
  }
  return map
}

function buildVigilIndexesWithDuplicates(vigilRows) {
  const indexes = buildVigilIndexes(vigilRows)
  const duplicateKeys = new Set()
  const exact = new Map()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const code = clean(row.itemCode || row.normalizedItemCode)
    if (!code) continue
    const entry = {
      code: normalizeSku(code),
      qty: toNumber(row.availableStock ?? row.available_qty ?? row.qty, 0),
      name: clean(row.itemName || row.item_name || ''),
      row,
    }
    for (const key of expandExactMatchVariants(code)) {
      if (exact.has(key)) {
        const prev = exact.get(key)
        if (prev.code !== entry.code || prev.qty !== entry.qty) duplicateKeys.add(key)
      } else {
        exact.set(key, entry)
      }
    }
  }
  return { indexes, duplicateKeys, vigilByCode: exact }
}

function matchAmazonSkuToVigilDirect(indexes, duplicateKeys, amazonSku) {
  for (const key of expandExactMatchVariants(amazonSku)) {
    if (duplicateKeys.has(key)) {
      return { matched: false, ambiguous: true, matchType: 'exact', duplicateKey: key }
    }
    const match = indexes.exact.get(key)
    if (match) {
      return {
        matched: true,
        ambiguous: false,
        matchType: 'exact',
        matchedVigilCode: match.code,
        vigilQty: match.qty,
        vigilName: clean(match.row?.itemName || match.row?.item_name || ''),
      }
    }
  }
  return { matched: false, ambiguous: false, matchType: 'not_found', matchedVigilCode: '', vigilQty: 0, vigilName: '' }
}

function buildVigilRowLookup(vigilRows) {
  const byCode = new Map()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const code = normalizeSku(row.itemCode || row.normalizedItemCode)
    if (code && !byCode.has(code)) byCode.set(code, row)
  }
  return byCode
}

function computeSummary(rows) {
  const summary = {
    totalOutOfStock: rows.length,
    readyToUpdate: 0,
    noStockAvailable: 0,
    zohoNotMatched: 0,
    vigilNotMatched: 0,
    needsManualReview: 0,
    colorBaseMatchUsed: 0,
    totalRecommendedUnits: 0,
  }
  for (const row of rows) {
    if (row.status === STATUS.READY) summary.readyToUpdate += 1
    if (row.status === STATUS.NO_STOCK) summary.noStockAvailable += 1
    if (row.status === STATUS.ZOHO_NOT_MATCHED) summary.zohoNotMatched += 1
    if (row.status === STATUS.VIGIL_NOT_MATCHED) summary.vigilNotMatched += 1
    if (row.status === STATUS.MANUAL_REVIEW) summary.needsManualReview += 1
    if (row.status === STATUS.COLOR_BASE) summary.colorBaseMatchUsed += 1
    summary.totalRecommendedUnits += toNumber(row.recommendedAmazonUpdateQty)
  }
  return summary
}

function calculateClearanceRows({
  amazonRows = [],
  zohoRows = [],
  vigilRows = [],
  manualMappings = {},
  maxRecommendedQty: bodyMax,
  respectManualOverrides = true,
  confirmOverwriteManual = false,
}) {
  const maxCap = resolveMaxRecommendedQty(bodyMax)
  const zohoBySku = buildZohoLookup(zohoRows)
  const { indexes, duplicateKeys } = buildVigilIndexesWithDuplicates(vigilRows)
  const vigilByCode = buildVigilRowLookup(vigilRows)

  const results = amazonRows.map((amazon) => {
    const amazonSku = clean(amazon.amazonSku || amazon.sellerSku || amazon.sku)
    const normalizedAmazon = normalizeSku(amazonSku)
    const manual = manualMappings[amazonSku] || manualMappings[normalizedAmazon] || null
    const prevManual = Boolean(manual?.locked) && respectManualOverrides && !confirmOverwriteManual

    let zohoSku = ''
    let zohoQty = 0
    let zohoItemName = ''
    let zohoMatched = false

    if (prevManual && manual.zohoSku) {
      const key = normalizeSku(manual.zohoSku)
      const z = zohoBySku.get(key)
      zohoSku = manual.zohoSku
      zohoQty = z ? toNumber(z.availableQty, 0) : toNumber(manual.zohoQty, 0)
      zohoItemName = z ? clean(z.itemName) : ''
      zohoMatched = Boolean(z || manual.zohoSku)
    } else {
      const z = zohoBySku.get(normalizedAmazon)
      if (z) {
        zohoMatched = true
        zohoSku = clean(z.sku || z.normalizedSku)
        zohoQty = toNumber(z.availableQty, 0)
        zohoItemName = clean(z.itemName)
      }
    }

    let vigilCode = ''
    let vigilName = ''
    let vigilQty = 0
    let matchMethod = MATCH_METHOD.NONE
    let vigilMatched = false
    let ambiguousVigil = false
    let notes = []

    if (prevManual && manual.vigilCode) {
      vigilCode = manual.vigilCode
      const vRow = vigilByCode.get(normalizeSku(vigilCode))
      vigilName = vRow ? clean(vRow.itemName) : clean(manual.vigilName || '')
      vigilQty = vRow ? toNumber(vRow.availableStock, 0) : toNumber(manual.vigilQty, 0)
      vigilMatched = true
      matchMethod = MATCH_METHOD.MANUAL
    } else if (zohoMatched) {
      const directAmazon = matchAmazonSkuToVigilDirect(indexes, duplicateKeys, amazonSku)
      if (directAmazon.ambiguous) {
        ambiguousVigil = true
        notes.push('Multiple Vigil items match Amazon SKU')
      } else if (directAmazon.matched) {
        vigilMatched = true
        vigilCode = directAmazon.matchedVigilCode
        vigilQty = directAmazon.vigilQty
        vigilName = directAmazon.vigilName
        matchMethod = MATCH_METHOD.DIRECT
      } else {
        const zohoMatch = matchZohoSkuToVigilWithIndexes(indexes, zohoSku || amazonSku)
        if (zohoMatch.matched) {
          for (const key of expandExactMatchVariants(zohoSku || amazonSku)) {
            if (duplicateKeys.has(key)) {
              ambiguousVigil = true
              notes.push('Multiple Vigil items match Zoho SKU variant')
              break
            }
          }
          if (!ambiguousVigil) {
            vigilMatched = true
            vigilCode = zohoMatch.matchedVigilCode
            vigilQty = toNumber(zohoMatch.wholesaleAvailableQty, 0)
            const vRow = vigilByCode.get(normalizeSku(vigilCode))
            vigilName = vRow ? clean(vRow.itemName) : ''
            matchMethod = zohoMatch.matchType === 'parent' ? MATCH_METHOD.COLOR_BASE : MATCH_METHOD.DIRECT
          }
        }
      }
    } else {
      const directAmazon = matchAmazonSkuToVigilDirect(indexes, duplicateKeys, amazonSku)
      if (directAmazon.ambiguous) ambiguousVigil = true
      else if (directAmazon.matched) {
        vigilMatched = true
        vigilCode = directAmazon.matchedVigilCode
        vigilQty = directAmazon.vigilQty
        vigilName = directAmazon.vigilName
        matchMethod = MATCH_METHOD.DIRECT
      }
    }

    const totalAvailable = Math.max(0, zohoQty) + Math.max(0, vigilQty)
    let recommended = totalAvailable
    if (maxCap != null) recommended = Math.min(recommended, maxCap)
    recommended = Math.max(0, Math.floor(recommended))

    if (prevManual && manual.recommendedQty != null && Number.isFinite(Number(manual.recommendedQty))) {
      recommended = Math.max(0, Math.floor(Number(manual.recommendedQty)))
    }

    let status = STATUS.MANUAL_REVIEW
    if (ambiguousVigil) {
      status = STATUS.MANUAL_REVIEW
    } else if (!zohoMatched) {
      status = STATUS.ZOHO_NOT_MATCHED
    } else if (totalAvailable === 0) {
      status = STATUS.NO_STOCK
    } else if (!vigilMatched) {
      status = STATUS.VIGIL_NOT_MATCHED
    } else if (matchMethod === MATCH_METHOD.COLOR_BASE) {
      status = recommended > 0 ? STATUS.COLOR_BASE : STATUS.NO_STOCK
    } else if (recommended > 0 && zohoMatched && (vigilMatched || (prevManual && manual.vigilCode))) {
      status = STATUS.READY
    } else if (recommended > 0) {
      status = STATUS.READY
    } else {
      status = STATUS.NO_STOCK
    }

    if (prevManual) {
      notes.push('Manually edited')
    }

    return {
      id: `${clean(amazon.marketplaceKey || amazon.marketplace)}:${normalizedAmazon}`,
      marketplace: clean(amazon.marketplace) || (String(amazon.marketplaceKey).toLowerCase() === 'ksa' ? 'KSA' : 'UAE'),
      marketplaceKey: clean(amazon.marketplaceKey) || 'uae',
      amazonSku,
      amazonTitle: clean(amazon.title || amazon.amazonTitle),
      amazonCurrentQty: toNumber(amazon.amazonCurrentQty ?? amazon.amazon?.availableQty, 0),
      zohoSku,
      zohoItemName,
      zohoLifeSmileQty: zohoQty,
      vigilMatchedCode: vigilCode,
      vigilMatchedName: vigilName,
      vigilQty,
      totalAvailableQty: totalAvailable,
      recommendedAmazonUpdateQty: recommended,
      matchMethod,
      status,
      notes: notes.join('; '),
      manuallyEdited: prevManual,
      zohoMatched,
      vigilMatched,
    }
  })

  return {
    rows: results,
    summary: computeSummary(results),
  }
}

function exportRowsForKind(rows, exportKind) {
  const kind = String(exportKind || 'full').toLowerCase()
  if (kind === 'ready') {
    return rows.filter((r) => r.status === STATUS.READY)
  }
  if (kind === 'manualreview' || kind === 'manual_review') {
    return rows.filter((r) => r.status === STATUS.MANUAL_REVIEW)
  }
  if (kind === 'updateresults' || kind === 'update_results') {
    return rows.filter((r) => r.updateResult)
  }
  return rows
}

function rowsToExportObjects(rows) {
  return rows.map((row) => ({
    'Amazon SKU': row.amazonSku,
    'Amazon Title': row.amazonTitle,
    Marketplace: row.marketplace,
    'Amazon Current Qty': row.amazonCurrentQty,
    'Zoho Life Smile Qty': row.zohoLifeSmileQty,
    'Zoho SKU': row.zohoSku,
    'Vigil Matched Code': row.vigilMatchedCode,
    'Vigil Matched Name': row.vigilMatchedName,
    'Vigil Qty': row.vigilQty,
    'Total Available Qty': row.totalAvailableQty,
    'Recommended Update Qty': row.recommendedAmazonUpdateQty,
    'Match Method': row.matchMethod,
    Status: row.status,
    Notes: row.notes,
    'Manually Edited': row.manuallyEdited ? 'Yes' : 'No',
    ...(row.updateResult
      ? {
          'Update Result': row.updateResult.status,
          'Update Message': row.updateResult.message || '',
        }
      : {}),
  }))
}

module.exports = {
  STATUS,
  MATCH_METHOD,
  calculateClearanceRows,
  exportRowsForKind,
  rowsToExportObjects,
  computeSummary,
}

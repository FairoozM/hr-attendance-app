const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSkuKey } = require('../src/utils/normalizeSkuKey')
const {
  resolveZohoMatchKey,
  buildChannelIndex,
  deriveCoverageStatus,
  buildCoverageRows,
  computeSummaryCards,
  filterCoverageRows,
  mapAmazonListingsToIndexEntries,
  mapNoonItemsToIndexEntries,
  buildMismatchNotes,
  attachVigilToCoverageRows,
} = require('../src/services/skuChannelCoverageMatching')

describe('normalizeSkuKey', () => {
  it('returns null for empty values', () => {
    assert.equal(normalizeSkuKey(null), null)
    assert.equal(normalizeSkuKey(''), null)
    assert.equal(normalizeSkuKey('   '), null)
  })

  it('trims, uppercases, and collapses internal spaces', () => {
    assert.equal(normalizeSkuKey('  ab  cd  '), 'AB CD')
    assert.equal(normalizeSkuKey('sku-100'), 'SKU-100')
  })
})

describe('resolveZohoMatchKey', () => {
  it('prefers Zoho SKU over item name', () => {
    assert.deepEqual(resolveZohoMatchKey({ sku: ' ls-01 ', name: 'Widget' }), {
      key: 'LS-01',
      source: 'sku',
    })
  })

  it('falls back to item name when SKU is missing', () => {
    assert.deepEqual(resolveZohoMatchKey({ sku: '', name: '  Blue  Towel  ' }), {
      key: 'BLUE TOWEL',
      source: 'item_name',
    })
  })
})

describe('channel index + coverage rows', () => {
  const zohoItems = [
    { zohoItemId: '1', zohoItemName: 'Widget A', zohoSku: 'W-A', sku: 'W-A', name: 'Widget A' },
    { zohoItemId: '2', zohoItemName: 'Widget B', zohoSku: '', sku: '', name: 'Widget B' },
    { zohoItemId: '3', zohoItemName: 'Widget C', zohoSku: 'W-C', sku: 'W-C', name: 'Widget C' },
  ]

  const amazonUae = buildChannelIndex(
    mapAmazonListingsToIndexEntries([{ sellerSku: 'W-A', listingStatus: 'ACTIVE' }])
  )
  const amazonKsa = buildChannelIndex(
    mapAmazonListingsToIndexEntries([{ sellerSku: 'W-C', listingStatus: 'ACTIVE' }])
  )
  const noon = buildChannelIndex(
    mapNoonItemsToIndexEntries([{ psku: 'WIDGET B', isActive: true }])
  )

  const rows = buildCoverageRows(zohoItems, { amazonUae, amazonKsa, noon })

  it('matches Amazon UAE by seller SKU', () => {
    const rowA = rows.find((r) => r.zohoItemId === '1')
    assert.equal(rowA.amazonUaeMatched, true)
    assert.equal(rowA.amazonKsaMatched, false)
    assert.equal(rowA.amazonUaeSku, 'W-A')
  })

  it('matches Noon by item name when Zoho SKU is empty', () => {
    const rowB = rows.find((r) => r.zohoItemId === '2')
    assert.equal(rowB.noonMatched, true)
    assert.equal(rowB.matchKeySource, 'item_name')
    assert.equal(rowB.coverageStatus, 'NOON_ONLY')
  })

  it('marks missing-all when not on any channel', () => {
    const rowC = rows.find((r) => r.zohoItemId === '3')
    assert.equal(rowC.amazonKsaMatched, true)
    assert.equal(rowC.noonMatched, false)
    assert.equal(rowC.coverageStatus, 'AMAZON_ONLY')
  })

  it('computes summary cards', () => {
    const summary = computeSummaryCards(rows)
    assert.equal(summary.totalActiveZohoItems, 3)
    assert.equal(summary.matchedAmazonAny, 2)
    assert.equal(summary.matchedNoon, 1)
    assert.equal(summary.missingAmazon, 1)
    assert.equal(summary.missingAllChannels, 0)
  })
})

describe('deriveCoverageStatus', () => {
  it('returns expected status codes', () => {
    assert.equal(deriveCoverageStatus(true, true), 'COMPLETE')
    assert.equal(deriveCoverageStatus(true, false), 'AMAZON_ONLY')
    assert.equal(deriveCoverageStatus(false, true), 'NOON_ONLY')
    assert.equal(deriveCoverageStatus(false, false), 'MISSING_ALL_CHANNELS')
  })
})

describe('filterCoverageRows', () => {
  const rows = [
    { zohoItemName: 'Alpha', zohoSku: 'A-1', zohoItemId: '1', amazonMatchedAny: true, noonMatched: true, coverageStatus: 'COMPLETE', amazonUaeMatched: true, amazonKsaMatched: false },
    { zohoItemName: 'Beta', zohoSku: 'B-2', zohoItemId: '2', amazonMatchedAny: false, noonMatched: true, coverageStatus: 'NOON_ONLY', amazonUaeMatched: false, amazonKsaMatched: false },
    { zohoItemName: 'Gamma', zohoSku: 'G-3', zohoItemId: '3', amazonMatchedAny: false, noonMatched: false, coverageStatus: 'MISSING_ALL_CHANNELS', amazonUaeMatched: false, amazonKsaMatched: false },
  ]

  it('filters missing Amazon', () => {
    const filtered = filterCoverageRows(rows, { filter: 'missingAmazon' })
    assert.equal(filtered.length, 2)
  })

  it('filters by search on name or SKU', () => {
    const filtered = filterCoverageRows(rows, { filter: 'all', search: 'b-2' })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].zohoSku, 'B-2')
  })
})

describe('buildMismatchNotes', () => {
  it('describes missing Amazon channels', () => {
    const notes = buildMismatchNotes({
      amazonUaeMatched: false,
      amazonKsaMatched: false,
      noonMatched: false,
      matchKeySource: 'sku',
    })
    assert.match(notes, /Not listed on Amazon UAE or KSA/)
    assert.match(notes, /Not listed on Noon/)
  })
})

describe('attachVigilToCoverageRows', () => {
  it('matches vigil item code to Zoho SKU exactly', () => {
    const rows = attachVigilToCoverageRows(
      [
        {
          zohoItemId: '1',
          zohoItemName: 'Widget',
          zohoSku: 'W-1',
          normalizedZohoKey: 'W-1',
          amazonUaeMatched: false,
          amazonKsaMatched: false,
          amazonMatchedAny: false,
          noonMatched: false,
        },
      ],
      [{ itemCode: 'w-1', availableStock: 15, itemName: 'Widget wholesale' }]
    )
    assert.equal(rows[0].vigilMatched, true)
    assert.equal(rows[0].vigilStockQty, 15)
    assert.equal(rows[0].vigilSku, 'w-1')
  })
})

describe('mapNoonItemsToIndexEntries', () => {
  it('indexes Noon PSKU only (not partner SKU or internal noon SKU)', () => {
    const entries = mapNoonItemsToIndexEntries([
      {
        partnerSku: 'Z8932717828D3FB066370Z-1',
        psku: 'R23G',
        sku: 'NOON-INTERNAL-1',
        isActive: true,
      },
    ])
    const index = buildChannelIndex(entries)
    assert.ok(index.has('R23G'))
    assert.equal(index.get('R23G').rawSku, 'R23G')
    assert.equal(index.has('Z8932717828D3FB066370Z-1'), false)
    assert.equal(index.has('NOON-INTERNAL-1'), false)
  })
})

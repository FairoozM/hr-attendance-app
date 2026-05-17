const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeBundleEconomics,
} = require('../src/services/compositePricingLogic')
const { REPORT_COMPOSITE_FILTER_BY } = require('../src/services/compositeItemsPriceReportService')

function sortCompositesByNameDesc(composites) {
  return [...(Array.isArray(composites) ? composites : [])].sort((a, b) =>
    String(b.name || '').localeCompare(String(a.name || ''))
  )
}

function selectCompositesForRun(composites, syncState, { mode, force, includeModified }) {
  if (force || mode === 'full' || !syncState?.row) {
    return sortCompositesByNameDesc(composites)
  }
  const known = syncState.knownIds || new Set()
  const lastModified = syncState.row?.last_seen_composite_modified_time
    ? new Date(syncState.row.last_seen_composite_modified_time).getTime()
    : 0
  return sortCompositesByNameDesc(composites.filter((c) => {
    if (!known.has(String(c.composite_item_id))) return true
    if (!includeModified) return false
    const modified = c.last_modified_time ? new Date(c.last_modified_time).getTime() : 0
    return Number.isFinite(modified) && modified > lastModified
  }))
}

test('sortCompositesByNameDesc sorts composite names descending', () => {
  const sorted = sortCompositesByNameDesc([
    { name: 'Alpha' },
    { name: 'Zulu' },
    { name: 'Middle' },
  ])
  assert.deepEqual(sorted.map((r) => r.name), ['Zulu', 'Middle', 'Alpha'])
})

test('composite price report fetches active composite items only', () => {
  assert.equal(REPORT_COMPOSITE_FILTER_BY, 'Status.Active')
})

test('purchase matching calculates component line total from All Prices', () => {
  const map = buildPurchasePriceMap([
    { itemNo: 'LIFEP17S-24-BEIGE', purchasePrice: 10.5, shipping: 2, dateOfPrices: '2026-05-15' },
  ])
  const result = findPurchaseMatchForComponent(map, {
    sku: '1234567890123',
    name: 'Life product',
    match_keys: ['LIFEP17S-24-BEIGE'],
  })
  assert.equal(result.status, 'matched')
  assert.equal(result.match.purchasePrice, 10.5)
  assert.equal(result.match.purchasePrice * 3, 31.5)
})

test('bundle economics uses existing VAT/commission/advertising/profit formula', () => {
  const economics = computeBundleEconomics(100, 20, {
    vatPct: 5,
    commissionPct: 15,
    advertisingPct: 15,
    requiredProfitPct: 25,
  })
  assert.equal(economics.ok, true)
  assert.equal(economics.salesPrice, 300)
  assert.equal(economics.totalCost, 225)
  assert.equal(economics.profitPct, 25)
})

test('unmatched component is visible and marks status as unmatched', () => {
  const map = buildPurchasePriceMap([{ itemNo: 'KNOWN-SKU', purchasePrice: 12 }])
  const result = findPurchaseMatchForComponent(map, { sku: 'UNKNOWN-SKU', name: 'Unknown component' })
  assert.equal(result.status, 'unmatched')
  assert.equal(result.match, null)
})

test('incremental selection only returns new IDs by default', () => {
  const composites = [
    { composite_item_id: 'old-1', name: 'Old' },
    { composite_item_id: 'new-1', name: 'New' },
  ]
  const selected = selectCompositesForRun(composites, {
    row: { last_seen_composite_modified_time: null },
    knownIds: new Set(['old-1']),
  }, {
    mode: 'incremental',
    force: false,
    includeModified: false,
  })
  assert.deepEqual(selected.map((r) => r.composite_item_id), ['new-1'])
})

test('full selection includes duplicate old IDs for full recalculation', () => {
  const composites = [
    { composite_item_id: 'old-1', name: 'Old' },
    { composite_item_id: 'new-1', name: 'New' },
  ]
  const selected = selectCompositesForRun(composites, {
    row: { last_seen_composite_modified_time: null },
    knownIds: new Set(['old-1']),
  }, {
    mode: 'full',
    force: false,
    includeModified: false,
  })
  assert.deepEqual(selected.map((r) => r.composite_item_id), ['old-1', 'new-1'])
})

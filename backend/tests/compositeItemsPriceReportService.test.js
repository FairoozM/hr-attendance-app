const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeBundleEconomics,
  computeAllPricesRowEconomics,
  resolveCompositeComponentPricing,
} = require('../src/services/compositePricingLogic')
const {
  REPORT_COMPOSITE_FILTER_BY,
  calculateParentPricing,
} = require('../src/services/compositeItemsPriceReportService')

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

test('duplicate active All Prices rows return duplicate active price status', () => {
  const map = buildPurchasePriceMap([
    { itemNo: 'DUP-SKU', purchasePrice: 12, shipping: 1 },
    { itemNo: 'dup-sku', purchasePrice: 14, shipping: 1 },
  ])
  const result = findPurchaseMatchForComponent(map, { sku: 'DUP-SKU', name: 'Duplicate component' })
  assert.equal(result.status, 'duplicate_active_price')
  assert.equal(result.match, null)
  assert.equal(result.matches.length, 2)

  const resolved = resolveCompositeComponentPricing({ sku: 'DUP-SKU' }, map)
  assert.equal(resolved.matchStatus, 'DUPLICATE_ACTIVE_PRICE')
  assert.equal(resolved.matchedAllPricesRecordFound, false)
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

test('parent pricing is incomplete when manual shipping is missing', () => {
  const parent = calculateParentPricing({
    purchasePrice: 15.25,
    manualShipping: '',
    missingComponentsCount: 0,
    rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
  })
  assert.equal(parent.pricing_status, 'incomplete')
  assert.equal(parent.missing_shipping, true)
  assert.equal(parent.suggested_sales_price, null)
})

test('parent pricing uses manual shipping and not component standalone shipping', () => {
  const parent = calculateParentPricing({
    purchasePrice: 15.25,
    manualShipping: 19,
    missingComponentsCount: 0,
    rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
    dateOfPrice: '2026-05-17',
  })
  assert.equal(parent.pricing_status, 'complete')
  assert.equal(parent.suggested_sales_price, 86)
  assert.equal(parent.vat_5_percent, 4.3)
  assert.equal(parent.commission_15_percent, 12.9)
  assert.equal(parent.advertising_15_percent, 12.9)
  assert.equal(parent.total_cost, 64.35)
  assert.equal(Number(parent.profit.toFixed(2)), 21.65)
  assert.equal(Number(parent.profit_percent_of_sales.toFixed(2)), 25.17)
})

test('missing or ambiguous component keeps parent incomplete even with shipping', () => {
  const parent = calculateParentPricing({
    purchasePrice: 15.25,
    manualShipping: 19,
    missingComponentsCount: 1,
    rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
  })
  assert.equal(parent.pricing_status, 'incomplete')
  assert.equal(parent.missing_component_price, true)
})

test('child standalone All Prices economics are independent of parent bundle pricing', () => {
  const child = computeAllPricesRowEconomics(
    { purchasePrice: 2.97, shipping: 0 },
    { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }
  )
  const parent = calculateParentPricing({
    purchasePrice: 15.25,
    manualShipping: 19,
    missingComponentsCount: 0,
    rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
  })
  assert.equal(child.denominatorInvalid, false)
  assert.notEqual(child.salesPrice, parent.suggested_sales_price)
  assert.equal(parent.suggested_sales_price, 86)
})

test('component resolver returns full All Prices audit fields for exact SKU match', () => {
  const resolved = resolveCompositeComponentPricing(
    {
      item_id: 'zoho-1',
      sku: 'TOOL-36-BEIGE',
      name: 'Tool 36 Beige',
      quantity: 2,
      zoho_purchase_rate: 5,
      match_keys: ['TOOL-36-BEIGE'],
    },
    [{ itemNo: 'TOOL-36-BEIGE', purchasePrice: 2.97, shipping: 19, dateOfPrices: '2026-05-17' }],
    { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }
  )
  assert.equal(resolved.matchedAllPricesRecordFound, true)
  assert.equal(resolved.matchedAllPricesItemNo, 'TOOL-36-BEIGE')
  assert.equal(resolved.matchedAllPricesSku, 'TOOL-36-BEIGE')
  assert.equal(resolved.purchasePrice, 2.97)
  assert.equal(resolved.linePurchaseTotal, 5.94)
  assert.equal(resolved.salesPriceAed, 55)
  assert.equal(resolved.vat5, 2.75)
  assert.equal(resolved.commission15, 8.25)
  assert.equal(resolved.advertising15, 8.25)
  assert.equal(resolved.shipping, 19)
  assert.equal(resolved.totalCost, 41.22)
  assert.equal(Number(resolved.profitAed.toFixed(2)), 13.78)
  assert.equal(Number(resolved.profitPercent.toFixed(2)), 25.05)
  assert.equal(resolved.pricingStatus, 'complete')
  assert.equal(resolved.dateOfPrice, '2026-05-17')
})

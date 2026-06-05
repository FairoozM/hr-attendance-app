const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

describe('vigilZohoStockCompareService', () => {
  let restores = []

  beforeEach(() => {
    restores = []
    restores.push(
      mockModule('../src/services/zohoLifeSmileWarehouseService', {
        fetchAllLifeSmileWarehouseStock: async () => ({
          warehouse: { warehouseId: 'wh1', warehouseName: 'Life Smile Warehouse' },
          itemCount: 2,
          fetchedAt: '2026-06-05T12:00:00.000Z',
          index: new Map([
            [
              'W-A',
              {
                itemId: '101',
                sku: 'W-A',
                itemName: 'Widget A',
                availableQty: 12,
                stockStatus: 'In Stock',
              },
            ],
            [
              'RING-12',
              {
                itemId: '102',
                sku: 'RING-12',
                itemName: 'Ring 12',
                availableQty: 0,
                stockStatus: 'Out of Stock',
              },
            ],
          ]),
        }),
        lookupZohoEntry: (index, key) => index.get(key) || null,
        normalizeSku: (value) =>
          String(value == null ? '' : value)
            .trim()
            .toUpperCase(),
      })
    )
  })

  afterEach(() => {
    for (const restore of restores) restore()
  })

  it('matches vigil rows to Zoho Life Smile warehouse quantities', async () => {
    const service = freshRequire('../src/services/vigilZohoStockCompareService')
    service.clearVigilZohoStockCache()
    const data = await service.buildVigilZohoCompare({
      vigilRows: [
        { itemCode: 'W-A', itemName: 'Widget wholesale', availableStock: 5 },
        { itemCode: 'RING-12-ROSE-GOLD', itemName: 'Ring rose', availableStock: 0 },
        { itemCode: 'MISSING', itemName: 'Ghost', availableStock: 3 },
      ],
    })
    assert.equal(data.success, true)
    assert.equal(data.summary.totalVigilRows, 3)
    assert.equal(data.summary.matchedZoho, 2)
    assert.equal(data.summary.vigilZero, 1)
    assert.equal(data.summary.bothZero, 1)

    const rowA = data.rows.find((r) => r.vigilSku === 'W-A')
    assert.equal(rowA.zohoMatched, true)
    assert.equal(rowA.zohoStockQty, 12)
    assert.equal(rowA.vigilStockQty, 5)
    assert.equal(rowA.stockAlert, 'IN_STOCK')

    const rowRing = data.rows.find((r) => r.vigilSku === 'RING-12-ROSE-GOLD')
    assert.equal(rowRing.zohoMatched, true)
    assert.equal(rowRing.stockAlert, 'BOTH_ZERO')

    const rowMissing = data.rows.find((r) => r.vigilSku === 'MISSING')
    assert.equal(rowMissing.zohoMatched, false)
    assert.equal(rowMissing.stockAlert, 'ZOHO_NOT_FOUND')
  })

  it('filters vigil-zero rows', async () => {
    const service = freshRequire('../src/services/vigilZohoStockCompareService')
    service.clearVigilZohoStockCache()
    const data = await service.buildVigilZohoCompare({
      vigilRows: [
        { itemCode: 'W-A', availableStock: 5 },
        { itemCode: 'RING-12-ROSE-GOLD', availableStock: 0 },
      ],
      filter: 'vigilZero',
    })
    assert.equal(data.rows.length, 1)
    assert.equal(data.rows[0].vigilSku, 'RING-12-ROSE-GOLD')
  })
})

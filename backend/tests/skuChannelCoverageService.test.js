const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

describe('skuChannelCoverageService', () => {
  let restores = []

  beforeEach(() => {
    restores = []
    restores.push(
      mockModule('../src/integrations/zoho/zohoAdapter', {
        readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
        fetchAllItemsRaw: async () => [
          { item_id: '101', name: 'Widget A', sku: 'W-A', status: 'active' },
          { item_id: '102', name: 'Widget B', sku: 'W-B', status: 'active' },
        ],
      })
    )
    restores.push(
      mockModule('../src/services/amazonZohoStockComparisonStore', {
        selectAllComparisonRows: async ({ marketplace }) =>
          marketplace === 'uae'
            ? [{ sellerSku: 'W-A', normalizedSku: 'W-A', listingStatus: 'ACTIVE', asin: 'B001' }]
            : [{ sellerSku: 'W-B', normalizedSku: 'W-B', listingStatus: 'ACTIVE', asin: 'B002' }],
        getLatestComparisonGeneratedAt: async () => new Date().toISOString(),
      })
    )
    restores.push(
      mockModule('../src/services/noon/noonSnapshotStore', {
        getNoonProductSnapshotsForAudit: async () => [
          { partner_sku: 'W-A', noon_sku: 'N-A', is_active: true, pricing_status_code: 'ACTIVE' },
        ],
      })
    )
    restores.push(
      mockModule('../src/services/noon/noonProductService', {
        fetchAllEligibleCatalogItems: async () => ({ items: [] }),
      })
    )
    restores.push(
      mockModule('../src/controllers/debugZohoController', {
        stockOnHandField: () => 5,
      })
    )
  })

  afterEach(() => {
    for (const restore of restores) restore()
  })

  it('returns Zoho rows using cached Amazon listings without live SP-API', async () => {
    const service = freshRequire('../src/services/skuChannelCoverageService')
    service.clearSkuChannelCoverageCache()
    const data = await service.getSkuChannelCoverageSummary({ filter: 'all' })
    assert.equal(data.success, true)
    assert.equal(data.meta.zohoItemCount, 2)
    assert.equal(data.summary.totalActiveZohoItems, 2)
    assert.equal(data.meta.amazonUaeSource, 'cache')
    assert.equal(data.rows.length, 2)
  })
})

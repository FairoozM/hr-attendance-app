import { describe, expect, it } from 'vitest'
import { attachVigilToCoverageRows, countVigilMatched } from './skuChannelCoverageVigil'

const baseRow = {
  zohoItemId: '1',
  zohoItemName: 'Widget',
  zohoSku: 'W-100',
  normalizedZohoKey: 'W-100',
  amazonUaeMatched: false,
  amazonKsaMatched: false,
  amazonMatchedAny: false,
  noonMatched: false,
  amazonUaeSku: null,
  amazonKsaSku: null,
  noonSku: null,
  amazonUaeStatus: null,
  amazonKsaStatus: null,
  noonStatus: null,
  coverageStatus: 'MISSING_ALL_CHANNELS',
  notes: '',
}

describe('skuChannelCoverageVigil', () => {
  it('attaches vigil stock by exact Zoho SKU match', () => {
    const rows = attachVigilToCoverageRows([baseRow], [
      { itemCode: 'w-100', availableStock: 42, itemName: 'Widget wholesale' },
    ])
    expect(rows[0].vigilMatched).toBe(true)
    expect(rows[0].vigilSku).toBe('w-100')
    expect(rows[0].vigilStockQty).toBe(42)
    expect(countVigilMatched(rows)).toBe(1)
  })

  it('returns unmatched vigil fields when no upload is present', () => {
    const rows = attachVigilToCoverageRows([baseRow], [])
    expect(rows[0].vigilMatched).toBe(false)
    expect(rows[0].vigilStockQty).toBe(null)
  })
})

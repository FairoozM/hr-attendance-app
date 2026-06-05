import { describe, expect, it } from 'vitest'
import {
  parseCoverageFilter,
  coverageStatusLabel,
  channelBadgeClass,
  paginateRows,
  countMissingAmazon,
} from './skuChannelCoverageFilters'

describe('skuChannelCoverageFilters', () => {
  it('parseCoverageFilter falls back to all for unknown values', () => {
    expect(parseCoverageFilter('missingAmazon')).toBe('missingAmazon')
    expect(parseCoverageFilter('invalid')).toBe('all')
  })

  it('coverageStatusLabel maps known statuses', () => {
    expect(coverageStatusLabel('COMPLETE')).toBe('Complete')
    expect(coverageStatusLabel('MISSING_ALL_CHANNELS')).toBe('Missing all channels')
  })

  it('channelBadgeClass emphasizes Amazon over Noon', () => {
    expect(channelBadgeClass(true, 'amazon')).toContain('amazon-ok')
    expect(channelBadgeClass(false, 'amazon')).toContain('amazon-miss')
    expect(channelBadgeClass(true, 'noon')).toContain('noon-ok')
  })

  it('paginateRows slices correctly', () => {
    const rows = [1, 2, 3, 4, 5]
    expect(paginateRows(rows, 2, 2)).toEqual([3, 4])
  })

  it('countMissingAmazon counts rows without Amazon match', () => {
    const rows = [
      {
        zohoItemId: '1',
        zohoItemName: 'A',
        zohoSku: 'A',
        normalizedZohoKey: 'A',
        amazonUaeMatched: true,
        amazonKsaMatched: false,
        amazonMatchedAny: true,
        noonMatched: false,
        amazonUaeSku: 'A',
        amazonKsaSku: null,
        noonSku: null,
        amazonUaeStatus: 'ACTIVE',
        amazonKsaStatus: null,
        noonStatus: null,
        coverageStatus: 'AMAZON_ONLY',
        notes: '',
      },
      {
        zohoItemId: '2',
        zohoItemName: 'B',
        zohoSku: 'B',
        normalizedZohoKey: 'B',
        amazonUaeMatched: false,
        amazonKsaMatched: false,
        amazonMatchedAny: false,
        noonMatched: true,
        amazonUaeSku: null,
        amazonKsaSku: null,
        noonSku: 'B',
        amazonUaeStatus: null,
        amazonKsaStatus: null,
        noonStatus: 'ACTIVE',
        coverageStatus: 'NOON_ONLY',
        notes: '',
      },
    ]
    expect(countMissingAmazon(rows)).toBe(1)
  })
})

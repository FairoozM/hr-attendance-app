import { describe, expect, it } from 'vitest'
import {
  parseVigilZohoFilter,
  stockAlertLabel,
  stockAlertClass,
  paginateRows,
} from './vigilZohoStockFilters'

describe('vigilZohoStockFilters', () => {
  it('parseVigilZohoFilter validates filter values', () => {
    expect(parseVigilZohoFilter('vigilZero')).toBe('vigilZero')
    expect(parseVigilZohoFilter('nope')).toBe('all')
  })

  it('stockAlertLabel maps alert codes', () => {
    expect(stockAlertLabel('BOTH_ZERO')).toBe('Both zero')
    expect(stockAlertLabel('IN_STOCK')).toBe('In stock')
  })

  it('stockAlertClass highlights critical alerts', () => {
    expect(stockAlertClass('VIGIL_ZERO')).toContain('danger')
    expect(stockAlertClass('IN_STOCK')).toContain('complete')
  })

  it('paginateRows slices rows', () => {
    expect(paginateRows([1, 2, 3, 4], 2, 2)).toEqual([3, 4])
  })
})

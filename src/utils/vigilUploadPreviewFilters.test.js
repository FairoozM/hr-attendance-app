import { describe, expect, it } from 'vitest'
import {
  countVigilPreviewRows,
  filterVigilPreviewRows,
  DEFAULT_VIGIL_PREVIEW_FILTERS,
} from './vigilUploadPreviewFilters'

const rows = [
  { rowNumber: 2, itemCode: 'ABC-1', availableStock: 50, valid: true, errors: [] },
  { rowNumber: 3, itemCode: 'XYZ-9', availableStock: 0, valid: true, errors: [] },
  { rowNumber: 4, itemCode: 'BAD-1', availableStock: -1, valid: false, errors: ['Missing stock'] },
  { rowNumber: 5, itemCode: 'LOW-2', availableStock: 5, valid: true, errors: [] },
]

describe('vigilUploadPreviewFilters', () => {
  it('counts stock buckets', () => {
    const counts = countVigilPreviewRows(rows)
    expect(counts.total).toBe(4)
    expect(counts.valid).toBe(3)
    expect(counts.invalid).toBe(1)
    expect(counts.outOfStock).toBe(2)
    expect(counts.negative).toBe(1)
    expect(counts.low).toBe(1)
    expect(counts.inStock).toBe(1)
  })

  it('filters by search, status, and stock', () => {
    const filtered = filterVigilPreviewRows(rows, {
      ...DEFAULT_VIGIL_PREVIEW_FILTERS,
      search: 'xyz',
      stock: 'outOfStock',
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].itemCode).toBe('XYZ-9')

    const invalidOnly = filterVigilPreviewRows(rows, {
      ...DEFAULT_VIGIL_PREVIEW_FILTERS,
      status: 'invalid',
    })
    expect(invalidOnly).toHaveLength(1)
    expect(invalidOnly[0].itemCode).toBe('BAD-1')
  })
})

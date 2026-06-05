export interface VigilPreviewTableRow {
  rowNumber: number
  itemCode: string
  itemName?: string
  availableStock: number
  valid: boolean
  errors: string[]
}

export type VigilPreviewStatusFilter = 'all' | 'valid' | 'invalid'

export type VigilPreviewStockFilter =
  | 'all'
  | 'outOfStock'
  | 'negative'
  | 'low'
  | 'inStock'

export type VigilPreviewSort =
  | 'rowAsc'
  | 'itemCodeAsc'
  | 'itemCodeDesc'
  | 'stockAsc'
  | 'stockDesc'

export interface VigilPreviewFilterState {
  search: string
  status: VigilPreviewStatusFilter
  stock: VigilPreviewStockFilter
  sort: VigilPreviewSort
}

export interface VigilPreviewCounts {
  total: number
  valid: number
  invalid: number
  outOfStock: number
  negative: number
  low: number
  inStock: number
}

export const DEFAULT_VIGIL_PREVIEW_FILTERS: VigilPreviewFilterState = {
  search: '',
  status: 'all',
  stock: 'all',
  sort: 'rowAsc',
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function matchesStockFilter(stock: number, filter: VigilPreviewStockFilter): boolean {
  switch (filter) {
    case 'outOfStock':
      return stock <= 0
    case 'negative':
      return stock < 0
    case 'low':
      return stock >= 1 && stock <= 10
    case 'inStock':
      return stock > 10
    default:
      return true
  }
}

function compareRows(a: VigilPreviewTableRow, b: VigilPreviewTableRow, sort: VigilPreviewSort): number {
  switch (sort) {
    case 'itemCodeAsc':
      return a.itemCode.localeCompare(b.itemCode, undefined, { sensitivity: 'base' })
    case 'itemCodeDesc':
      return b.itemCode.localeCompare(a.itemCode, undefined, { sensitivity: 'base' })
    case 'stockAsc':
      return a.availableStock - b.availableStock
    case 'stockDesc':
      return b.availableStock - a.availableStock
    default:
      return a.rowNumber - b.rowNumber
  }
}

export function countVigilPreviewRows(rows: VigilPreviewTableRow[]): VigilPreviewCounts {
  const counts: VigilPreviewCounts = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    outOfStock: 0,
    negative: 0,
    low: 0,
    inStock: 0,
  }

  for (const row of rows) {
    if (row.valid) counts.valid += 1
    else counts.invalid += 1

    const stock = row.availableStock
    if (stock <= 0) counts.outOfStock += 1
    if (stock < 0) counts.negative += 1
    if (stock >= 1 && stock <= 10) counts.low += 1
    if (stock > 10) counts.inStock += 1
  }

  return counts
}

export function filterVigilPreviewRows(
  rows: VigilPreviewTableRow[],
  filters: VigilPreviewFilterState
): VigilPreviewTableRow[] {
  const query = normalizeSearch(filters.search)

  const filtered = rows.filter((row) => {
    if (filters.status === 'valid' && !row.valid) return false
    if (filters.status === 'invalid' && row.valid) return false
    if (!matchesStockFilter(row.availableStock, filters.stock)) return false

    if (!query) return true
    const haystack = [row.itemCode, row.itemName || ''].join(' ').toLowerCase()
    return haystack.includes(query)
  })

  return [...filtered].sort((a, b) => compareRows(a, b, filters.sort))
}

export function paginateVigilPreviewRows<T>(rows: T[], page: number, limit: number): T[] {
  const safePage = Math.max(1, page)
  const safeLimit = Math.max(1, limit)
  const start = (safePage - 1) * safeLimit
  return rows.slice(start, start + safeLimit)
}

export function hasActiveVigilPreviewFilters(filters: VigilPreviewFilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.stock !== 'all' ||
    filters.sort !== 'rowAsc'
  )
}

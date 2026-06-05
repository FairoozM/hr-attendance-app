import type { VigilZohoCompareRow, VigilZohoFilter } from '../api/vigilZohoStock'

export const VIGIL_ZOHO_FILTER_OPTIONS: { value: VigilZohoFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'vigilZero', label: 'Vigil zero' },
  { value: 'bothZero', label: 'Both zero' },
  { value: 'zohoZero', label: 'Zoho zero' },
  { value: 'matched', label: 'Matched in Zoho' },
  { value: 'unmatched', label: 'Not in Zoho' },
]

const VALID_FILTERS = new Set(VIGIL_ZOHO_FILTER_OPTIONS.map((o) => o.value))

export function parseVigilZohoFilter(raw: string | null | undefined): VigilZohoFilter {
  const v = String(raw || 'all').trim() as VigilZohoFilter
  return VALID_FILTERS.has(v) ? v : 'all'
}

export function stockAlertLabel(alert: VigilZohoCompareRow['stockAlert']): string {
  switch (alert) {
    case 'VIGIL_ZERO':
      return 'Vigil zero'
    case 'ZOHO_ZERO':
      return 'Zoho zero'
    case 'BOTH_ZERO':
      return 'Both zero'
    case 'ZOHO_NOT_FOUND':
      return 'No Zoho match'
    default:
      return 'In stock'
  }
}

export function stockAlertClass(alert: VigilZohoCompareRow['stockAlert']): string {
  switch (alert) {
    case 'VIGIL_ZERO':
    case 'BOTH_ZERO':
      return 'sku-cov-status sku-cov-status--danger'
    case 'ZOHO_ZERO':
      return 'sku-cov-status sku-cov-status--noon'
    case 'ZOHO_NOT_FOUND':
      return 'sku-cov-status sku-cov-status--amazon'
    default:
      return 'sku-cov-status sku-cov-status--complete'
  }
}

export function paginateRows<T>(rows: T[], page: number, limit: number): T[] {
  const safePage = Math.max(1, page)
  const safeLimit = Math.max(1, limit)
  const start = (safePage - 1) * safeLimit
  return rows.slice(start, start + safeLimit)
}

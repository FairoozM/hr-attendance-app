import type { CoverageFilter, CoverageStatus, SkuCoverageRow } from '../api/skuChannelCoverage'

export const COVERAGE_FILTER_OPTIONS: { value: CoverageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missingAmazon', label: 'Missing Amazon' },
  { value: 'missingNoon', label: 'Missing Noon' },
  { value: 'missingAllChannels', label: 'Missing All Channels' },
  { value: 'complete', label: 'Complete' },
  { value: 'amazonUaeMatched', label: 'Amazon UAE matched' },
  { value: 'amazonKsaMatched', label: 'Amazon KSA matched' },
]

const VALID_FILTERS = new Set(COVERAGE_FILTER_OPTIONS.map((o) => o.value))

export function parseCoverageFilter(raw: string | null | undefined): CoverageFilter {
  const v = String(raw || 'all').trim() as CoverageFilter
  return VALID_FILTERS.has(v) ? v : 'all'
}

export function coverageStatusLabel(status: CoverageStatus): string {
  switch (status) {
    case 'COMPLETE':
      return 'Complete'
    case 'AMAZON_ONLY':
      return 'Amazon only'
    case 'NOON_ONLY':
      return 'Noon only'
    case 'MISSING_AMAZON':
      return 'Missing Amazon'
    case 'MISSING_ALL_CHANNELS':
      return 'Missing all channels'
    default:
      return String(status)
  }
}

export function channelBadgeClass(matched: boolean, channel: 'amazon' | 'noon'): string {
  if (matched) {
    return channel === 'amazon'
      ? 'sku-cov-badge sku-cov-badge--amazon-ok'
      : 'sku-cov-badge sku-cov-badge--noon-ok'
  }
  return channel === 'amazon'
    ? 'sku-cov-badge sku-cov-badge--amazon-miss'
    : 'sku-cov-badge sku-cov-badge--noon-miss'
}

export function coverageStatusClass(status: CoverageStatus): string {
  switch (status) {
    case 'COMPLETE':
      return 'sku-cov-status sku-cov-status--complete'
    case 'AMAZON_ONLY':
      return 'sku-cov-status sku-cov-status--amazon'
    case 'NOON_ONLY':
      return 'sku-cov-status sku-cov-status--noon'
    case 'MISSING_AMAZON':
    case 'MISSING_ALL_CHANNELS':
      return 'sku-cov-status sku-cov-status--danger'
    default:
      return 'sku-cov-status'
  }
}

export function formatChannelCell(
  matched: boolean,
  sku: string | null,
  status: string | null
): { label: string; detail: string } {
  if (!matched) {
    return { label: 'Missing', detail: 'Not listed' }
  }
  return {
    label: 'Listed',
    detail: [sku, status].filter(Boolean).join(' · ') || 'Active',
  }
}

export function paginateRows<T>(rows: T[], page: number, limit: number): T[] {
  const safePage = Math.max(1, page)
  const safeLimit = Math.max(1, limit)
  const start = (safePage - 1) * safeLimit
  return rows.slice(start, start + safeLimit)
}

export function countMissingAmazon(rows: SkuCoverageRow[]): number {
  return rows.filter((r) => !r.amazonMatchedAny).length
}

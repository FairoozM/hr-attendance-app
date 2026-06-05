import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getSkuChannelCoverageSummary,
  refreshSkuChannelCoverage,
  exportSkuChannelCoverageXlsx,
  downloadSkuChannelCoverageXlsx,
  type SkuCoverageRow,
  type SkuCoverageSummary,
  type SkuCoverageMeta,
  type CoverageFilter,
} from '../api/skuChannelCoverage'
import {
  COVERAGE_FILTER_OPTIONS,
  parseCoverageFilter,
  coverageStatusLabel,
  coverageStatusClass,
  channelBadgeClass,
  formatChannelCell,
  paginateRows,
} from '../utils/skuChannelCoverageFilters'
import { VigilUploadPanel } from '../components/amazon/outOfStockClearance/VigilUploadPanel'
import type { VigilParsedRow } from '../api/amazonOutOfStockClearance'
import {
  attachVigilToCoverageRows,
  countVigilMatched,
} from '../utils/skuChannelCoverageVigil'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function safeErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message)
  }
  return 'Request failed'
}

interface SummaryCardProps {
  label: string
  value: number
  active?: boolean
  onClick?: () => void
  hint?: string
  emphasis?: 'amazon' | 'default'
}

function SummaryCard({ label, value, active, onClick, hint, emphasis = 'default' }: SummaryCardProps) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`ainv-summary-card ${active ? 'ainv-summary-card--active' : ''} ${
        interactive ? 'ainv-summary-card--interactive' : ''
      } ${emphasis === 'amazon' ? 'sku-cov-summary-card--amazon' : ''}`}
    >
      <p className="ainv-summary-card__label">{label}</p>
      <p className="ainv-summary-card__value">{formatNumber(value)}</p>
      {hint ? <p className="ainv-summary-card__hint">{hint}</p> : null}
    </Tag>
  )
}

function ChannelBadge({
  matched,
  sku,
  status,
  channel,
  label,
}: {
  matched: boolean
  sku: string | null
  status: string | null
  channel: 'amazon' | 'noon'
  label: string
}) {
  const { label: stateLabel, detail } = formatChannelCell(matched, sku, status)
  return (
    <div className={`sku-cov-channel ${channel === 'amazon' ? 'sku-cov-channel--amazon' : 'sku-cov-channel--noon'}`}>
      <span className="sku-cov-channel__market">{label}</span>
      <span className={channelBadgeClass(matched, channel)}>{stateLabel}</span>
      <span className="sku-cov-channel__detail" title={detail}>
        {sku || (matched ? '—' : 'Not listed')}
      </span>
      {status ? <span className="sku-cov-channel__status">{status}</span> : null}
    </div>
  )
}

export function SkuChannelCoveragePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<CoverageFilter>(() =>
    parseCoverageFilter(searchParams.get('filter'))
  )
  const [search, setSearch] = useState(() => String(searchParams.get('search') || ''))
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [baseRows, setBaseRows] = useState<SkuCoverageRow[]>([])
  const [vigilRows, setVigilRows] = useState<VigilParsedRow[]>([])
  const [summary, setSummary] = useState<SkuCoverageSummary | null>(null)
  const [meta, setMeta] = useState<SkuCoverageMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const syncUrl = useCallback(
    (next: { filter: CoverageFilter; search: string }) => {
      const params = new URLSearchParams()
      if (next.filter !== 'all') params.set('filter', next.filter)
      if (next.search) params.set('search', next.search)
      setSearchParams(params, { replace: true })
    },
    [setSearchParams]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const json = await getSkuChannelCoverageSummary({ filter, search })
      if (!json?.success) {
        setError(json?.error || 'Unexpected response')
        return
      }
      setBaseRows(json.rows || [])
      setSummary(json.summary || null)
      setMeta(json.meta || null)
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [filter, search])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const applyFilter = useCallback(
    (value: CoverageFilter) => {
      const v = parseCoverageFilter(value)
      setFilter(v)
      setPage(1)
      syncUrl({ filter: v, search })
    },
    [search, syncUrl]
  )

  const runRefresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const json = await refreshSkuChannelCoverage()
      if (!json?.success) {
        setError(json?.error || 'Refresh failed')
        return
      }
      await loadData()
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setRefreshing(false)
    }
  }, [loadData])

  const runExport = useCallback(async () => {
    setExporting(true)
    setError('')
    try {
      const { blob, filename } = await exportSkuChannelCoverageXlsx({ filter, search }, vigilRows)
      downloadSkuChannelCoverageXlsx(blob, filename)
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setExporting(false)
    }
  }, [filter, search, vigilRows])

  const rows = useMemo(
    () => attachVigilToCoverageRows(baseRows, vigilRows),
    [baseRows, vigilRows]
  )
  const vigilMatchedCount = useMemo(() => countVigilMatched(rows), [rows])

  const pagedRows = useMemo(() => paginateRows(rows, page, limit), [rows, page, limit])
  const totalPages = Math.max(1, Math.ceil(rows.length / limit))

  return (
    <div className="ainv-page sku-cov-page mx-auto flex max-w-[120rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header">
        <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon · BI</p>
        <h1 className="ainv-page__title">SKU Channel Coverage</h1>
        <p className="ainv-page__lead">
          Zoho is the source of truth. Every <strong>active Zoho item</strong> is checked against{' '}
          <strong>Amazon UAE</strong>, <strong>Amazon KSA</strong> (primary), and <strong>Noon</strong>{' '}
          (secondary, matched on <strong>Noon PSKU</strong>) using exact SKU / item-name keys only — no fuzzy
          product-name matching.{' '}
          <strong>Vigil wholesale stock</strong> is added manually via file upload.
        </p>
      </header>

      <VigilUploadPanel onConfirmed={setVigilRows} />

      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <SummaryCard
            label="Active Zoho items"
            value={summary.totalActiveZohoItems}
            onClick={() => applyFilter('all')}
            active={filter === 'all'}
          />
          <SummaryCard
            label="Amazon UAE matched"
            value={summary.matchedAmazonUae}
            emphasis="amazon"
            onClick={() => applyFilter('amazonUaeMatched')}
            active={filter === 'amazonUaeMatched'}
          />
          <SummaryCard
            label="Amazon KSA matched"
            value={summary.matchedAmazonKsa}
            emphasis="amazon"
            onClick={() => applyFilter('amazonKsaMatched')}
            active={filter === 'amazonKsaMatched'}
          />
          <SummaryCard
            label="Amazon (any) matched"
            value={summary.matchedAmazonAny}
            emphasis="amazon"
            hint="Primary channel"
          />
          <SummaryCard
            label="Noon matched"
            value={summary.matchedNoon}
            hint="Secondary channel"
          />
          <SummaryCard
            label="Missing Amazon"
            value={summary.missingAmazon}
            emphasis="amazon"
            onClick={() => applyFilter('missingAmazon')}
            active={filter === 'missingAmazon'}
            hint="Not on UAE or KSA"
          />
          <SummaryCard
            label="Missing Noon"
            value={summary.missingNoon}
            onClick={() => applyFilter('missingNoon')}
            active={filter === 'missingNoon'}
          />
          <SummaryCard
            label="Missing all channels"
            value={summary.missingAllChannels}
            onClick={() => applyFilter('missingAllChannels')}
            active={filter === 'missingAllChannels'}
          />
          {vigilRows.length > 0 ? (
            <SummaryCard
              label="Vigil matched"
              value={vigilMatchedCount}
              hint={`${vigilRows.length.toLocaleString()} uploaded rows`}
            />
          ) : null}
        </section>
      ) : null}

      <section className="ainv-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-4">
            <label className="ainv-label md:col-span-2">
              Search Zoho item name / SKU
              <input
                className="ainv-input"
                placeholder="Item name or SKU"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                  syncUrl({ filter, search: e.target.value })
                }}
              />
            </label>
            <label className="ainv-label">
              Coverage filter
              <select
                className="ainv-input"
                value={filter}
                onChange={(e) => applyFilter(e.target.value as CoverageFilter)}
              >
                {COVERAGE_FILTER_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ainv-label">
              Page size
              <select
                className="ainv-input"
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void loadData()} disabled={loading} className="ainv-btn">
              {loading ? 'Loading…' : 'Reload'}
            </button>
            <button
              type="button"
              onClick={() => void runRefresh()}
              disabled={refreshing || loading}
              className="ainv-btn ainv-btn--primary-emerald"
            >
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={exporting || loading}
              className="ainv-btn ainv-btn--primary-sky"
            >
              {exporting ? 'Exporting…' : 'Export XLSX'}
            </button>
          </div>
        </div>

        {meta ? (
          <div className="mt-4 grid gap-2 text-xs md:grid-cols-4" style={{ color: 'var(--text-dim)' }}>
            <div>
              Generated:{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatDateTime(meta.generatedAt)}
              </span>
            </div>
            <div>
              Zoho items:{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatNumber(meta.zohoItemCount)}
              </span>
            </div>
            <div>
              Amazon listings (UAE / KSA):{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatNumber(meta.amazonUaeListingCount)} / {formatNumber(meta.amazonKsaListingCount)}
              </span>
            </div>
            <div>
              Noon ({meta.noonSource || '—'}):{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatNumber(meta.noonItemCount)}
              </span>
              {meta.fromCache ? ' · cached' : ''}
            </div>
          </div>
        ) : null}

        {Array.isArray(meta?.warnings) && meta.warnings.length > 0 ? (
          <div className="ainv-banner ainv-banner--amber mt-4">{meta.warnings.join(' ')}</div>
        ) : null}

        {error ? <div className="ainv-banner ainv-banner--danger mt-4">{error}</div> : null}
      </section>

      <section className="ainv-panel overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading SKU channel coverage…
          </div>
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {error ? (
              <span>{error}</span>
            ) : meta?.zohoItemCount === 0 ? (
              <span>
                No active Zoho items were returned. Check Zoho configuration, then click Refresh data.
              </span>
            ) : (
              <span>No active Zoho items match the current filter.</span>
            )}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="ainv-table sku-cov-table w-full min-w-[72rem] text-left text-sm">
              <thead>
                <tr>
                  <th>Zoho Item Name</th>
                  <th>Zoho SKU</th>
                  <th className="sku-cov-th-amazon">Amazon UAE</th>
                  <th className="sku-cov-th-amazon">Amazon KSA</th>
                  <th className="sku-cov-th-noon">Noon PSKU</th>
                  <th className="sku-cov-th-vigil">Vigil Stock</th>
                  <th>Coverage Status</th>
                  <th>Notes / mismatch reason</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.zohoItemId || `${row.zohoItemName}-${row.zohoSku}`}>
                    <td>
                      <div className="font-medium">{row.zohoItemName || '—'}</div>
                      {row.normalizedZohoKey ? (
                        <div className="text-xs font-mono opacity-70">key: {row.normalizedZohoKey}</div>
                      ) : null}
                    </td>
                    <td className="font-mono">{row.zohoSku || '—'}</td>
                    <td className="sku-cov-td-amazon">
                      <ChannelBadge
                        matched={row.amazonUaeMatched}
                        sku={row.amazonUaeSku}
                        status={row.amazonUaeStatus}
                        channel="amazon"
                        label="UAE"
                      />
                    </td>
                    <td className="sku-cov-td-amazon">
                      <ChannelBadge
                        matched={row.amazonKsaMatched}
                        sku={row.amazonKsaSku}
                        status={row.amazonKsaStatus}
                        channel="amazon"
                        label="KSA"
                      />
                    </td>
                    <td className="sku-cov-td-noon">
                      <ChannelBadge
                        matched={row.noonMatched}
                        sku={row.noonSku}
                        status={row.noonStatus}
                        channel="noon"
                        label="Noon PSKU"
                      />
                    </td>
                    <td className="sku-cov-td-vigil">
                      {row.vigilMatched ? (
                        <div className="sku-cov-channel sku-cov-channel--vigil">
                          <span className="sku-cov-channel__market">Vigil</span>
                          <span className="sku-cov-badge sku-cov-badge--vigil-ok">In stock file</span>
                          <span className="sku-cov-channel__detail font-mono">
                            {formatNumber(row.vigilStockQty)}
                          </span>
                          {row.vigilSku ? (
                            <span className="sku-cov-channel__status">{row.vigilSku}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="sku-cov-badge sku-cov-badge--vigil-miss">
                          {vigilRows.length > 0 ? 'Not in file' : 'Upload file'}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={coverageStatusClass(row.coverageStatus)}>
                        {coverageStatusLabel(row.coverageStatus)}
                      </span>
                    </td>
                    <td className="max-w-xs text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm" style={{ borderColor: 'var(--theme-border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Showing {formatNumber(pagedRows.length)} of {formatNumber(rows.length)} filtered rows
              {meta?.totalCount != null ? ` (${formatNumber(meta.totalCount)} total Zoho items)` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ainv-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="font-mono text-xs">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="ainv-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

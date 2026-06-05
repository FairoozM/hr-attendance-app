import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  compareVigilZohoStock,
  type VigilZohoCompareRow,
  type VigilZohoCompareSummary,
  type VigilZohoCompareMeta,
  type VigilZohoFilter,
} from '../../api/vigilZohoStock'
import type { VigilParsedRow } from '../../api/amazonOutOfStockClearance'
import {
  VIGIL_ZOHO_FILTER_OPTIONS,
  parseVigilZohoFilter,
  stockAlertLabel,
  stockAlertClass,
  paginateRows,
} from '../../utils/vigilZohoStockFilters'

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
  danger?: boolean
}

function SummaryCard({ label, value, active, onClick, hint, danger = false }: SummaryCardProps) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`ainv-summary-card ${active ? 'ainv-summary-card--active' : ''} ${
        interactive ? 'ainv-summary-card--interactive' : ''
      } ${danger ? 'sku-cov-summary-card--danger' : 'sku-cov-summary-card--vigil'}`}
    >
      <p className="ainv-summary-card__label">{label}</p>
      <p className="ainv-summary-card__value">{formatNumber(value)}</p>
      {hint ? <p className="ainv-summary-card__hint">{hint}</p> : null}
    </Tag>
  )
}

interface VigilZohoStockViewProps {
  vigilRows: VigilParsedRow[]
}

export function VigilZohoStockView({ vigilRows }: VigilZohoStockViewProps) {
  const [filter, setFilter] = useState<VigilZohoFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [rows, setRows] = useState<VigilZohoCompareRow[]>([])
  const [summary, setSummary] = useState<VigilZohoCompareSummary | null>(null)
  const [meta, setMeta] = useState<VigilZohoCompareMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadCompare = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (vigilRows.length === 0) {
        setRows([])
        setSummary(null)
        setMeta(null)
        setError('Upload and confirm a Vigil stock file to compare with Zoho Life Smile warehouse.')
        return
      }
      setLoading(true)
      setError('')
      try {
        const json = await compareVigilZohoStock(vigilRows, {
          filter,
          search,
          refresh: options.refresh,
        })
        if (!json?.success) {
          setError(json?.error || 'Unexpected response')
          return
        }
        setRows(json.rows || [])
        setSummary(json.summary || null)
        setMeta(json.meta || null)
      } catch (e) {
        setError(safeErrorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [filter, search, vigilRows]
  )

  useEffect(() => {
    void loadCompare()
  }, [loadCompare])

  const runRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadCompare({ refresh: true })
    } finally {
      setRefreshing(false)
    }
  }, [loadCompare])

  const pagedRows = useMemo(() => paginateRows(rows, page, limit), [rows, page, limit])
  const totalPages = Math.max(1, Math.ceil(rows.length / limit))

  return (
    <>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Compare your uploaded <strong>Vigil wholesale stock</strong> against{' '}
        <strong>Zoho Life Smile warehouse</strong> quantities. Use this to catch supplier SKUs that
        silently dropped to zero before you run out of buyable stock.
      </p>

      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <SummaryCard
            label="Vigil rows"
            value={summary.totalVigilRows}
            onClick={() => {
              setFilter('all')
              setPage(1)
            }}
            active={filter === 'all'}
          />
          <SummaryCard
            label="Matched in Zoho"
            value={summary.matchedZoho}
            onClick={() => {
              setFilter('matched')
              setPage(1)
            }}
            active={filter === 'matched'}
          />
          <SummaryCard
            label="Vigil zero"
            value={summary.vigilZero}
            danger
            onClick={() => {
              setFilter('vigilZero')
              setPage(1)
            }}
            active={filter === 'vigilZero'}
            hint="Wholesale out of stock"
          />
          <SummaryCard
            label="Both zero"
            value={summary.bothZero}
            danger
            onClick={() => {
              setFilter('bothZero')
              setPage(1)
            }}
            active={filter === 'bothZero'}
          />
          <SummaryCard
            label="Zoho zero"
            value={summary.zohoZero}
            onClick={() => {
              setFilter('zohoZero')
              setPage(1)
            }}
            active={filter === 'zohoZero'}
          />
          <SummaryCard
            label="Not in Zoho"
            value={summary.unmatchedZoho}
            onClick={() => {
              setFilter('unmatched')
              setPage(1)
            }}
            active={filter === 'unmatched'}
          />
        </section>
      ) : null}

      <section className="ainv-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-4">
            <label className="ainv-label md:col-span-2">
              Search Vigil / Zoho SKU or name
              <input
                className="ainv-input"
                placeholder="SKU or item name"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </label>
            <label className="ainv-label">
              Stock filter
              <select
                className="ainv-input"
                value={filter}
                onChange={(e) => {
                  setFilter(parseVigilZohoFilter(e.target.value))
                  setPage(1)
                }}
              >
                {VIGIL_ZOHO_FILTER_OPTIONS.map((item) => (
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
            <button type="button" onClick={() => void loadCompare()} disabled={loading} className="ainv-btn">
              {loading ? 'Loading…' : 'Reload'}
            </button>
            <button
              type="button"
              onClick={() => void runRefresh()}
              disabled={refreshing || loading || vigilRows.length === 0}
              className="ainv-btn ainv-btn--primary-emerald"
            >
              {refreshing ? 'Refreshing Zoho…' : 'Refresh Zoho stock'}
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
              Zoho warehouse:{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {meta.zohoWarehouseName}
              </span>
            </div>
            <div>
              Zoho items loaded:{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatNumber(meta.zohoItemCount)}
              </span>
            </div>
            <div>
              Vigil rows:{' '}
              <span className="font-mono" style={{ color: 'var(--text-soft)' }}>
                {formatNumber(meta.vigilRowCount)}
              </span>
              {meta.fromCache ? ' · Zoho cached' : ''}
            </div>
          </div>
        ) : null}

        {error ? <div className="ainv-banner ainv-banner--danger mt-4">{error}</div> : null}
      </section>

      <section className="ainv-panel overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading Vigil vs Zoho comparison…
          </div>
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {vigilRows.length === 0
              ? 'Upload and confirm a Vigil stock file above to start the comparison.'
              : 'No rows match the current filter.'}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="ainv-table sku-cov-table w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr>
                  <th>Vigil SKU</th>
                  <th>Vigil Name</th>
                  <th className="sku-cov-th-vigil">Vigil Qty</th>
                  <th>Zoho SKU</th>
                  <th>Zoho Name</th>
                  <th className="sku-cov-th-zoho">Zoho Life Smile Qty</th>
                  <th>Stock Alert</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={`${row.vigilSku}-${row.zohoSku || 'none'}`}>
                    <td className="font-mono">{row.vigilSku || '—'}</td>
                    <td>{row.vigilItemName || '—'}</td>
                    <td className="sku-cov-td-vigil font-mono">{formatNumber(row.vigilStockQty)}</td>
                    <td className="font-mono">{row.zohoSku || '—'}</td>
                    <td>{row.zohoItemName || '—'}</td>
                    <td className="sku-cov-td-zoho font-mono">
                      {row.zohoMatched ? formatNumber(row.zohoStockQty) : '—'}
                    </td>
                    <td>
                      <span className={stockAlertClass(row.stockAlert)}>
                        {stockAlertLabel(row.stockAlert)}
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
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>
              Showing {formatNumber(pagedRows.length)} of {formatNumber(rows.length)} filtered rows
              {meta?.totalCount != null ? ` (${formatNumber(meta.totalCount)} total Vigil rows)` : ''}
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
    </>
  )
}

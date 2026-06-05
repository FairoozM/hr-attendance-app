import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  previewVigilStockFile,
  type VigilParsedRow,
  type VigilPreviewResponse,
} from '../../../api/amazonOutOfStockClearance'
import { ModernSearchInput } from '../../ui/ModernSearchInput'
import {
  DEFAULT_VIGIL_PREVIEW_FILTERS,
  countVigilPreviewRows,
  filterVigilPreviewRows,
  hasActiveVigilPreviewFilters,
  paginateVigilPreviewRows,
  type VigilPreviewFilterState,
  type VigilPreviewSort,
  type VigilPreviewStatusFilter,
  type VigilPreviewStockFilter,
  type VigilPreviewTableRow,
} from '../../../utils/vigilUploadPreviewFilters'

interface VigilUploadPanelProps {
  onConfirmed: (rows: VigilParsedRow[]) => void
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function stockCellClass(stock: number): string {
  if (stock < 0) return 'vigil-preview-table__stock--negative'
  if (stock <= 0) return 'vigil-preview-table__stock--zero'
  return ''
}

interface PreviewStatProps {
  label: string
  value: number
  active?: boolean
  onClick?: () => void
  tone?: 'default' | 'danger' | 'warn'
}

function PreviewStat({ label, value, active, onClick, tone = 'default' }: PreviewStatProps) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`vigil-preview-stat ${active ? 'vigil-preview-stat--active' : ''} ${
        tone === 'danger' ? 'vigil-preview-stat--danger' : tone === 'warn' ? 'vigil-preview-stat--warn' : ''
      }`}
    >
      <p className="vigil-preview-stat__label">{label}</p>
      <p className="vigil-preview-stat__value">{formatNumber(value)}</p>
    </Tag>
  )
}

interface FilterChipProps {
  active: boolean
  onClick: () => void
  children: ReactNode
  tone?: 'default' | 'danger' | 'warn'
}

function FilterChip({ active, onClick, children, tone = 'default' }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`vigil-preview-chip ${active ? 'vigil-preview-chip--active' : ''} ${
        tone === 'danger' ? 'vigil-preview-chip--danger' : tone === 'warn' ? 'vigil-preview-chip--warn' : ''
      }`}
    >
      {children}
    </button>
  )
}

export function VigilUploadPanel({ onConfirmed }: VigilUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<VigilPreviewResponse['preview'] | null>(null)
  const [needsMapping, setNeedsMapping] = useState(false)
  const [itemCodeHeader, setItemCodeHeader] = useState('')
  const [stockHeader, setStockHeader] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<VigilPreviewFilterState>(DEFAULT_VIGIL_PREVIEW_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)

  const previewRows = useMemo<VigilPreviewTableRow[]>(
    () => (preview?.rows as VigilPreviewTableRow[] | undefined) || [],
    [preview]
  )

  const counts = useMemo(() => countVigilPreviewRows(previewRows), [previewRows])
  const filteredRows = useMemo(
    () => filterVigilPreviewRows(previewRows, filters),
    [previewRows, filters]
  )
  const pagedRows = useMemo(
    () => paginateVigilPreviewRows(filteredRows, page, limit),
    [filteredRows, page, limit]
  )
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / limit))

  const updateFilters = useCallback((patch: Partial<VigilPreviewFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_VIGIL_PREVIEW_FILTERS)
    setPage(1)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [preview])

  const runPreview = useCallback(
    async (mapping?: { itemCodeHeader?: string; stockHeader?: string }) => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        const res = await previewVigilStockFile(file, mapping)
        setPreview(res.preview)
        setNeedsMapping(Boolean(res.needsColumnMapping))
        if (res.preview.summary.itemCodeHeader) setItemCodeHeader(res.preview.summary.itemCodeHeader)
        if (res.preview.summary.stockHeader) setStockHeader(res.preview.summary.stockHeader)
        if (res.needsColumnMapping && !mapping) {
          setError(res.message || 'Confirm column mapping before using this file.')
        }
      } catch (e) {
        const err = e as Error & { body?: { preview?: VigilPreviewResponse['preview'] } }
        setError(err.message || 'Upload failed')
        if (err.body?.preview) setPreview(err.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file]
  )

  const confirmRows = useCallback(() => {
    if (!preview) return
    const valid = preview.rows.filter((r) => r.valid)
    onConfirmed(
      valid.map((r) => ({
        itemCode: r.itemCode,
        itemName: r.itemName,
        normalizedItemCode: r.itemCode,
        availableStock: r.availableStock,
        valid: true,
      }))
    )
  }, [preview, onConfirmed])

  const headers = preview?.availableHeaders || preview?.headers || []
  const filtersActive = hasActiveVigilPreviewFilters(filters)

  const setStatusFilter = (status: VigilPreviewStatusFilter) => {
    updateFilters({ status: filters.status === status && status !== 'all' ? 'all' : status })
  }

  const setStockFilter = (stock: VigilPreviewStockFilter) => {
    updateFilters({ stock: filters.stock === stock && stock !== 'all' ? 'all' : stock })
  }

  const setSort = (sort: VigilPreviewSort) => {
    updateFilters({ sort })
  }

  return (
    <section className="ainv-panel">
      <h2 className="ainv-section-title">Vigil wholesale stock upload</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Upload Excel or CSV. Preview and confirm column mapping before calculation.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xls,.xlsx,text/csv"
          className="text-sm"
          style={{ color: 'var(--text-soft)' }}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setPreview(null)
            setError('')
            setNeedsMapping(false)
            resetFilters()
          }}
        />
        <button
          type="button"
          className="ainv-btn"
          disabled={!file || busy}
          onClick={() => void runPreview()}
        >
          {busy ? 'Parsing…' : 'Preview file'}
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--primary-emerald"
          disabled={!preview || busy || preview.summary.validRows === 0 || (needsMapping && (!itemCodeHeader || !stockHeader))}
          onClick={confirmRows}
        >
          Confirm Vigil data
        </button>
      </div>
      {error && <p className="ainv-banner ainv-banner--amber mt-3">{error}</p>}
      {needsMapping && headers.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="ainv-label">
            Item code column
            <select
              className="ainv-input"
              value={itemCodeHeader}
              onChange={(e) => setItemCodeHeader(e.target.value)}
            >
              <option value="">Select column</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="ainv-label">
            Stock quantity column
            <select
              className="ainv-input"
              value={stockHeader}
              onChange={(e) => setStockHeader(e.target.value)}
            >
              <option value="">Select column</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ainv-btn ainv-btn--amber md:col-span-2"
            disabled={!itemCodeHeader || !stockHeader || busy}
            onClick={() =>
              void runPreview({ itemCodeHeader, stockHeader })
            }
          >
            Apply column mapping and re-preview
          </button>
        </div>
      )}
      {preview && (
        <>
          <div className="vigil-preview-filters">
            <div className="vigil-preview-filters__stats">
              <PreviewStat
                label="All rows"
                value={counts.total}
                active={filters.status === 'all' && filters.stock === 'all' && !filters.search}
                onClick={() => resetFilters()}
              />
              <PreviewStat
                label="Valid"
                value={counts.valid}
                active={filters.status === 'valid'}
                onClick={() => setStatusFilter('valid')}
              />
              <PreviewStat
                label="Invalid"
                value={counts.invalid}
                active={filters.status === 'invalid'}
                onClick={() => setStatusFilter('invalid')}
                tone="danger"
              />
              <PreviewStat
                label="Out of stock"
                value={counts.outOfStock}
                active={filters.stock === 'outOfStock'}
                onClick={() => setStockFilter('outOfStock')}
                tone="warn"
              />
              <PreviewStat
                label="Low (1–10)"
                value={counts.low}
                active={filters.stock === 'low'}
                onClick={() => setStockFilter('low')}
              />
              <PreviewStat
                label="In stock (>10)"
                value={counts.inStock}
                active={filters.stock === 'inStock'}
                onClick={() => setStockFilter('inStock')}
              />
            </div>

            <div className="vigil-preview-filters__row">
              <ModernSearchInput
                className="vigil-preview-filters__search"
                value={filters.search}
                onChange={(value) => updateFilters({ search: value })}
                placeholder="Search item code or name…"
              />
              <div className="vigil-preview-filters__controls">
                <FilterChip active={filters.status === 'all'} onClick={() => setStatusFilter('all')}>
                  All status
                </FilterChip>
                <FilterChip
                  active={filters.status === 'valid'}
                  onClick={() => setStatusFilter('valid')}
                >
                  Valid only
                </FilterChip>
                <FilterChip
                  active={filters.status === 'invalid'}
                  onClick={() => setStatusFilter('invalid')}
                  tone="danger"
                >
                  Invalid only
                </FilterChip>
                <FilterChip
                  active={filters.stock === 'negative'}
                  onClick={() => setStockFilter('negative')}
                  tone="danger"
                >
                  Negative qty
                </FilterChip>
                <select
                  className="vigil-preview-select"
                  value={filters.sort}
                  onChange={(e) => setSort(e.target.value as VigilPreviewSort)}
                  aria-label="Sort preview rows"
                >
                  <option value="rowAsc">Sort: row order</option>
                  <option value="itemCodeAsc">Sort: item code A→Z</option>
                  <option value="itemCodeDesc">Sort: item code Z→A</option>
                  <option value="stockAsc">Sort: stock low→high</option>
                  <option value="stockDesc">Sort: stock high→low</option>
                </select>
                <select
                  className="vigil-preview-select"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value))
                    setPage(1)
                  }}
                  aria-label="Rows per page"
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={200}>200 / page</option>
                </select>
                {filtersActive ? (
                  <button type="button" className="vigil-preview-clear" onClick={resetFilters}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="ainv-table-wrap mt-4">
            <p
              className="px-4 py-2 text-xs ainv-table__muted"
              style={{ borderBottom: '1px solid var(--theme-border)' }}
            >
              {preview.summary.validRows} valid / {preview.summary.invalidRows} invalid — Item:{' '}
              {preview.summary.itemCodeHeader || '—'} · Stock: {preview.summary.stockHeader || '—'}
              {filtersActive ? (
                <>
                  {' '}
                  · Showing {formatNumber(filteredRows.length)} of {formatNumber(counts.total)} rows
                </>
              ) : null}
            </p>

            {filteredRows.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No rows match the current filters.
              </div>
            ) : (
              <table className="ainv-table">
                <thead>
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Item code</th>
                    <th className="px-3 py-2">Stock</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2 ainv-table__sku">{row.itemCode || '—'}</td>
                      <td className={`px-3 py-2 font-mono ${stockCellClass(row.availableStock)}`}>
                        {formatNumber(row.availableStock)}
                      </td>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <span className="ainv-badge ainv-badge--ok">Valid</span>
                        ) : (
                          <span className="ainv-badge ainv-badge--danger" title={row.errors.join(', ')}>
                            {row.errors.join(', ') || 'Invalid'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {filteredRows.length > 0 ? (
              <div className="vigil-preview-footer">
                <span>
                  Showing {formatNumber(pagedRows.length)} of {formatNumber(filteredRows.length)} filtered
                  rows
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="ainv-pagination-btn"
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
                    className="ainv-pagination-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

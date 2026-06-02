import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { downloadBlob } from '../../../api/client'
import type { AmazonOosFilter, AmazonOosRow, MarketplaceCode } from '../../../api/amazonOutOfStockClearance'

const PAGE_SIZES = [25, 50, 100, 200]

function formatQty(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '0'
  return value.toLocaleString()
}

function marketplaceToZohoPath(mk: MarketplaceCode, oosFilter: AmazonOosFilter) {
  const slug = mk === 'KSA' ? 'ksa' : 'uae'
  const stockFilter =
    oosFilter === 'sellerCentralInactiveOos' ? 'sellerCentralInactiveOos' : 'amazonOutOfStock'
  return `/ai/amazon-zoho-stock?marketplace=${slug}&stockFilter=${stockFilter}`
}

function csvEscape(value: unknown) {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows: AmazonOosRow[]) {
  const headers = ['Marketplace', 'SKU', 'ASIN', 'Title', 'FBA On-hand', 'FBA Fulfillable']
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.marketplace,
        row.amazonSku,
        row.asin,
        row.title || row.amazonTitle,
        row.amazonCurrentQty,
        row.amazonFulfillableQty ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\n')
}

interface AmazonOosSkusTableProps {
  rows: AmazonOosRow[]
  marketplace: MarketplaceCode
  oosFilter?: AmazonOosFilter
  loading?: boolean
  fetchedAt?: string | null
}

export function AmazonOosSkusTable({
  rows,
  marketplace,
  oosFilter = 'sellerCentralInactiveOos',
  loading,
  fetchedAt,
}: AmazonOosSkusTableProps) {
  const isScInactive = oosFilter === 'sellerCentralInactiveOos'
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const sku = String(row.amazonSku || '').toLowerCase()
      const title = String(row.title || row.amazonTitle || '').toLowerCase()
      const asin = String(row.asin || '').toLowerCase()
      return sku.includes(q) || title.includes(q) || asin.includes(q)
    })
  }, [rows, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1)

  useEffect(() => {
    setPage(1)
  }, [search, pageSize, rows.length])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const exportCsv = () => {
    const blob = new Blob([rowsToCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `amazon-oos-${marketplace.toLowerCase()}-${stamp}.csv`)
  }

  return (
    <section id="oos-sku-list" className="ainv-oos-section">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="ainv-oos-section__eyebrow">SKU list</p>
          <h2 className="ainv-oos-section__title">
            {loading ? '…' : formatQty(rows.length)}{' '}
            {isScInactive ? 'Seller Central inactive OOS SKUs' : 'Amazon FBA zero-stock SKUs'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-muted)' }}>
            {isScInactive
              ? 'From Amazon GET_MERCHANT_LISTINGS_INACTIVE_DATA — same bucket as Seller Central Manage Inventory → Inactive → Out of stock.'
              : 'Active listings where FBA on-hand and fulfillable are both 0 (much larger set than SC inactive OOS).'}
            {' '}
            On-hand uses AFN Manage Inventory report merged with FBA API (includes Seller Flex). Export CSV
            for the full list.
          </p>
          {!loading && rows.length > 0 ? (
            <p className="mt-1 text-sm" style={{ color: 'var(--text-dim)' }}>
              Page {page} of {totalPages} · {formatQty(filtered.length)} matching
              {search ? ' search' : ''}
              {fetchedAt ? ` · cache ${new Date(fetchedAt).toLocaleString()}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
          <input
            type="search"
            placeholder="Search SKU / ASIN / title"
            className="ainv-input flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading || rows.length === 0}
          />
          <button
            type="button"
            className="ainv-btn ainv-btn--primary-sky"
            disabled={loading || filtered.length === 0}
            onClick={exportCsv}
          >
            Export CSV ({formatQty(filtered.length)})
          </button>
        </div>
      </div>

      <div className="ainv-table-wrap mt-4">
        <table className="ainv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>SKU</th>
              <th>ASIN</th>
              <th>Title</th>
              <th>Listing status</th>
              <th>Marketplace</th>
              <th>FBA on-hand</th>
              <th>FBA fulfillable</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center ainv-table__muted">
                  Loading out-of-stock SKUs…
                </td>
              </tr>
            ) : null}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center ainv-table__muted">
                  {rows.length === 0 ? (
                    <span>
                      No out-of-stock SKUs in cache for {marketplace}.{' '}
                      <Link className="ainv-link-emerald" to={marketplaceToZohoPath(marketplace, oosFilter)}>
                        Refresh on Amazon + Zoho Stock
                      </Link>{' '}
                      then return here.
                    </span>
                  ) : (
                    'No rows match your search.'
                  )}
                </td>
              </tr>
            ) : null}
            {!loading
              ? pageRows.map((row, index) => {
                  const rowNum = (page - 1) * pageSize + index + 1
                  return (
                    <tr key={`${row.marketplaceKey}:${row.amazonSku}`}>
                      <td className="ainv-table__muted">{rowNum}</td>
                      <td className="ainv-table__sku">{row.amazonSku}</td>
                      <td className="ainv-table__sku ainv-table__muted">{row.asin || '—'}</td>
                      <td className="max-w-md">{row.title || row.amazonTitle || '—'}</td>
                      <td className="ainv-table__status-inactive">
                        {row.listingStatus === 'INACTIVE_OOS' ? 'Inactive · OOS' : row.listingStatus || '—'}
                      </td>
                      <td>{row.marketplace}</td>
                      <td className="font-semibold ainv-table__status-inactive">{formatQty(row.amazonCurrentQty)}</td>
                      <td className="ainv-table__muted">{formatQty(row.amazonFulfillableQty)}</td>
                    </tr>
                  )
                })
              : null}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-2">
            <label>
              Rows per page
              <select
                className="ainv-input ml-2 !mt-0 !w-auto inline-block"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ainv-pagination-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
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
    </section>
  )
}

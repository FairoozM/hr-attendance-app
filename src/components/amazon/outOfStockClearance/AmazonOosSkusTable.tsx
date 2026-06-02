import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { downloadBlob } from '../../../api/client'
import type { AmazonOosRow, MarketplaceCode } from '../../../api/amazonOutOfStockClearance'

const PAGE_SIZES = [25, 50, 100, 200]

function formatQty(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '0'
  return value.toLocaleString()
}

function marketplaceToZohoPath(mk: MarketplaceCode) {
  const slug = mk === 'KSA' ? 'ksa' : 'uae'
  return `/ai/amazon-zoho-stock?marketplace=${slug}&stockFilter=amazonOutOfStock`
}

function csvEscape(value: unknown) {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows: AmazonOosRow[]) {
  const headers = ['Marketplace', 'SKU', 'ASIN', 'Title', 'FBA Available']
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.marketplace,
        row.amazonSku,
        row.asin,
        row.title || row.amazonTitle,
        row.amazonCurrentQty,
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
  loading?: boolean
  fetchedAt?: string | null
}

export function AmazonOosSkusTable({ rows, marketplace, loading, fetchedAt }: AmazonOosSkusTableProps) {
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
    <section
      id="oos-sku-list"
      className="scroll-mt-4 rounded-3xl border-2 border-emerald-400/30 bg-white/[0.03] p-6 backdrop-blur-md"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">SKU list</p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {loading ? '…' : formatQty(rows.length)} Amazon out-of-stock SKUs
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Active listings with FBA fulfillable qty = 0 (not the same as Seller Central&apos;s smaller
            &quot;Inactive → Out of stock&quot; bucket). Scroll this table or export CSV for the full list.
          </p>
          {!loading && rows.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">
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
            className="flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading || rows.length === 0}
          />
          <button
            type="button"
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            disabled={loading || filtered.length === 0}
            onClick={exportCsv}
          >
            Export CSV ({formatQty(filtered.length)})
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-slate-950/50">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">ASIN</th>
              <th className="px-3 py-3">Title</th>
              <th className="px-3 py-3">Marketplace</th>
              <th className="px-3 py-3">FBA available</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                  Loading out-of-stock SKUs…
                </td>
              </tr>
            ) : null}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  {rows.length === 0 ? (
                    <span>
                      No out-of-stock SKUs in cache for {marketplace}.{' '}
                      <Link className="text-emerald-300 underline" to={marketplaceToZohoPath(marketplace)}>
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
                    <tr key={`${row.marketplaceKey}:${row.amazonSku}`} className="border-t border-white/5">
                      <td className="px-3 py-2 text-slate-500">{rowNum}</td>
                      <td className="px-3 py-2 font-mono text-xs text-white">{row.amazonSku}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.asin || '—'}</td>
                      <td className="max-w-md px-3 py-2 text-slate-300">{row.title || row.amazonTitle || '—'}</td>
                      <td className="px-3 py-2">{row.marketplace}</td>
                      <td className="px-3 py-2 font-semibold text-amber-200">{formatQty(row.amazonCurrentQty)}</td>
                    </tr>
                  )
                })
              : null}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <label>
              Rows per page
              <select
                className="ml-2 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-slate-100"
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
              className="rounded-lg border border-white/10 px-3 py-1 hover:bg-white/10 disabled:opacity-40"
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
              className="rounded-lg border border-white/10 px-3 py-1 hover:bg-white/10 disabled:opacity-40"
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

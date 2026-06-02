import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AmazonOosRow, MarketplaceCode } from '../../../api/amazonOutOfStockClearance'

function formatQty(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '0'
  return value.toLocaleString()
}

function marketplaceToZohoPath(mk: MarketplaceCode) {
  const slug = mk === 'KSA' ? 'ksa' : 'uae'
  return `/ai/amazon-zoho-stock?marketplace=${slug}&stockFilter=amazonOutOfStock`
}

interface AmazonOosSkusTableProps {
  rows: AmazonOosRow[]
  marketplace: MarketplaceCode
  loading?: boolean
  fetchedAt?: string | null
}

export function AmazonOosSkusTable({ rows, marketplace, loading, fetchedAt }: AmazonOosSkusTableProps) {
  const [search, setSearch] = useState('')

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

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Out-of-stock SKUs</h2>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? 'Loading from cache…'
              : rows.length === 0
                ? 'No SKUs loaded yet.'
                : `Showing ${filtered.length} of ${rows.length} SKU(s)${fetchedAt ? ` · cache ${new Date(fetchedAt).toLocaleString()}` : ''}`}
          </p>
        </div>
        <input
          type="search"
          placeholder="Search SKU / ASIN / title"
          className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={loading || rows.length === 0}
        />
      </div>

      <div className="mt-4 max-h-[min(60vh,32rem)] overflow-auto rounded-2xl border border-white/10">
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
              ? filtered.map((row, index) => (
                  <tr key={`${row.marketplaceKey}:${row.amazonSku}`} className="border-t border-white/5">
                    <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white">{row.amazonSku}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.asin || '—'}</td>
                    <td className="max-w-md px-3 py-2 text-slate-300">{row.title || row.amazonTitle || '—'}</td>
                    <td className="px-3 py-2">{row.marketplace}</td>
                    <td className="px-3 py-2 font-semibold text-amber-200">{formatQty(row.amazonCurrentQty)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

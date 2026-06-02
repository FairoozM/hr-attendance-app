import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fetchBinary, downloadBlob } from '../api/client'

const STOCK_FILTERS = [
  { value: 'all', label: 'All' },
  {
    value: 'sellerCentralInactiveOos',
    label: 'Seller Central inactive OOS (Manage Inventory → Inactive → Out of stock)',
  },
  { value: 'amazonOutOfStock', label: 'Active · FBA on-hand & fulfillable 0' },
  { value: 'zohoOutOfStock', label: 'Zoho Out of Stock' },
  { value: 'mismatch', label: 'Mismatch' },
  { value: 'bothOutOfStock', label: 'Both Out of Stock' },
  { value: 'zohoNotFound', label: 'Zoho Not Found' },
]

const VALID_STOCK_FILTERS = new Set(STOCK_FILTERS.map((f) => f.value))
const VALID_MARKETPLACES = new Set(['all', 'uae', 'ksa'])

function parseStockFilter(raw) {
  const v = String(raw || 'all').trim()
  return VALID_STOCK_FILTERS.has(v) ? v : 'all'
}

function parseMarketplace(raw) {
  const v = String(raw || 'all').trim().toLowerCase()
  return VALID_MARKETPLACES.has(v) ? v : 'all'
}

function marketplaceToClearance(mk) {
  if (mk === 'ksa') return 'KSA'
  if (mk === 'uae') return 'UAE'
  return 'UAE'
}

function buildQuery(params) {
  const qs = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return
    qs.set(key, String(value))
  })
  return qs.toString()
}

function safeErrorMessage(err) {
  return err?.message || 'Request failed'
}

function formatNumber(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function statusBadgeClass(label) {
  const s = String(label || '').toLowerCase()
  if (s.includes('not found')) return 'border-orange-400/40 bg-orange-500/10 text-orange-200'
  if (s.includes('replenish') || s.includes('low') || s.includes('out of stock')) {
    return 'border-amber-400/40 bg-amber-500/10 text-amber-100'
  }
  if (s.includes('audit') || s.includes('mismatch')) return 'border-rose-400/40 bg-rose-500/10 text-rose-100'
  if (s.includes('matched') || s.includes('in stock')) return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
  return 'border-slate-500/40 bg-slate-500/10 text-slate-200'
}

function SummaryCard({ label, value, active, onClick, hint }) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? 'border-emerald-400/50 bg-emerald-500/15 ring-1 ring-emerald-400/30'
          : 'border-white/10 bg-white/[0.04]'
      } ${interactive ? 'cursor-pointer hover:border-emerald-400/40 hover:bg-emerald-500/10' : ''}`}
    >
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{formatNumber(value)}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </Tag>
  )
}

async function getAmazonZohoStock(params) {
  const query = buildQuery(params)
  return api.get(`/api/inventory/amazon-zoho-stock${query ? `?${query}` : ''}`)
}

async function startAmazonZohoStockRefresh(marketplace) {
  return api.post('/api/inventory/amazon-zoho-stock/refresh', { marketplace })
}

async function getAmazonZohoStockRefreshStatus(jobId) {
  return api.get(`/api/inventory/amazon-zoho-stock/refresh/${encodeURIComponent(jobId)}`)
}

async function exportAmazonZohoStock(params) {
  const query = buildQuery(params)
  return fetchBinary(`/api/inventory/amazon-zoho-stock/export${query ? `?${query}` : ''}`)
}

export function AmazonZohoStockPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [marketplace, setMarketplace] = useState(() => parseMarketplace(searchParams.get('marketplace')))
  const [search, setSearch] = useState(() => String(searchParams.get('search') || ''))
  const [stockFilter, setStockFilter] = useState(() => parseStockFilter(searchParams.get('stockFilter')))
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')

  const syncUrl = useCallback((next) => {
    const params = new URLSearchParams()
    if (next.marketplace && next.marketplace !== 'all') params.set('marketplace', next.marketplace)
    if (next.stockFilter && next.stockFilter !== 'all') params.set('stockFilter', next.stockFilter)
    if (next.search) params.set('search', next.search)
    setSearchParams(params, { replace: true })
  }, [setSearchParams])

  const scrollToSkuList = useCallback(() => {
    window.requestAnimationFrame(() => {
      document.getElementById('comparison-rows')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const applyStockFilter = useCallback((value) => {
    const v = parseStockFilter(value)
    setStockFilter(v)
    setPage(1)
    syncUrl({ marketplace, stockFilter: v, search })
    if (v === 'amazonOutOfStock' || v === 'sellerCentralInactiveOos') scrollToSkuList()
  }, [marketplace, search, syncUrl, scrollToSkuList])

  const applyMarketplace = useCallback((value) => {
    const v = parseMarketplace(value)
    setMarketplace(v)
    setPage(1)
    syncUrl({ marketplace: v, stockFilter, search })
  }, [stockFilter, search, syncUrl])

  const queryParams = useMemo(() => ({
    marketplace,
    search,
    stockFilter,
    page,
    limit,
  }), [marketplace, search, stockFilter, page, limit])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const json = await getAmazonZohoStock(queryParams)
      if (!json || json.success !== true) {
        setError(json?.error || 'Unexpected response')
        return
      }
      setPayload(json)
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [queryParams])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (
      (stockFilter === 'amazonOutOfStock' || stockFilter === 'sellerCentralInactiveOos') &&
      !loading &&
      (payload?.pagination?.total || 0) > 0
    ) {
      scrollToSkuList()
    }
  }, [stockFilter, loading, payload?.pagination?.total, scrollToSkuList])

  useEffect(() => {
    if (!job?.jobId || !['queued', 'running'].includes(job.status)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const json = await getAmazonZohoStockRefreshStatus(job.jobId)
        setJob(json)
        if (json.status === 'completed') {
          setRefreshing(false)
          setRefreshError('')
          void loadData()
        } else if (json.status === 'failed') {
          setRefreshing(false)
          setRefreshError(json.error || 'Refresh failed. Last cached data is still shown.')
        }
      } catch (e) {
        setRefreshing(false)
        setRefreshError(safeErrorMessage(e))
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job?.jobId, job?.status, loadData])

  const startRefresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError('')
    try {
      const json = await startAmazonZohoStockRefresh(marketplace)
      setJob(json)
      if (!['queued', 'running'].includes(json.status)) {
        setRefreshing(false)
      }
    } catch (e) {
      setRefreshing(false)
      setRefreshError(safeErrorMessage(e))
    }
  }, [marketplace])

  const runExport = useCallback(async () => {
    setExporting(true)
    setError('')
    try {
      const { blob, filename } = await exportAmazonZohoStock({ marketplace, search, stockFilter })
      downloadBlob(blob, filename || 'amazon-zoho-stock.csv')
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setExporting(false)
    }
  }, [marketplace, search, stockFilter])

  const rows = Array.isArray(payload?.data) ? payload.data : []
  const pagination = payload?.pagination || { page, limit, total: 0, pages: 1 }
  const summary = payload?.summary || {}
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : []
  const timestamps = payload?.timestamps || {}

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-transparent to-sky-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">Admin Inventory</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Amazon + Zoho Stock Comparison
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-400">
          Compare Amazon listings against Zoho Life Smile warehouse stock. Refresh pulls FBA API +
          AFN Manage Inventory report (Seller Flex on-hand). Use SC Inactive OOS for the ~26 SKUs bucket.
        </p>
        <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
          <p className="font-semibold text-emerald-100">Out of stock workflow (use this instead of slow clearance scans)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-emerald-50/90">
            <li>Pick marketplace (UAE or KSA), click <strong>Refresh</strong> once (background sync).</li>
            <li>
              Click <strong>Seller Central inactive OOS</strong> (your ~26 SKUs) or <strong>Amazon Out of Stock</strong>{' '}
              for the larger FBA zero-stock set.
            </li>
            <li>
              Open{' '}
              <Link
                className="font-semibold text-white underline"
                to={`/ai/amazon-out-of-stock-clearance?marketplace=${encodeURIComponent(marketplaceToClearance(marketplace))}&oosFilter=sellerCentralInactiveOos`}
              >
                Out of Stock Clearance
              </Link>{' '}
              for Vigil upload and replenishment recommendations.
            </li>
          </ol>
        </div>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-5">
            <label className="text-sm text-slate-400">
              Marketplace
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={marketplace}
                onChange={(e) => applyMarketplace(e.target.value)}
              >
                <option value="all">All</option>
                <option value="uae">UAE</option>
                <option value="ksa">KSA</option>
              </select>
            </label>
            <label className="text-sm text-slate-400 md:col-span-2">
              Search
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                placeholder="SKU / ASIN / title"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                  syncUrl({ marketplace, stockFilter, search: e.target.value })
                }}
              />
            </label>
            <label className="text-sm text-slate-400">
              Stock filter
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={stockFilter}
                onChange={(e) => applyStockFilter(e.target.value)}
              >
                {STOCK_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Page size
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Reload Cache'}
            </button>
            <button
              type="button"
              onClick={() => {
                applyStockFilter('amazonOutOfStock')
                scrollToSkuList()
              }}
              disabled={loading}
              className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Show Amazon OOS list ↓
            </button>
            <button
              type="button"
              onClick={startRefresh}
              disabled={refreshing || ['queued', 'running'].includes(job?.status)}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing || ['queued', 'running'].includes(job?.status) ? 'Refreshing…' : 'Refresh Amazon + Zoho'}
            </button>
            <button
              type="button"
              onClick={runExport}
              disabled={exporting}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
          <div>Amazon last fetched: <span className="font-mono text-slate-300">{formatDateTime(timestamps.amazonLastFetchedAt)}</span></div>
          <div>Zoho last fetched: <span className="font-mono text-slate-300">{formatDateTime(timestamps.zohoLastFetchedAt)}</span></div>
          <div>Comparison generated: <span className="font-mono text-slate-300">{formatDateTime(timestamps.comparisonGeneratedAt)}</span></div>
        </div>

        {job?.jobId && ['queued', 'running'].includes(job.status) ? (
          <div className="mt-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            Syncing: {job.progress?.step || job.status}
            {job.progress?.total > 0 ? ` (${formatNumber(job.progress.current)} / ${formatNumber(job.progress.total)})` : ''}
          </div>
        ) : null}
        {refreshError ? (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{refreshError}</div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <SummaryCard
          label="Total Active Listings"
          value={summary.totalActiveListings || 0}
          active={stockFilter === 'all'}
          onClick={() => applyStockFilter('all')}
          hint="Click to clear filter"
        />
        <SummaryCard
          label="SC Inactive OOS"
          value={summary.sellerCentralInactiveOos || 0}
          active={stockFilter === 'sellerCentralInactiveOos'}
          onClick={() => applyStockFilter('sellerCentralInactiveOos')}
          hint="Seller Central Inactive → Out of stock"
        />
        <SummaryCard
          label="Amazon Out of Stock"
          value={summary.amazonOutOfStock || 0}
          active={stockFilter === 'amazonOutOfStock'}
          onClick={() => applyStockFilter('amazonOutOfStock')}
          hint="Active · FBA on-hand & fulfillable 0"
        />
        <SummaryCard
          label="Zoho Out of Stock"
          value={summary.zohoOutOfStock || 0}
          active={stockFilter === 'zohoOutOfStock'}
          onClick={() => applyStockFilter('zohoOutOfStock')}
        />
        <SummaryCard
          label="Stock Mismatches"
          value={summary.mismatches || 0}
          active={stockFilter === 'mismatch'}
          onClick={() => applyStockFilter('mismatch')}
        />
        <SummaryCard
          label="Zoho Not Found"
          value={summary.zohoNotFound || 0}
          active={stockFilter === 'zohoNotFound'}
          onClick={() => applyStockFilter('zohoNotFound')}
        />
        <SummaryCard
          label="Both Out of Stock"
          value={summary.bothOutOfStock || 0}
          active={stockFilter === 'bothOutOfStock'}
          onClick={() => applyStockFilter('bothOutOfStock')}
        />
        <SummaryCard label="Low Zoho Stock" value={summary.lowZohoStock || 0} />
      </section>

      {(stockFilter === 'amazonOutOfStock' || stockFilter === 'sellerCentralInactiveOos') &&
      (summary.amazonOutOfStock || summary.sellerCentralInactiveOos || 0) > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <span>
            Showing {formatNumber(pagination.total)} SKU(s) from cache
            {marketplace !== 'all' ? ` (${marketplace.toUpperCase()})` : ''}.
          </span>
          <Link
            className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500"
            to={`/ai/amazon-out-of-stock-clearance?marketplace=${encodeURIComponent(marketplaceToClearance(marketplace))}&oosFilter=${stockFilter === 'sellerCentralInactiveOos' ? 'sellerCentralInactiveOos' : 'amazonFbaZero'}`}
          >
            Continue to Clearance →
          </Link>
        </div>
      ) : null}

      <section id="comparison-rows" className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md scroll-mt-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {stockFilter === 'sellerCentralInactiveOos'
                ? 'Seller Central inactive OOS SKU list'
                : stockFilter === 'amazonOutOfStock'
                  ? 'Amazon active · FBA zero-stock SKU list'
                  : 'Comparison rows'}
            </h2>
            <p className="text-sm text-slate-500">
              Showing {rows.length} of {formatNumber(pagination.total)} rows
              {stockFilter === 'sellerCentralInactiveOos'
                ? ' (Inactive → Out of stock)'
                : stockFilter === 'amazonOutOfStock'
                  ? ' (active · FBA on-hand & fulfillable = 0)'
                  : ''}
              .
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-1 hover:bg-white/10 disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>Page {pagination.page || page} / {pagination.pages || 1}</span>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-1 hover:bg-white/10 disabled:opacity-50"
              disabled={page >= (pagination.pages || 1) || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-4 max-h-[70vh] overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-[140rem] text-left text-sm text-slate-200">
            <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-3">Image</th>
                <th className="px-3 py-3">Listing status</th>
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">ASIN</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Marketplace</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">FBA on-hand (total)</th>
                <th className="px-3 py-3">FBA fulfillable</th>
                <th className="px-3 py-3">Amazon Reserved</th>
                <th className="px-3 py-3">Amazon Inbound</th>
                <th className="px-3 py-3">Amazon Unfulfillable</th>
                <th className="px-3 py-3">Zoho Life Smile Available</th>
                <th className="px-3 py-3">Zoho Actual</th>
                <th className="px-3 py-3">Zoho Committed</th>
                <th className="px-3 py-3">Difference</th>
                <th className="px-3 py-3">Status / Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.marketplace}:${row.normalizedSku}`} className="border-t border-white/5 align-top">
                  <td className="px-3 py-3">
                    {row.image ? (
                      <img src={row.image} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 text-xs text-slate-500">No img</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-amber-200/90">
                    {row.listingStatus === 'INACTIVE_OOS'
                      ? 'Inactive · OOS'
                      : row.listingStatus === 'ACTIVE'
                        ? 'Active'
                        : row.listingStatus || '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-100">{row.sellerSku}</td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">{row.asin || '—'}</td>
                  <td className="max-w-md px-3 py-3 text-slate-300">{row.title || '—'}</td>
                  <td className="px-3 py-3">{row.marketplace}</td>
                  <td className="px-3 py-3">
                    {row.price?.amount == null ? '—' : `${row.price.currencyCode || ''} ${formatNumber(row.price.amount)}`}
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {formatNumber(row.amazon?.totalQty ?? row.amazon?.availableQty)}
                  </td>
                  <td className="px-3 py-3">{formatNumber(row.amazon?.availableQty)}</td>
                  <td className="px-3 py-3">{formatNumber(row.amazon?.reservedQty)}</td>
                  <td className="px-3 py-3">{formatNumber(row.amazon?.inboundQty)}</td>
                  <td className="px-3 py-3">{formatNumber(row.amazon?.unfulfillableQty)}</td>
                  <td className="px-3 py-3 font-semibold">{formatNumber(row.zoho?.availableQty)}</td>
                  <td className="px-3 py-3">{formatNumber(row.zoho?.actualQty)}</td>
                  <td className="px-3 py-3">{formatNumber(row.zoho?.committedQty)}</td>
                  <td className={`px-3 py-3 font-semibold ${Number(row.comparison?.difference) < 0 ? 'text-rose-300' : 'text-slate-100'}`}>
                    {formatNumber(row.comparison?.difference)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-2">
                      <span className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(row.comparison?.recommendedAction)}`}>
                        {row.comparison?.recommendedAction || '—'}
                      </span>
                      <span className="text-xs text-slate-500">
                        Amazon: {row.amazon?.stockStatus || 'Unknown'} · Zoho: {row.zoho?.stockStatus || 'Unknown'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-12 text-center text-slate-500">
                    No comparison rows found. Run refresh to generate cached data or adjust filters.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={17} className="px-3 py-12 text-center text-slate-500">Loading cached comparison data…</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

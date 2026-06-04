import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fetchBinary, downloadBlob } from '../api/client'

const STOCK_FILTERS = [
  { value: 'all', label: 'Active listings (default)' },
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
  if (s.includes('not found')) return 'ainv-badge ainv-badge--warn'
  if (s.includes('replenish') || s.includes('low') || s.includes('out of stock')) {
    return 'ainv-badge ainv-badge--warn'
  }
  if (s.includes('audit') || s.includes('mismatch')) return 'ainv-badge ainv-badge--danger'
  if (s.includes('matched') || s.includes('in stock')) return 'ainv-badge ainv-badge--ok'
  return 'ainv-badge ainv-badge--neutral'
}

function SummaryCard({ label, value, active, onClick, hint }) {
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`ainv-summary-card ${active ? 'ainv-summary-card--active' : ''} ${
        interactive ? 'ainv-summary-card--interactive' : ''
      }`}
    >
      <p className="ainv-summary-card__label">{label}</p>
      <p className="ainv-summary-card__value">{formatNumber(value)}</p>
      {hint ? <p className="ainv-summary-card__hint">{hint}</p> : null}
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
        if (json.status === 'running' || json.status === 'queued') {
          void loadData()
        }
        if (json.status === 'completed') {
          setRefreshing(false)
          setRefreshError('')
          void loadData()
        } else if (json.status === 'failed') {
          setRefreshing(false)
          setRefreshError(json.error || 'Refresh failed. Last cached data is still shown.')
          void loadData()
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
  const allWarnings = Array.isArray(payload?.warnings) ? payload.warnings : []
  const timestamps = payload?.timestamps || {}
  const syncInProgress =
    refreshing || ['queued', 'running'].includes(job?.status || '') || Boolean(payload?.refreshRunning)
  const warnings = syncInProgress
    ? allWarnings.filter(
        (w) =>
          !String(w).includes('older than') &&
          !String(w).toLowerCase().includes('run refresh for fresh')
      )
    : allWarnings

  return (
    <div className="ainv-page mx-auto flex max-w-[120rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header">
        <p className="ainv-page__eyebrow">Admin Inventory</p>
        <h1 className="ainv-page__title">Amazon + Zoho Stock Comparison</h1>
        <p className="ainv-page__lead">
          Compare <strong>Seller Flex / Amazon-fulfilled</strong> active listings against Zoho stock. FBM and search
          suppressed SKUs are excluded. Refresh pulls FBA API + AFN Manage Inventory for on-hand.
        </p>
        <div className="ainv-callout-emerald">
          <p className="ainv-callout-emerald__title">Out of stock workflow (use this instead of slow clearance scans)</p>
          <ol>
            <li>Pick marketplace (UAE or KSA), click <strong>Refresh</strong> once (background sync).</li>
            <li>
              Click <strong>Amazon Out of Stock</strong> for active listings where FBA on-hand and fulfillable are both
              zero (not the full catalog).
            </li>
            <li>
              Open{' '}
              <Link
                to={`/ai/amazon-out-of-stock-clearance?marketplace=${encodeURIComponent(marketplaceToClearance(marketplace))}&oosFilter=sellerCentralInactiveOos`}
              >
                Out of Stock Clearance
              </Link>{' '}
              for Vigil upload and replenishment recommendations.
            </li>
          </ol>
        </div>
      </header>

      <section className="ainv-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-5">
            <label className="ainv-label">
              Marketplace
              <select
                className="ainv-input"
                value={marketplace}
                onChange={(e) => applyMarketplace(e.target.value)}
              >
                <option value="all">All</option>
                <option value="uae">UAE</option>
                <option value="ksa">KSA</option>
              </select>
            </label>
            <label className="ainv-label md:col-span-2">
              Search
              <input
                className="ainv-input"
                placeholder="SKU / ASIN / title"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                  syncUrl({ marketplace, stockFilter, search: e.target.value })
                }}
              />
            </label>
            <label className="ainv-label">
              Stock filter
              <select
                className="ainv-input"
                value={stockFilter}
                onChange={(e) => applyStockFilter(e.target.value)}
              >
                {STOCK_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="ainv-label">
              Page size
              <select
                className="ainv-input"
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
              className="ainv-btn"
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
              className="ainv-btn ainv-btn--amber"
            >
              Show Amazon OOS list ↓
            </button>
            <button
              type="button"
              onClick={startRefresh}
              disabled={refreshing || ['queued', 'running'].includes(job?.status)}
              className="ainv-btn ainv-btn--primary-emerald"
            >
              {refreshing || ['queued', 'running'].includes(job?.status) ? 'Refreshing…' : 'Refresh Amazon + Zoho'}
            </button>
            <button
              type="button"
              onClick={runExport}
              disabled={exporting}
              className="ainv-btn ainv-btn--primary-sky"
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-xs md:grid-cols-3" style={{ color: 'var(--text-dim)' }}>
          <div>Amazon last fetched: <span className="font-mono" style={{ color: 'var(--text-soft)' }}>{formatDateTime(timestamps.amazonLastFetchedAt)}</span></div>
          <div>Zoho last fetched: <span className="font-mono" style={{ color: 'var(--text-soft)' }}>{formatDateTime(timestamps.zohoLastFetchedAt)}</span></div>
          <div>Comparison generated: <span className="font-mono" style={{ color: 'var(--text-soft)' }}>{formatDateTime(timestamps.comparisonGeneratedAt)}</span></div>
        </div>

        {syncInProgress ? (
          <div className="ainv-banner ainv-banner--sky mt-4">
            Syncing: {job?.progress?.step || 'Running refresh…'}
            {job?.progress?.total > 0
              ? ` (${formatNumber(job.progress.current)} / ${formatNumber(job.progress.total)})`
              : ''}
            {' '}
            — table updates after each marketplace is saved.
          </div>
        ) : null}
        {refreshError ? (
          <div className="ainv-banner ainv-banner--amber mt-4">{refreshError}</div>
        ) : null}
        {error ? (
          <div className="ainv-banner ainv-banner--rose mt-4">{error}</div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="ainv-banner ainv-banner--amber mt-4">
            {warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          label="Seller Flex Listings"
          value={summary.totalActiveListings || 0}
          active={stockFilter === 'all'}
          onClick={() => applyStockFilter('all')}
          hint="Amazon-fulfilled active SKUs only"
        />
        <SummaryCard
          label="Amazon Out of Stock"
          value={summary.amazonOutOfStock || 0}
          active={stockFilter === 'amazonOutOfStock'}
          onClick={() => applyStockFilter('amazonOutOfStock')}
          hint="Active only · FBA qty = 0 (zeros expected)"
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
        <div className="ainv-banner ainv-banner--sky flex flex-wrap items-center gap-3">
          <span>
            Showing {formatNumber(pagination.total)} SKU(s) from cache
            {marketplace !== 'all' ? ` (${marketplace.toUpperCase()})` : ''}.
          </span>
          <Link
            className="ainv-btn ainv-btn--primary-sky !py-1.5 !px-3"
            to={`/ai/amazon-out-of-stock-clearance?marketplace=${encodeURIComponent(marketplaceToClearance(marketplace))}&oosFilter=${stockFilter === 'sellerCentralInactiveOos' ? 'sellerCentralInactiveOos' : 'amazonFbaZero'}`}
          >
            Continue to Clearance →
          </Link>
        </div>
      ) : null}

      <section id="comparison-rows" className="ainv-panel scroll-mt-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="ainv-section-title">
              {stockFilter === 'sellerCentralInactiveOos'
                ? 'Seller Central inactive OOS SKU list'
                : stockFilter === 'amazonOutOfStock'
                  ? 'Amazon active · FBA zero-stock SKU list'
                  : 'Comparison rows'}
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
              Showing {rows.length} of {formatNumber(pagination.total)} rows
              {stockFilter === 'amazonOutOfStock'
                ? ' (Seller Flex · FBA qty = 0 by design)'
                : ' (Seller Flex / Amazon-fulfilled only)'}
              .
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <button
              type="button"
              className="ainv-pagination-btn"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>Page {pagination.page || page} / {pagination.pages || 1}</span>
            <button
              type="button"
              className="ainv-pagination-btn"
              disabled={page >= (pagination.pages || 1) || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <div className="ainv-table-wrap" style={{ maxWidth: '100%' }}>
          <table className="ainv-table" style={{ minWidth: '95rem' }}>
            <thead>
              <tr>
                <th className="px-3 py-3">Image</th>
                <th className="px-3 py-3">Listing status</th>
                <th className="px-3 py-3">Fulfillment</th>
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">ASIN</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Marketplace</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Seller Flex on-hand</th>
                <th className="px-3 py-3">Seller Flex fulfillable</th>
                <th className="px-3 py-3">Zoho available for sale</th>
                <th className="px-3 py-3">Difference</th>
                <th className="px-3 py-3">Status / Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.marketplace}:${row.normalizedSku}`}>
                  <td>
                    {row.image ? (
                      <img src={row.image} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg text-xs ainv-table__muted" style={{ background: 'var(--theme-surface-soft)' }}>No img</div>
                    )}
                  </td>
                  <td className="ainv-table__status-inactive">
                    {row.listingStatus === 'INACTIVE_OOS'
                      ? 'Inactive · OOS'
                      : row.listingStatus === 'SEARCH_SUPPRESSED'
                        ? 'Search suppressed'
                        : row.listingStatus === 'ACTIVE'
                          ? 'Active'
                          : row.listingStatus || '—'}
                  </td>
                  <td className="px-3 py-3 text-xs ainv-table__muted">
                    {row.fulfillmentChannel === 'AMAZON' || String(row.fulfillmentChannel || '').includes('AMAZON')
                      ? 'Amazon'
                      : row.fulfillmentChannel === 'DEFAULT'
                        ? 'FBM'
                        : row.fulfillmentChannel || '—'}
                  </td>
                  <td className="ainv-table__sku">{row.sellerSku}</td>
                  <td className="ainv-table__sku ainv-table__muted">{row.asin || '—'}</td>
                  <td className="max-w-md">{row.title || '—'}</td>
                  <td className="px-3 py-3">{row.marketplace}</td>
                  <td className="px-3 py-3">
                    {row.price?.amount == null ? '—' : `${row.price.currencyCode || ''} ${formatNumber(row.price.amount)}`}
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {formatNumber(row.amazon?.totalQty ?? row.amazon?.availableQty)}
                  </td>
                  <td className="px-3 py-3">{formatNumber(row.amazon?.availableQty)}</td>
                  <td className="px-3 py-3 font-semibold">{formatNumber(row.zoho?.availableQty)}</td>
                  <td className="font-semibold" style={{ color: Number(row.comparison?.difference) < 0 ? '#be123c' : 'var(--text)' }}>
                    {formatNumber(row.comparison?.difference)}
                  </td>
                  <td>
                    <div className="flex flex-col gap-2">
                      <span className={statusBadgeClass(row.comparison?.recommendedAction)}>
                        {row.comparison?.recommendedAction || '—'}
                      </span>
                      <span className="text-xs ainv-table__muted">
                        Amazon: {row.amazon?.stockStatus || 'Unknown'} · Zoho: {row.zoho?.stockStatus || 'Unknown'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center ainv-table__muted">
                    No comparison rows found. Run refresh to generate cached data or adjust filters.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center ainv-table__muted">Loading cached comparison data…</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

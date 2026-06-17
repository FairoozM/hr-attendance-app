import { useState, useCallback, useEffect, useMemo } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AmazonSkuImageThumb } from '../components/AmazonSkuImageThumb'
import {
  ianaKeyForDashboardMarketplace,
  isRangeWithinSyncLimit,
  rangeForMarketplacePreset,
} from '../utils/amazonMarketplaceTime'

function safeErrorMessage(err) {
  if (err?.body && typeof err.body === 'object') {
    if (typeof err.body.error === 'string' && err.body.error.trim()) return err.body.error.trim()
    if (typeof err.body.message === 'string' && err.body.message.trim()) return err.body.message.trim()
  }
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim()
  return 'Request failed'
}

function amazonRequestIdFromClientBody(body) {
  if (!body || typeof body !== 'object') return null
  const id = body.amazonRequestId
  if (typeof id === 'string' && id.trim()) return id.trim().slice(0, 128)
  return null
}

function AmazonRequestIdNote({ requestId, className = '' }) {
  if (!requestId) return null
  return (
    <p className={`mt-2 font-mono text-[11px] leading-relaxed text-slate-500 ${className}`} role="note">
      Amazon Request ID: {requestId}
    </p>
  )
}

function formatMoneyDisplay(currencyCode, amount) {
  const code = String(currencyCode || '').trim()
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  if (!code || code === '—' || code === '?')
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (code.length !== 3)
    return `${code} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${code} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  )
}

/**
 * Amazon BI from cached orders only (no live SP-API on load).
 */
export function AmazonOrdersDashboardPage() {
  const { user } = useAuth()
  const canSync = user && (user.role === 'admin' || user.role === 'warehouse')
  const isAdmin = user?.role === 'admin'

  const [marketplaceKey, setMarketplaceKey] = useState('all')
  const [preset, setPreset] = useState('last7')
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [amazonRequestIdLoad, setAmazonRequestIdLoad] = useState('')
  const [amazonRequestIdSync, setAmazonRequestIdSync] = useState('')
  const [syncPhase, setSyncPhase] = useState('')
  const [data, setData] = useState(null)

  const presetTzLabel = useMemo(() => {
    const k = ianaKeyForDashboardMarketplace(marketplaceKey)
    return marketplaceKey === 'all'
      ? `Presets use ${k} calendar (same as UAE). Orders-by-day while viewing All also use ${k}.`
      : `Presets use ${k} business-day boundaries.`
  }, [marketplaceKey])

  const { createdAfter, createdBefore } = useMemo(
    () => rangeForMarketplacePreset(marketplaceKey, preset, customFrom, customTo),
    [marketplaceKey, preset, customFrom, customTo],
  )

  const syncAllowedByRange = isRangeWithinSyncLimit(createdAfter, createdBefore)
  const syncDisabledReason = !syncAllowedByRange
    ? 'Amazon sync allows at most 7 days. Narrow the date range to sync.'
    : null

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setAmazonRequestIdLoad('')
    try {
      const qs = new URLSearchParams({
        marketplaceKey,
        createdAfter: createdAfter.toISOString(),
        createdBefore: createdBefore.toISOString(),
        includeSkuImages: '1',
      })
      const json = await api.get(`/api/amazon/dashboard/orders?${qs.toString()}`)
      if (!json?.success || !json.data) {
        setError(typeof json?.message === 'string' ? json.message : 'Unexpected response')
        setData(null)
        return
      }
      setData(json.data)
    } catch (e) {
      setError(safeErrorMessage(e))
      setAmazonRequestIdLoad(amazonRequestIdFromClientBody(e.body) || '')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [marketplaceKey, createdAfter, createdBefore])

  useEffect(() => {
    void load()
  }, [load])

  const syncSelectedRange = useCallback(async () => {
    if (!canSync || !syncAllowedByRange) return
    const keys = marketplaceKey === 'all' ? ['uae', 'ksa'] : [marketplaceKey]
    setSyncing(true)
    setSyncMessage('')
    setError('')
    setAmazonRequestIdSync('')
    const parts = []
    const errs = []
    const syncRids = []
    const errRids = []
    try {
      for (const mk of keys) {
        setSyncPhase(`Syncing ${mk.toUpperCase()}…`)
        try {
          const json = await api.post('/api/amazon/orders/sync', {
            marketplaceKey: mk,
            createdAfter: createdAfter.toISOString(),
            createdBefore: createdBefore.toISOString(),
            includeItems: true,
          })
          const summary = json?.data
          const msg =
            summary && typeof summary.message === 'string' ? summary.message : 'Sync finished.'
          parts.push(`${mk.toUpperCase()}: ${msg}`)
          const ref = summary?.amazonSupportRef
          if (ref && typeof ref.amazonRequestId === 'string' && ref.amazonRequestId.trim()) {
            syncRids.push(`${mk.toUpperCase()}: ${ref.amazonRequestId.trim().slice(0, 128)}`)
          }
        } catch (e) {
          errs.push(`${mk.toUpperCase()}: ${safeErrorMessage(e)}`)
          const rid = amazonRequestIdFromClientBody(e.body)
          if (rid) errRids.push(`${mk.toUpperCase()}: ${rid}`)
        }
      }
      if (parts.length) setSyncMessage(parts.join(' · '))
      if (errs.length) setError(errs.join(' · '))
      if (syncRids.length) setAmazonRequestIdSync(syncRids.join(' · '))
      else setAmazonRequestIdSync('')
      if (errs.length) {
        setAmazonRequestIdLoad(errRids.length ? errRids.join(' · ') : '')
      } else {
        setAmazonRequestIdLoad('')
      }
      await load()
    } finally {
      setSyncPhase('')
      setSyncing(false)
    }
  }, [canSync, marketplaceKey, createdAfter, createdBefore, syncAllowedByRange, load])

  const salesLines = useMemo(() => {
    if (!data?.totalSalesByCurrency?.length) return '—'
    return data.totalSalesByCurrency.map((r) => formatMoneyDisplay(r.currencyCode, r.amount)).join(' · ')
  }, [data])

  const maxDayCount = useMemo(() => {
    if (!data?.ordersByDay?.length) return 1
    return Math.max(1, ...data.ordersByDay.map((r) => r.orderCount || 0))
  }, [data])

  const coverage = data?.cacheCoverage
  const dayBucketLabel = data?.ordersByDayTimeZone
    ? `Calendar date in ${data.ordersByDayTimeZone} (purchase timestamps grouped in that zone).`
    : 'Calendar date by marketplace zone.'

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">Amazon BI (cache)</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Amazon BI Dashboard
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Aggregates are computed from <strong className="text-slate-300">locally cached</strong> Amazon orders and line
          items. Top-SKU thumbnails use <strong className="text-slate-300">Search Catalog Items</strong> by ASIN from
          cache (rate-limited; no buyer PII). <strong className="text-slate-300">Sync selected range</strong> pulls the
          current window from Amazon into cache (UAE only, KSA only, or UAE then KSA when viewing All; guardrails
          apply).
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          <label className="flex min-w-[12rem] flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace</span>
            <select
              value={marketplaceKey}
              onChange={(e) => setMarketplaceKey(e.target.value)}
              disabled={loading || syncing}
              className="rounded-xl border border-white/10 bg-slate-950/80 px-4 py-2.5 text-sm font-medium text-white outline-none ring-emerald-500/40 focus:ring-2 disabled:opacity-50"
            >
              <option value="all">All (UAE + KSA)</option>
              <option value="uae">UAE / Amazon.ae</option>
              <option value="ksa">KSA / Amazon.sa</option>
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Date range</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'last7', label: 'Last 7 days' },
                { id: 'last30', label: 'Last 30 days' },
                { id: 'custom', label: 'Custom' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  disabled={loading || syncing}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                    preset === p.id
                      ? 'bg-emerald-600 text-white ring-1 ring-emerald-400/50'
                      : 'bg-white/5 text-slate-300 ring-1 ring-white/10 hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {preset === 'custom' ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                From ({ianaKeyForDashboardMarketplace(marketplaceKey)})
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  disabled={loading || syncing}
                  className="rounded-lg border border-white/10 bg-slate-950/80 px-2 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                To ({ianaKeyForDashboardMarketplace(marketplaceKey)})
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  disabled={loading || syncing}
                  className="rounded-lg border border-white/10 bg-slate-950/80 px-2 py-2 text-sm text-white"
                />
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || syncing}
              className="rounded-xl bg-emerald-700/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {canSync ? (
              <button
                type="button"
                onClick={() => void syncSelectedRange()}
                disabled={loading || syncing || Boolean(syncDisabledReason)}
                title={
                  syncDisabledReason ||
                  (marketplaceKey === 'all'
                    ? 'Runs guarded sync for UAE, then KSA (same date window).'
                    : 'Pull this window from Amazon into cache')
                }
                className="rounded-xl bg-sky-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/20 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncing ? syncPhase || 'Syncing…' : 'Sync selected range'}
              </button>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-snug text-slate-500">{presetTzLabel}</p>
        {syncDisabledReason && canSync ? (
          <p className="mt-1 text-[11px] text-amber-200/80">{syncDisabledReason}</p>
        ) : null}
        {marketplaceKey === 'all' && canSync ? (
          <p className="mt-1 text-[11px] text-slate-500">
            With <span className="text-slate-400">All</span>, <strong className="text-slate-400">Sync selected range</strong>{' '}
            runs a guarded sync for <strong className="text-slate-400">UAE</strong>, then <strong className="text-slate-400">KSA</strong>, using the same date window (cooldowns are per marketplace).
          </p>
        ) : null}

        {data?.source ? (
          <p className="mt-4 text-xs text-slate-500">
            Source: <span className="text-slate-300">{data.source}</span>
            {' · '}
            <span className="font-mono text-slate-400">
              {new Date(data.createdAfter).toLocaleString()} — {new Date(data.createdBefore).toLocaleString()}{' '}
              <span className="text-slate-600">(UTC ISO sent to API)</span>
            </span>
          </p>
        ) : null}

        {coverage && !coverage.fullyCovered ? (
          <div
            className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            role="status"
          >
            <p className="font-medium">{coverage.message}</p>
            {coverage.lastSuccessfulSync ? (
              <p className="mt-1 text-xs text-amber-200/80">
                Last successful sync (any window):{' '}
                <span className="font-mono">{new Date(coverage.lastSuccessfulSync).toLocaleString()}</span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-200/80">No successful sync logged for this marketplace yet.</p>
            )}
          </div>
        ) : null}

        {coverage && coverage.fullyCovered ? (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-100/90">
            {coverage.message}
            {coverage.lastSuccessfulSync ? (
              <>
                {' '}
                <span className="font-mono text-emerald-200/80">
                  ({new Date(coverage.lastSuccessfulSync).toLocaleString()})
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {syncMessage ? (
          <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-100" role="status">
            {syncMessage}
            <AmazonRequestIdNote requestId={amazonRequestIdSync} className="text-sky-200/70" />
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
            {error}
            <AmazonRequestIdNote requestId={amazonRequestIdLoad} className="text-rose-200/60" />
          </div>
        ) : null}

        {data ? (
          <>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Total orders" value={String(data.totalOrders ?? 0)} />
              <StatCard label="Total sales" value={salesLines} sub="By order currency" />
              <StatCard label="Shipped orders (any units)" value={String(data.shippedOrders ?? 0)} />
              <StatCard label="Pending units (orders)" value={String(data.pendingOrders ?? 0)} sub="Unshipped qty &gt; 0" />
              <StatCard label="Unshipped items (sum)" value={String(data.unshippedItems ?? 0)} />
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <div>
                <h2 className="text-lg font-bold text-white">Orders by day</h2>
                <p className="mt-1 text-xs text-slate-500">{dayBucketLabel}</p>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead className="bg-white/[0.04] text-xs uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Currency</th>
                        <th className="px-3 py-2 text-right">Orders</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="min-w-[120px] px-3 py-2">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!data.ordersByDay || data.ordersByDay.length === 0) && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            No orders with totals in this range.
                          </td>
                        </tr>
                      )}
                      {data.ordersByDay?.map((row, i) => (
                        <tr key={`${row.date}-${row.currencyCode}-${i}`} className="border-t border-white/5">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.date}</td>
                          <td className="px-3 py-2">{row.currencyCode}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoneyDisplay(row.currencyCode, row.totalAmount)}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-2 rounded-full bg-emerald-500/80"
                                style={{ width: `${Math.min(100, ((row.orderCount || 0) / maxDayCount) * 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h2 className="text-lg font-bold text-white">Marketplace breakdown</h2>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead className="bg-white/[0.04] text-xs uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Region</th>
                        <th className="px-3 py-2">Marketplace ID</th>
                        <th className="px-3 py-2">Currency</th>
                        <th className="px-3 py-2 text-right">Orders</th>
                        <th className="px-3 py-2 text-right">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!data.marketplaceBreakdown || data.marketplaceBreakdown.length === 0) && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            No data.
                          </td>
                        </tr>
                      )}
                      {data.marketplaceBreakdown?.map((row, i) => (
                        <tr key={`${row.marketplaceKey}-${row.currencyCode}-${i}`} className="border-t border-white/5">
                          <td className="px-3 py-2 font-medium uppercase">{row.marketplaceKey}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.marketplaceId || '—'}</td>
                          <td className="px-3 py-2">{row.currencyCode}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoneyDisplay(row.currencyCode === '—' ? '' : row.currencyCode, row.totalSales)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-10">
              <h2 className="text-lg font-bold text-white">Top SKUs (line items)</h2>
              <p className="mt-1 text-xs text-slate-500">
                By summed line revenue in range.
                {data.includeSkuImages ? (
                  <span>
                    {' '}
                    Thumbnails use cached catalog data (dominant ASIN per SKU); live catalog calls are capped and
                    rate-limited.
                  </span>
                ) : null}
              </p>
              {data.imageFetchStatus === 'failed' && data.imageFetchMessage ? (
                <p className="mt-2 text-xs text-amber-200/90" role="status">
                  {data.imageFetchMessage}
                </p>
              ) : null}
              <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="bg-white/[0.04] text-xs uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Image</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2 text-right">Qty ordered</th>
                      <th className="px-3 py-2 text-right">Qty shipped</th>
                      <th className="px-3 py-2 text-right">Sales</th>
                      <th className="px-3 py-2 text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!data.topSkus || data.topSkus.length === 0) && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                          No line items in cache for this range (sync orders with items to populate).
                        </td>
                      </tr>
                    )}
                    {data.topSkus?.map((row, i) => (
                      <tr key={`${row.sellerSku}-${row.currencyCode}-${i}`} className="border-t border-white/5">
                        <td className="px-3 py-2 align-middle">
                          <AmazonSkuImageThumb
                            imageUrl={row.imageUrl}
                            imageSource={row.imageSource}
                            zohoItemId={row.zohoItemId}
                            sizeClass="h-11 w-11"
                            imgTitle={
                              isAdmin && row.imageSource && row.imageSource !== 'none'
                                ? `image: ${String(row.imageSource)}`
                                : undefined
                            }
                          />
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs text-emerald-200/90" title={row.sellerSku}>
                          {row.sellerSku}
                        </td>
                        <td className="max-w-[18rem] truncate px-3 py-2 text-slate-400" title={row.title || ''}>
                          {row.title || '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.quantityOrdered}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.quantityShipped}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoneyDisplay(row.currencyCode, row.totalSales)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

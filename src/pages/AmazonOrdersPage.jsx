import { useState, useCallback, useMemo, useEffect } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AmazonSkuImageThumb } from '../components/AmazonSkuImageThumb'

const MARKETPLACES = [
  { key: 'uae', label: 'UAE / Amazon.ae', marketplaceKey: 'uae' },
  { key: 'ksa', label: 'KSA / Amazon.sa', marketplaceKey: 'ksa' },
]

/** Match backend `amazonOrdersSyncService` default window (≈7 days, slightly before “now”). */
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000
const MS_BEFORE_NOW = 130_000
const RANGE_SLACK_MS = 60_000

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isoToDateInputValue(iso) {
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function getDefaultDateRangeIso() {
  const now = Date.now()
  const createdBefore = new Date(now - MS_BEFORE_NOW)
  const createdAfter = new Date(now - MAX_RANGE_MS)
  return {
    createdAfter: createdAfter.toISOString(),
    createdBefore: createdBefore.toISOString(),
  }
}

function startOfLocalDayYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

function endOfLocalDayYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 23, 59, 59, 999)
}

/** @returns {{ createdAfter: string, createdBefore: string } | { error: string }} */
function buildRangeFromDateInputs(dateFrom, dateTo) {
  const start = startOfLocalDayYmd(dateFrom)
  const end = endOfLocalDayYmd(dateTo)
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Choose a valid start and end date.' }
  }
  if (end.getTime() <= start.getTime()) {
    return { error: 'End date must be after the start date.' }
  }
  const span = end.getTime() - start.getTime()
  if (span > MAX_RANGE_MS + RANGE_SLACK_MS) {
    return { error: 'Date range cannot exceed 7 days (Amazon sync guardrail).' }
  }
  return { createdAfter: start.toISOString(), createdBefore: end.toISOString() }
}

function safeErrorMessage(err) {
  if (err?.body && typeof err.body === 'object') {
    if (typeof err.body.error === 'string' && err.body.error.trim()) return err.body.error.trim()
    if (typeof err.body.message === 'string' && err.body.message.trim()) return err.body.message.trim()
  }
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim()
  return 'Request failed'
}

/** Safe Amazon `x-amzn-requestid` from API client error body (never tokens). */
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

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseOrderAmount(order) {
  const ot = order?.OrderTotal
  if (!ot || typeof ot !== 'object') return null
  const code = ot.CurrencyCode != null ? String(ot.CurrencyCode).trim() : ''
  const raw = ot.Amount
  const amount = typeof raw === 'string' ? parseFloat(raw.replace(/,/g, '')) : Number(raw)
  if (!code || !Number.isFinite(amount)) return null
  return { amount, currency: code }
}

function aggregateOrders(orders) {
  let shippedItems = 0
  let pendingItems = 0
  const currencies = new Set()
  const amounts = []

  for (const o of orders) {
    shippedItems += toNum(o.NumberOfItemsShipped)
    pendingItems += toNum(o.NumberOfItemsUnshipped)
    const parsed = parseOrderAmount(o)
    if (parsed) {
      currencies.add(parsed.currency)
      amounts.push(parsed)
    }
  }

  let totalValue = null
  let currency = '—'
  if (currencies.size === 1) {
    currency = [...currencies][0]
    totalValue = amounts.reduce((sum, { amount }) => sum + amount, 0)
  } else if (currencies.size > 1) {
    currency = 'Mixed'
    totalValue = null
  }

  return { shippedItems, pendingItems, totalValue, currency }
}

function formatPurchaseDate(iso) {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatMoney(value, curr) {
  if (value == null || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${curr}`
  }
}

function formatSyncTime(iso) {
  if (!iso) return '—'
  return formatPurchaseDate(iso)
}

function formatItemTitles(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items
    .map((it) => (it && it.Title != null ? String(it.Title).trim() : ''))
    .filter(Boolean)
    .join(' · ')
}

function SkuCell({ row }) {
  const { user } = useAuth()
  const skus = Array.isArray(row.skus) ? row.skus.filter(Boolean) : []
  const skuText = skus.length ? skus.join(', ') : '—'
  const titles = formatItemTitles(row.items)
  const pi = row.primaryItem && typeof row.primaryItem === 'object' ? row.primaryItem : null
  const titlePreview =
    pi && typeof pi.title === 'string' && pi.title.trim()
      ? pi.title.trim()
      : titles || ''
  const adminImgTitle =
    user?.role === 'admin' &&
    pi &&
    typeof pi.imageSource === 'string' &&
    pi.imageSource.trim() &&
    pi.imageSource !== 'none'
      ? `image: ${pi.imageSource.trim()}`
      : undefined

  return (
    <div className="flex max-w-[18rem] gap-2.5">
      <AmazonSkuImageThumb
        imageUrl={pi?.imageUrl}
        imageSource={pi?.imageSource}
        zohoItemId={pi?.zohoItemId}
        imgTitle={adminImgTitle}
      />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs leading-snug text-sky-200">{skuText}</div>
        {row.itemFetchError ? (
          <div className="mt-1 text-[11px] leading-snug text-amber-400/90" title={String(row.itemFetchError)}>
            {String(row.itemFetchError)}
          </div>
        ) : null}
        {row.itemsSyncPending ? (
          <div className="mt-1 text-[10px] text-amber-200/80">Item sync pending — run a full sync to load SKUs.</div>
        ) : null}
        {titlePreview ? (
          <div
            className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500"
            title={titlePreview}
          >
            {titlePreview}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tracking-tight text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  )
}

/**
 * Cached Amazon orders + guarded sync (no live SP-API from the browser).
 */
export function AmazonOrdersPage() {
  const { user } = useAuth()
  const canSync = user && (user.role === 'admin' || user.role === 'warehouse')
  const isAdmin = user?.role === 'admin'

  const defaultRange = getDefaultDateRangeIso()
  const [marketplaceKey, setMarketplaceKey] = useState('uae')
  const [dateFrom, setDateFrom] = useState(() => isoToDateInputValue(defaultRange.createdAfter))
  const [dateTo, setDateTo] = useState(() => isoToDateInputValue(defaultRange.createdBefore))
  const [rangeError, setRangeError] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [amazonSupportRequestId, setAmazonSupportRequestId] = useState('')
  const [payload, setPayload] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [forceCooldownAck, setForceCooldownAck] = useState(false)
  const [syncRequestedAt, setSyncRequestedAt] = useState('')

  const fetchSyncStatus = useCallback(async () => {
    try {
      const json = await api.get(`/api/amazon/sync/status?marketplaceKey=${encodeURIComponent(marketplaceKey)}`)
      if (json && json.success && json.data && json.data[marketplaceKey]) {
        setSyncStatus(json.data[marketplaceKey])
      } else {
        setSyncStatus(null)
      }
    } catch {
      setSyncStatus(null)
    }
  }, [marketplaceKey])

  const fetchOrdersWithIso = useCallback(
    async (createdAfter, createdBefore) => {
      setLoading(true)
      setError('')
      setRangeError('')
      setPayload(null)
      setAmazonSupportRequestId('')
      try {
        const qs = new URLSearchParams({
          marketplaceKey,
          createdAfter,
          createdBefore,
          limit: '200',
          offset: '0',
          includeSkuImages: '0',
        })
        const json = await api.get(`/api/amazon/orders?${qs.toString()}`)
        if (!json || json.success !== true || !json.data) {
          setError(typeof json?.message === 'string' ? json.message : 'Unexpected response')
          return
        }
        setPayload(json.data)
      } catch (e) {
        setError(safeErrorMessage(e))
        setAmazonSupportRequestId(amazonRequestIdFromClientBody(e.body) || '')
      } finally {
        setLoading(false)
      }
    },
    [marketplaceKey],
  )

  const fetchOrders = useCallback(async () => {
    const range = buildRangeFromDateInputs(dateFrom, dateTo)
    if ('error' in range) {
      setRangeError(range.error)
      setPayload(null)
      return
    }
    await fetchOrdersWithIso(range.createdAfter, range.createdBefore)
  }, [dateFrom, dateTo, fetchOrdersWithIso])

  const refreshAll = useCallback(async () => {
    await fetchOrders()
    await fetchSyncStatus()
  }, [fetchOrders, fetchSyncStatus])

  useEffect(() => {
    const d = getDefaultDateRangeIso()
    const from = isoToDateInputValue(d.createdAfter)
    const to = isoToDateInputValue(d.createdBefore)
    setDateFrom(from)
    setDateTo(to)
    setRangeError('')
    void fetchOrdersWithIso(d.createdAfter, d.createdBefore)
    void fetchSyncStatus()
  }, [marketplaceKey, fetchOrdersWithIso, fetchSyncStatus])

  useEffect(() => {
    setForceCooldownAck(false)
  }, [marketplaceKey, dateFrom, dateTo])

  useEffect(() => {
    if (!syncing) return undefined
    const timer = window.setInterval(async () => {
      try {
        const json = await api.get(`/api/amazon/sync/status?marketplaceKey=${encodeURIComponent(marketplaceKey)}`)
        const nextStatus = json?.data?.[marketplaceKey] || null
        setSyncStatus(nextStatus)
        const status = nextStatus?.lastSync?.status
        const startedAt = nextStatus?.lastSync?.startedAt
        const isCurrentRequest =
          !syncRequestedAt ||
          (startedAt && new Date(startedAt).getTime() >= new Date(syncRequestedAt).getTime() - 1000)
        if (!isCurrentRequest) return
        if (status && status !== 'running') {
          setSyncing(false)
          if (status === 'success') {
            setSyncMessage('Sync finished. Cache refreshed.')
            await fetchOrders()
          } else if (status === 'skipped') {
            setSyncMessage(nextStatus?.lastSync?.errorMessage || 'Sync skipped.')
          } else if (status === 'failed') {
            setError(nextStatus?.lastSync?.errorMessage || 'Amazon sync failed.')
          }
        }
      } catch {
        /* keep existing cached rows visible; next interval can recover */
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [syncing, marketplaceKey, syncRequestedAt, fetchOrders])

  const runAmazonOrdersSync = useCallback(
    async (useForce) => {
      if (!canSync) return
      if (useForce && (!isAdmin || !forceCooldownAck)) return
      const range = buildRangeFromDateInputs(dateFrom, dateTo)
      if ('error' in range) {
        setRangeError(range.error)
        return
      }
      setSyncing(true)
      setSyncRequestedAt(new Date().toISOString())
      setSyncMessage('')
      setError('')
      setRangeError('')
      setAmazonSupportRequestId('')
      try {
        const body = {
          marketplaceKey,
          createdAfter: range.createdAfter,
          createdBefore: range.createdBefore,
          includeItems: true,
          ...(useForce ? { force: true } : {}),
        }
        const json = await api.post('/api/amazon/orders/sync', body)
        const summary = json?.data
        const isBackground = Boolean(summary?.background)
        if (summary && typeof summary.message === 'string') {
          setSyncMessage(summary.message)
        } else if (isBackground) {
          setSyncMessage('Sync started in the background.')
        } else {
          setSyncMessage('Sync finished.')
        }
        const ref = summary?.amazonSupportRef
        if (ref && typeof ref.amazonRequestId === 'string' && ref.amazonRequestId.trim()) {
          setAmazonSupportRequestId(ref.amazonRequestId.trim().slice(0, 128))
        } else {
          setAmazonSupportRequestId('')
        }
        if (useForce) setForceCooldownAck(false)
        if (!isBackground) await fetchOrders()
        await fetchSyncStatus()
      } catch (e) {
        setError(safeErrorMessage(e))
        setAmazonSupportRequestId(amazonRequestIdFromClientBody(e.body) || '')
      } finally {
        setSyncing(false)
      }
    },
    [canSync, isAdmin, forceCooldownAck, marketplaceKey, dateFrom, dateTo, fetchOrders, fetchSyncStatus],
  )

  const syncFromAmazon = useCallback(() => void runAmazonOrdersSync(false), [runAmazonOrdersSync])

  const forceSyncFromAmazon = useCallback(() => void runAmazonOrdersSync(true), [runAmazonOrdersSync])

  const orders = Array.isArray(payload?.orders) ? payload.orders : []
  const stats = useMemo(() => aggregateOrders(orders), [orders])

  const marketplaceLabel =
    marketplaceKey === 'ksa' ? 'KSA / Amazon.sa' : 'UAE / Amazon.ae'

  const lastSync = syncStatus?.lastSync
  const lastOk = syncStatus?.lastSuccess
  const sourceLabel = payload?.source === 'cache' ? 'Cache' : payload?.source || '—'

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-transparent to-cyan-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300/90">Amazon Selling Partner API</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Amazon Orders
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Orders are loaded from <strong className="text-slate-300">local cache</strong>. Pick a date range (max 7
          days, same limit as live sync). Use <span className="font-semibold text-slate-300">Sync from Amazon</span>{' '}
          to refresh safely — the backend applies rate limits and cooldowns so we do not hammer Amazon live. Only
          non-sensitive fields are shown.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <h2 className="text-lg font-bold text-white">Marketplace &amp; cache</h2>
        <p className="mt-1 text-sm text-slate-500">
          Data source: <span className="text-slate-300">{sourceLabel}</span>
          {payload?.lastSyncedAt ? (
            <>
              {' '}
              · Last row sync:{' '}
              <span className="font-mono text-xs text-slate-400">{formatSyncTime(payload.lastSyncedAt)}</span>
            </>
          ) : null}
        </p>

        {lastSync ? (
          <p className="mt-2 text-xs text-slate-500">
            Last sync job:{' '}
            <span className="text-slate-300">{lastSync.status}</span>
            {lastSync.finishedAt ? (
              <>
                {' '}
                · finished{' '}
                <span className="font-mono text-slate-400">{formatSyncTime(lastSync.finishedAt)}</span>
              </>
            ) : null}
            {lastOk?.finishedAt ? (
              <>
                {' '}
                · last success{' '}
                <span className="font-mono text-slate-400">{formatSyncTime(lastOk.finishedAt)}</span>
              </>
            ) : null}
          </p>
        ) : null}

        {syncMessage ? (
          <div
            className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            role="status"
          >
            {syncMessage}
            <AmazonRequestIdNote requestId={amazonSupportRequestId} className="text-amber-200/70" />
          </div>
        ) : null}

        {rangeError ? (
          <div
            className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
            role="alert"
          >
            {rangeError}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex min-w-[14rem] flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace</span>
            <select
              value={marketplaceKey}
              onChange={(e) => setMarketplaceKey(e.target.value)}
              disabled={loading || syncing}
              className="rounded-xl border border-white/10 bg-slate-950/80 px-4 py-2.5 text-sm font-medium text-white outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            >
              {MARKETPLACES.map((m) => (
                <option key={m.key} value={m.marketplaceKey}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[11rem] flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">From (local)</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setRangeError('')
              }}
              disabled={loading || syncing}
              className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            />
          </label>
          <label className="flex min-w-[11rem] flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">To (local)</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setRangeError('')
              }}
              disabled={loading || syncing}
              className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none ring-sky-500/40 focus:ring-2 disabled:opacity-50"
            />
          </label>
          <p className="max-w-xs text-[11px] leading-snug text-slate-500 sm:max-w-[10rem] sm:self-end">
            Cache and sync use the same window. Span cannot exceed 7 days.
          </p>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading || syncing}
            className="rounded-xl bg-slate-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Reload from cache'}
          </button>
          {canSync ? (
            <button
              type="button"
              onClick={() => void syncFromAmazon()}
              disabled={loading || syncing}
              className="rounded-xl bg-sky-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/20 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync from Amazon'}
            </button>
          ) : (
            <p className="text-xs text-slate-500 sm:self-end">Sync requires admin or warehouse role.</p>
          )}
        </div>

        {canSync && isAdmin ? (
          <div
            className="mt-4 max-w-2xl rounded-2xl border border-amber-500/25 bg-amber-950/25 px-4 py-3 text-sm text-amber-50/95"
            role="region"
            aria-label="Admin force sync"
          >
            <p className="font-semibold text-amber-100">Force sync (admin)</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/85">
              Use only for testing or urgent refresh. Normal sync cooldown protects Amazon API limits.
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-amber-50/90">
              <input
                type="checkbox"
                checked={forceCooldownAck}
                onChange={(e) => setForceCooldownAck(e.target.checked)}
                disabled={syncing}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400/50 bg-slate-950 text-amber-500 focus:ring-amber-500/40 disabled:opacity-50"
              />
              <span>I understand this bypasses the cooldown</span>
            </label>
            <button
              type="button"
              onClick={() => void forceSyncFromAmazon()}
              disabled={loading || syncing || !forceCooldownAck}
              className="mt-3 rounded-xl border border-amber-500/40 bg-amber-600/25 px-4 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-600/35 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {syncing ? 'Syncing…' : 'Force sync (admin)'}
            </button>
          </div>
        ) : null}

        {loading || syncing ? (
          <p className="mt-6 text-sm text-slate-400" aria-live="polite">
            {syncing ? 'Running guarded Amazon sync on the server…' : 'Loading cached orders…'}
          </p>
        ) : null}

        {error ? (
          <div
            className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            role="alert"
          >
            <p className="font-semibold">Request failed</p>
            <p className="mt-1 text-rose-100/90">{error}</p>
            <AmazonRequestIdNote requestId={amazonSupportRequestId} className="text-rose-200/60" />
          </div>
        ) : null}

        {!loading && payload ? (
          <>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <SummaryCard label="Marketplace" value={marketplaceLabel} sub={payload.marketplaceId || undefined} />
              <SummaryCard
                label="Order count"
                value={`${orders.length}${typeof payload.orderCount === 'number' && payload.orderCount !== orders.length ? ` / ${payload.orderCount}` : ''}`}
                sub="Rows in this page / total in date range"
              />
              <SummaryCard
                label="Total order value"
                value={
                  stats.totalValue != null && stats.currency !== 'Mixed' && stats.currency !== '—'
                    ? formatMoney(stats.totalValue, stats.currency)
                    : stats.currency === 'Mixed'
                      ? 'Multiple currencies'
                      : '—'
                }
                sub={stats.currency !== '—' && stats.currency !== 'Mixed' ? `Page totals in ${stats.currency}` : undefined}
              />
              <SummaryCard label="Currency" value={stats.currency} />
              <SummaryCard label="Shipped count" value={String(stats.shippedItems)} sub="Sum of NumberOfItemsShipped" />
              <SummaryCard label="Pending count" value={String(stats.pendingItems)} sub="Sum of NumberOfItemsUnshipped" />
            </div>

            <div className="mt-10 overflow-x-auto rounded-2xl border border-white/10">
              <p className="border-b border-white/5 px-4 py-2 text-[11px] text-slate-500">
                Images use cached catalog data (same pipeline as BI dashboard; batched, rate-limited).
              </p>
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">Amazon order ID</th>
                    <th className="whitespace-nowrap px-4 py-3">SKU</th>
                    <th className="whitespace-nowrap px-4 py-3">Purchase date</th>
                    <th className="whitespace-nowrap px-4 py-3">Order status</th>
                    <th className="whitespace-nowrap px-4 py-3">Fulfillment</th>
                    <th className="whitespace-nowrap px-4 py-3">Sales channel</th>
                    <th className="whitespace-nowrap px-4 py-3">Order total</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Shipped</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Unshipped</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                        No cached orders in this window. Use Sync from Amazon (if permitted) to populate the cache.
                      </td>
                    </tr>
                  ) : (
                    orders.map((row, idx) => {
                      const id = row.AmazonOrderId != null ? String(row.AmazonOrderId) : `row-${idx}`
                      const ot = row.OrderTotal
                      const totalCell =
                        ot && typeof ot === 'object' && ot.Amount != null && ot.CurrencyCode
                          ? `${ot.Amount} ${ot.CurrencyCode}`
                          : '—'
                      return (
                        <tr key={id} className="border-t border-white/5">
                          <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{id}</td>
                          <td className="px-4 py-2.5 align-top">
                            <SkuCell row={row} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">
                            {formatPurchaseDate(row.PurchaseDate)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">{row.OrderStatus != null ? String(row.OrderStatus) : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            {row.FulfillmentChannel != null ? String(row.FulfillmentChannel) : '—'}
                          </td>
                          <td className="max-w-[12rem] truncate px-4 py-2.5" title={row.SalesChannel != null ? String(row.SalesChannel) : ''}>
                            {row.SalesChannel != null ? String(row.SalesChannel) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{totalCell}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                            {row.NumberOfItemsShipped != null ? String(row.NumberOfItemsShipped) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                            {row.NumberOfItemsUnshipped != null ? String(row.NumberOfItemsUnshipped) : '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

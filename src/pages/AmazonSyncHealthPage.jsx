import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

function formatShortIso(iso) {
  if (!iso) return '—'
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function StatCard({ title, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-slate-200">{children}</div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[min(100%,20rem)] text-right font-medium text-white">{value}</span>
    </div>
  )
}

function cooldownLabel(untilIso) {
  if (!untilIso) return 'No manual-sync cooldown (or window elapsed).'
  const end = new Date(untilIso).getTime()
  if (Number.isNaN(end)) return '—'
  const ms = end - Date.now()
  if (ms <= 0) return 'Cooldown cleared — next manual sync allowed.'
  const m = Math.ceil(ms / 60_000)
  return `Manual sync cooldown until ${formatShortIso(untilIso)} (~${m} min).`
}

/**
 * Admin-only Amazon sync & rate-limit audit (reads backend cache/logs only; no live Amazon).
 */
export function AmazonSyncHealthPage() {
  const [marketplaces, setMarketplaces] = useState([])
  const [rateSummary, setRateSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const healthRes = await api.get('/api/amazon/sync/health')
      if (!healthRes.data?.success) {
        setError(healthRes.data?.error || healthRes.data?.message || 'Failed to load sync health')
        setMarketplaces([])
        setRateSummary(null)
        return
      }
      setMarketplaces(healthRes.data.data?.marketplaces || [])

      let summary = null
      try {
        const rateRes = await api.get('/api/amazon/rate-limits')
        if (rateRes.data?.success) summary = rateRes.data.data?.summary || null
      } catch {
        summary = null
      }
      setRateSummary(summary)
    } catch (e) {
      const status = e.response?.status
      const msg =
        e.response?.data?.error ||
        e.response?.data?.message ||
        (status === 403 ? 'Admin access required.' : e.message || 'Request failed')
      setError(msg)
      setMarketplaces([])
      setRateSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const mergedSyncs = useMemo(() => {
    const rows = []
    for (const m of marketplaces) {
      const mk = m.marketplaceKey
      for (const s of m.recentSyncs || []) {
        rows.push({ marketplaceKey: mk, ...s })
      }
    }
    return rows
      .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))
      .slice(0, 40)
  }, [marketplaces])

  const mergedApiCalls = useMemo(() => {
    const rows = []
    for (const m of marketplaces) {
      const mk = m.marketplaceKey
      for (const c of m.recentApiCalls || []) {
        rows.push({ marketplaceKey: mk, ...c })
      }
    }
    return rows
      .sort((a, b) => new Date(b.calledAt || 0) - new Date(a.calledAt || 0))
      .slice(0, 60)
  }, [marketplaces])

  const mkCard = (key) => marketplaces.find((m) => m.marketplaceKey === key)

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-amber-600/10 via-transparent to-slate-900/40 p-6 backdrop-blur-xl">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200/80">Admin</p>
          <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Amazon sync health
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Cached sync logs and API audit trail from the backend. No live Amazon calls and no secrets or buyer PII.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      {rateSummary ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300 backdrop-blur-md">
          <span className="font-semibold text-slate-200">Global (24h): </span>
          {rateSummary.callsLast24hTotal ?? 0} API log rows ·{' '}
          <span className="text-amber-200/90">{rateSummary.throttle429Last24h ?? 0}</span> throttle (429)
          {rateSummary.throttle429Last24hByMarketplace ? (
            <>
              {' '}
              (UAE {rateSummary.throttle429Last24hByMarketplace.uae ?? 0}, KSA{' '}
              {rateSummary.throttle429Last24hByMarketplace.ksa ?? 0})
            </>
          ) : null}
          {rateSummary.lastRateLimitHeaderObserved ? (
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
              Last observed rate-limit header: {String(rateSummary.lastRateLimitHeaderObserved).slice(0, 200)}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {['uae', 'ksa'].map((key) => {
          const m = mkCard(key)
          const label = key === 'uae' ? 'UAE (Amazon.ae)' : 'KSA (Amazon.sa)'
          if (!m) {
            return (
              <StatCard key={key} title={label}>
                <p className="text-slate-500">No data</p>
              </StatCard>
            )
          }
          return (
            <StatCard key={key} title={label}>
              <Row label="Last status" value={m.lastStatus || '—'} />
              <Row label="Last success" value={formatShortIso(m.lastSuccessfulSyncAt)} />
              <Row label="Last failure" value={formatShortIso(m.lastFailedSyncAt)} />
              <Row label="429 (24h, this MP)" value={String(m.recent429Count ?? 0)} />
              <Row label="Cooldown" value={cooldownLabel(m.cooldownUntil)} />
              <Row
                label="Last Amazon Request ID"
                value={
                  m.lastAmazonRequestId ? (
                    <span className="break-all font-mono text-[11px] text-cyan-200/90">{m.lastAmazonRequestId}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <Row
                label="Last error"
                value={
                  m.lastSafeError ? (
                    <span className="whitespace-pre-wrap break-words text-rose-200/90">{m.lastSafeError}</span>
                  ) : (
                    '—'
                  )
                }
              />
            </StatCard>
          )
        })}
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <h2 className="text-lg font-bold text-white">Recent sync runs</h2>
        <p className="text-sm text-slate-500">Newest first (UAE + KSA).</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="pb-2 pr-3">MP</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Started</th>
                <th className="pb-2 pr-3">Finished</th>
                <th className="pb-2 pr-3">Window</th>
                <th className="pb-2 pr-3 text-right">Orders</th>
                <th className="pb-2 pr-3 text-right">Items</th>
                <th className="pb-2 pr-3 text-right">API</th>
                <th className="pb-2 pr-3">Request IDs</th>
                <th className="pb-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {mergedSyncs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-slate-500">
                    {loading ? 'Loading…' : 'No sync history yet.'}
                  </td>
                </tr>
              ) : (
                mergedSyncs.map((s, idx) => (
                  <tr key={`${s.marketplaceKey}-${s.startedAt}-${idx}`} className="border-t border-white/[0.06] align-top">
                    <td className="py-2 pr-3 font-medium uppercase text-slate-400">{s.marketplaceKey}</td>
                    <td className="py-2 pr-3">{s.syncType || '—'}</td>
                    <td className="py-2 pr-3">{s.status || '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{formatShortIso(s.startedAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{formatShortIso(s.finishedAt)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">
                      <div>{formatShortIso(s.createdAfter)}</div>
                      <div>→ {formatShortIso(s.createdBefore)}</div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.ordersFetched ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.orderItemsFetched ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.apiCallsMade ?? '—'}</td>
                    <td className="max-w-[12rem] py-2 pr-3 font-mono text-[10px] text-slate-400">
                      {Array.isArray(s.amazonRequestIds) && s.amazonRequestIds.length
                        ? s.amazonRequestIds.join(', ')
                        : '—'}
                    </td>
                    <td className="max-w-[14rem] py-2 text-xs text-rose-200/80">{s.error || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <h2 className="text-lg font-bold text-white">Recent API calls</h2>
        <p className="text-sm text-slate-500">Logged SP-API operations (newest first).</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-widest text-slate-500">
              <tr>
                <th className="pb-2 pr-3">MP</th>
                <th className="pb-2 pr-3">Operation</th>
                <th className="pb-2 pr-3">When</th>
                <th className="pb-2 pr-3">HTTP</th>
                <th className="pb-2 pr-3">OK</th>
                <th className="pb-2 pr-3">Amazon Request ID</th>
                <th className="pb-2 pr-3">Rate-limit header</th>
                <th className="pb-2">Safe error</th>
              </tr>
            </thead>
            <tbody>
              {mergedApiCalls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    {loading ? 'Loading…' : 'No API calls logged yet.'}
                  </td>
                </tr>
              ) : (
                mergedApiCalls.map((c, idx) => (
                  <tr key={`${c.marketplaceKey}-${c.calledAt}-${idx}`} className="border-t border-white/[0.06] align-top">
                    <td className="py-2 pr-3 font-medium uppercase text-slate-400">{c.marketplaceKey}</td>
                    <td className="py-2 pr-3">{c.operation || '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{formatShortIso(c.calledAt)}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.statusCode ?? '—'}</td>
                    <td className="py-2 pr-3">{c.success ? 'yes' : 'no'}</td>
                    <td className="max-w-[10rem] py-2 pr-3 break-all font-mono text-[10px] text-cyan-200/80">
                      {c.amazonRequestId || '—'}
                    </td>
                    <td className="max-w-[14rem] py-2 pr-3 break-all font-mono text-[10px] text-slate-500">
                      {c.rateLimitHeader ? String(c.rateLimitHeader).slice(0, 160) : '—'}
                    </td>
                    <td className="max-w-[12rem] py-2 text-xs text-rose-200/80">{c.safeError || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

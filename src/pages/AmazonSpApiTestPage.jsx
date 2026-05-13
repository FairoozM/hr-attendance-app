import { useState, useCallback } from 'react'
import { api } from '../api/client'

function safeErrorMessage(err) {
  if (err?.body && typeof err.body === 'object') {
    if (typeof err.body.error === 'string' && err.body.error.trim()) return err.body.error.trim()
    if (typeof err.body.message === 'string' && err.body.message.trim()) return err.body.message.trim()
  }
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim()
  return 'Request failed'
}

/**
 * GET /api/amazon/marketplaces — manual test UI (no secrets or tokens shown).
 */
export function AmazonSpApiTestPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [marketplaceCount, setMarketplaceCount] = useState(null)
  const [marketplaceIds, setMarketplaceIds] = useState([])
  const [rows, setRows] = useState([])

  const runTest = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    setMarketplaceCount(null)
    setMarketplaceIds([])
    setRows([])
    try {
      const json = await api.get('/api/amazon/marketplaces')
      if (!json || json.success !== true || !json.data) {
        setError(typeof json?.message === 'string' ? json.message : 'Unexpected response')
        return
      }
      const { marketplaceCount: count, marketplaceIds: ids, raw } = json.data
      setMarketplaceCount(typeof count === 'number' ? count : 0)
      setMarketplaceIds(Array.isArray(ids) ? ids : [])
      setSuccessMsg('SUCCESS: Amazon marketplaces fetched')
      const payload = raw && Array.isArray(raw.payload) ? raw.payload : []
      setRows(
        payload.map((p) => {
          const m = p?.marketplace || {}
          return {
            id: typeof m.id === 'string' ? m.id : '—',
            name: m.name != null && String(m.name).trim() ? String(m.name).trim() : '—',
            country: m.countryCode != null ? String(m.countryCode) : '—',
            currency: m.defaultCurrencyCode != null ? String(m.defaultCurrencyCode) : '—',
          }
        })
      )
    } catch (e) {
      setError(safeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/10 via-transparent to-emerald-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300/90">Amazon Selling Partner API</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Amazon SP-API Test
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Calls the backend <span className="font-mono text-slate-300">GET /api/amazon/marketplaces</span> using your
          saved session. Use this to verify sandbox LWA and marketplace participation data.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
        <h2 className="text-lg font-bold text-white">Marketplace participations</h2>
        <p className="mt-1 text-sm text-slate-500">Requires sign-in. No tokens or secrets are displayed.</p>
        <div className="mt-6">
          <button
            type="button"
            onClick={runTest}
            disabled={loading}
            className="rounded-xl bg-emerald-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Test Amazon Marketplaces'}
          </button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-slate-400" aria-live="polite">
            Calling the server…
          </p>
        ) : null}

        {error ? (
          <div
            className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            role="alert"
          >
            <p className="font-semibold">Failed</p>
            <p className="mt-1 text-rose-100/90">{error}</p>
          </div>
        ) : null}

        {!loading && successMsg ? (
          <div
            className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
            role="status"
          >
            <p className="font-semibold">Success</p>
            <p className="mt-1 text-emerald-100/90">{successMsg}</p>
            <p className="mt-3 text-xs uppercase tracking-wider text-emerald-200/80">HTTP status</p>
            <p className="font-mono text-emerald-50">200</p>
            <p className="mt-3 text-xs uppercase tracking-wider text-emerald-200/80">Marketplace count</p>
            <p className="font-mono text-emerald-50">{marketplaceCount ?? 0}</p>
            <p className="mt-3 text-xs uppercase tracking-wider text-emerald-200/80">Marketplace IDs</p>
            <p className="font-mono text-sm text-emerald-50 break-all">
              {marketplaceIds.length ? marketplaceIds.join(', ') : '—'}
            </p>
          </div>
        ) : null}

        {!loading && rows.length > 0 ? (
          <div className="mt-8 overflow-x-auto">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">From API payload</h3>
            <table className="min-w-full text-left text-sm text-slate-200">
              <thead className="text-xs uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="pb-2 pr-4">Marketplace ID</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Country</th>
                  <th className="pb-2">Currency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-t border-white/5">
                    <td className="py-2 pr-4 font-mono text-xs">{row.id}</td>
                    <td className="py-2 pr-4">{row.name}</td>
                    <td className="py-2 pr-4">{row.country}</td>
                    <td className="py-2">{row.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}

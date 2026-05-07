import { useCallback, useEffect, useState } from 'react'
import { aiAxios } from '../api/axiosAi'
import { AiStatsCards } from '../components/ai/AiStatsCards'
import { BudgetStatusCard } from '../components/ai/BudgetStatusCard'
import { UsageTrendChart } from '../components/ai/UsageTrendChart'
import { TokenUsageChart } from '../components/ai/TokenUsageChart'
import { AiUsageTable } from '../components/ai/AiUsageTable'

export function AiUsageDashboard() {
  const [summary, setSummary] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [sRes, rRes] = await Promise.all([
        aiAxios.get('/api/ai/usage/summary'),
        aiAxios.get('/api/ai/usage/recent?limit=50'),
      ])
      setSummary(sRes.data)
      setRecent(rRes.data.items || [])
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load AI analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/10 via-transparent to-cyan-600/10 p-6 backdrop-blur-xl">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300/90">AI operations</p>
          <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Usage &amp; spend intelligence
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            OpenAI runs only on the Node backend. Costs and tokens are attributed per user for Life Smile HR &amp; BI.
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

      {summary ? (
        <>
          <BudgetStatusCard summary={summary} />
          <AiStatsCards summary={summary} />
          <div className="grid gap-6 lg:grid-cols-2">
            <UsageTrendChart trend={summary.usageTrend} />
            <TokenUsageChart trend={summary.usageTrend} />
          </div>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
            <h2 className="text-lg font-bold text-white">Models this month</h2>
            <p className="text-sm text-slate-500">Successful requests only.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4">Model</th>
                    <th className="pb-2 pr-4">Requests</th>
                    <th className="pb-2 pr-4">Tokens</th>
                    <th className="pb-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.modelUsageMonth || []).map((row) => (
                    <tr key={row.model} className="border-t border-white/5">
                      <td className="py-2 pr-4 font-mono text-xs">{row.model}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.requests}</td>
                      <td className="py-2 pr-4 tabular-nums">{Number(row.tokens).toLocaleString()}</td>
                      <td className="py-2 tabular-nums">
                        {Number(row.cost_usd).toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 4,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!summary.modelUsageMonth?.length ? (
                <p className="mt-3 text-sm text-slate-500">No model usage recorded this month.</p>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">Request history</h2>
                <p className="text-sm text-slate-500">Includes failures and budget blocks for audit.</p>
              </div>
            </div>
            <AiUsageTable items={recent} />
          </section>
        </>
      ) : (
        !error && <p className="text-slate-500">{loading ? 'Loading dashboard…' : 'No data.'}</p>
      )}
    </div>
  )
}

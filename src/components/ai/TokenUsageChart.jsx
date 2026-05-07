import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-xl">
      <div className="font-semibold text-slate-300">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="tabular-nums">
          {p.name}: {Number(p.value || 0).toLocaleString()}
        </div>
      ))}
    </div>
  )
}

export function TokenUsageChart({ trend }) {
  const data = (trend || []).map((row) => ({
    label: String(row.day).slice(0, 10),
    tokens: Number(row.tokens) || 0,
  }))

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-slate-500">
        No token usage recorded for this window.
      </div>
    )
  }

  return (
    <div className="h-72 w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-slate-400">Token volume / day</h3>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="tokens" name="Tokens" fill="#22d3ee" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

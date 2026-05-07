import {
  Area,
  AreaChart,
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
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
        </div>
      ))}
    </div>
  )
}

export function UsageTrendChart({ trend }) {
  const data = (trend || []).map((row) => ({
    day: row.day,
    label: String(row.day).slice(0, 10),
    cost_usd: Number(row.cost_usd) || 0,
  }))

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-slate-500">
        No spend in the selected window yet.
      </div>
    )
  }

  return (
    <div className="h-72 w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-slate-400">Usage trend (cost / day)</h3>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="aiCostGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Area
            type="monotone"
            dataKey="cost_usd"
            name="USD"
            stroke="#a78bfa"
            fill="url(#aiCostGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

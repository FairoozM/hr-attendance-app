function fmtUsd(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(n) || 0)
}

function pill(status) {
  const s = String(status || '')
  if (s === 'success') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25'
  if (s.startsWith('blocked')) return 'bg-amber-500/15 text-amber-200 ring-amber-500/25'
  return 'bg-rose-500/15 text-rose-200 ring-rose-500/25'
}

export function AiUsageTable({ items }) {
  if (!items?.length) {
    return <p className="text-sm text-slate-500">No AI requests logged yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-xs text-slate-200">
        <thead className="border-b border-white/10 bg-white/[0.03] text-[0.65rem] font-bold uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Module</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2">Tokens</th>
            <th className="px-3 py-2">Cost</th>
            <th className="px-3 py-2">Ms</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
              <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2">{row.user_username || row.user_id || '—'}</td>
              <td className="px-3 py-2">{row.module_name}</td>
              <td className="px-3 py-2">{row.action_name}</td>
              <td className="max-w-[140px] truncate px-3 py-2 font-mono text-[0.7rem]">{row.model}</td>
              <td className="px-3 py-2 tabular-nums">{Number(row.total_tokens).toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums">{fmtUsd(row.estimated_cost_usd)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-400">
                {row.request_duration_ms != null ? row.request_duration_ms : '—'}
              </td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase ring-1 ${pill(row.request_status)}`}>
                  {row.request_status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

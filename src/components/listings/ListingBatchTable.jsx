function StatusBadge({ status }) {
  const tone =
    status === 'Validation Error' || status === 'Failed'
      ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
      : status === 'Approved' || status === 'Exported'
        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
        : status === 'Needs Review'
          ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
          : 'border-sky-400/40 bg-sky-500/10 text-sky-100'
  return <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${tone}`}>{status}</span>
}

export function ListingBatchTable({ rows = [], selected = [], onSelect, onSelectAll, onOpenRow }) {
  const selectedSet = new Set(selected)
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
            <tr>
              <th className="px-4 py-3">
                <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selectedSet.has(r.id))} onChange={(e) => onSelectAll(e.target.checked)} />
              </th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Product Name / Item Name</th>
              <th className="px-4 py-3">Quality</th>
              <th className="px-4 py-3">Warnings</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => {
              const warnings = row.validation?.warnings?.length || 0
              const errors = row.validation?.errors?.length || 0
              return (
                <tr key={row.id} className="text-slate-200 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedSet.has(row.id)} onChange={(e) => onSelect(row.id, e.target.checked)} />
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-3 font-mono text-xs">{row.sku}</td>
                  <td className="max-w-xl px-4 py-3">{row.current_values?.item_name || row.item_name || '-'}</td>
                  <td className="px-4 py-3">{row.quality?.score != null ? `${row.quality.score}/100` : '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    {errors ? <span className="text-rose-300">{errors} errors </span> : null}
                    {warnings ? <span className="text-amber-300">{warnings} warnings</span> : errors ? null : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onOpenRow(row)} className="rounded-lg px-3 py-1 text-xs font-bold text-violet-200 ring-1 ring-violet-400/30 hover:bg-violet-500/10">
                      Review
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-400">No rows found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

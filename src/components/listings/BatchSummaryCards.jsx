const LABELS = [
  ['imported_count', 'Total SKUs'],
  ['Ready', 'Ready'],
  ['Validation Error', 'Errors'],
  ['Generated', 'Generated'],
  ['Needs Review', 'Needs review'],
  ['Approved', 'Approved'],
  ['Exported', 'Exported'],
]

export function BatchSummaryCards({ batch }) {
  const counts = batch?.summary_counts || {}
  const valueFor = (key) => (key === 'imported_count' ? batch?.imported_count || 0 : counts[key] || 0)
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
      {LABELS.map(([key, label]) => (
        <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-bold text-white">{valueFor(key)}</p>
        </div>
      ))}
    </div>
  )
}

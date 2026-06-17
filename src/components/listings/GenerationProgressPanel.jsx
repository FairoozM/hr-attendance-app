export function GenerationProgressPanel({ job, onCancel }) {
  if (!job) return null
  const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0
  return (
    <div className="rounded-3xl border border-sky-400/30 bg-sky-500/10 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-sky-100">Generating {job.completed} / {job.total}</p>
          <p className="text-xs text-sky-100/70">Mode: {job.mode} {job.failed ? `- Failed: ${job.failed}` : ''}</p>
        </div>
        {job.running ? (
          <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2 text-xs font-bold text-sky-100 ring-1 ring-sky-300/40">
            Cancel
          </button>
        ) : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
        <div className="h-full bg-sky-300 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

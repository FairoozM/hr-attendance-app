import { useEffect, useMemo, useState } from 'react'

const TABS = ['Input', 'English Content', 'Arabic Content', 'Amazon Fields', 'Defaults Applied', 'AI Notes', 'History']

export function ListingRowDrawer({ row, columns = [], busy, onClose, onSave, onApprove, onRegenerate }) {
  const [tab, setTab] = useState('Input')
  const [values, setValues] = useState(row?.current_values || {})
  useEffect(() => {
    setValues(row?.current_values || {})
  }, [row?.id])
  const visibleColumns = useMemo(() => {
    if (tab === 'English Content') return columns.filter((c) => ['item_name', 'product_description', 'bullet_point_1', 'bullet_point_2', 'bullet_point_3', 'bullet_point_4', 'bullet_point_5', 'search_terms', 'generic_keywords'].includes(c.key))
    if (tab === 'Arabic Content') return columns.filter((c) => c.key.startsWith('arabic'))
    if (tab === 'Defaults Applied') return columns.filter((c) => row?.source_map?.[c.key] === 'Fixed Default')
    if (tab === 'AI Notes') return []
    return columns
  }, [columns, row, tab])

  if (!row) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <aside className="ml-auto h-full w-full max-w-3xl overflow-y-auto border-l border-white/10 bg-slate-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">{row.sku}</p>
            <h2 className="mt-1 text-2xl font-bold text-white">{values.item_name || row.item_name || 'Listing row'}</h2>
            <p className="mt-1 text-sm text-slate-400">Status: {row.status}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-slate-300 ring-1 ring-white/10">Close</button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs font-bold ${tab === t ? 'bg-violet-500 text-white' : 'bg-white/10 text-slate-300'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'AI Notes' ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
            <p>Quality score: {row.quality?.score ?? '-'}</p>
            <ul className="mt-2 list-disc pl-5">
              {(row.quality?.issues || []).map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            {row.last_error ? <p className="mt-3 text-rose-300">{row.last_error}</p> : null}
          </div>
        ) : tab === 'History' ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
            Detailed audit events are recorded in the backend. This row was last updated {row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {visibleColumns.map((col) => (
              <label key={col.key} className="block text-xs font-semibold text-slate-400">
                {col.label} <span className="font-normal text-slate-500">({row.source_map?.[col.key] || 'Empty'})</span>
                <textarea
                  rows={col.key.includes('description') ? 4 : 2}
                  value={values[col.key] || ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </label>
            ))}
          </div>
        )}
        <div className="sticky bottom-0 mt-6 flex flex-wrap gap-2 border-t border-white/10 bg-slate-950 py-4">
          <button type="button" disabled={busy} onClick={() => onSave(values)} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save</button>
          <button type="button" disabled={busy} onClick={onApprove} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Approve</button>
          <button type="button" disabled={busy} onClick={() => onRegenerate('')} className="rounded-xl px-4 py-2 text-sm font-bold text-violet-100 ring-1 ring-violet-400/40 disabled:opacity-50">Regenerate SKU</button>
          <button type="button" disabled={busy} onClick={() => onRegenerate('title')} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-50">Title only</button>
          <button type="button" disabled={busy} onClick={() => onRegenerate('bullets')} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-50">Bullets only</button>
          <button type="button" disabled={busy} onClick={() => onRegenerate('description')} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-50">Description only</button>
          <button type="button" disabled={busy} onClick={() => onRegenerate('arabic')} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-50">Arabic only</button>
        </div>
      </aside>
    </div>
  )
}

import { useState } from 'react'

export function DefaultProfileEditor({ columns = [], onCreate, busy }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [marketplace, setMarketplace] = useState('UAE')
  const [fields, setFields] = useState([])

  function addField() {
    const col = columns[0]
    if (!col) return
    setFields((prev) => [...prev, { column_key: col.key, column_label: col.label, default_value: '', apply_mode: 'fill_empty', enabled: true }])
  }

  function patch(index, update) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...update } : f)))
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl px-3 py-2 text-xs font-bold text-violet-200 ring-1 ring-violet-400/30">
        Save new default profile
      </button>
    )
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-white">Create default profile</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-400">Close</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" />
        <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white">
          <option value="UAE">UAE</option>
          <option value="KSA">KSA</option>
          <option value="">Custom</option>
        </select>
        <button type="button" onClick={addField} className="rounded-xl px-3 py-2 text-xs font-bold text-violet-200 ring-1 ring-violet-400/30">+ Field</button>
      </div>
      <div className="mt-3 space-y-2">
        {fields.map((field, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_12rem_5rem]">
            <select value={field.column_key} onChange={(e) => {
              const col = columns.find((c) => c.key === e.target.value)
              patch(index, { column_key: col?.key, column_label: col?.label })
            }} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white">
              {columns.map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}
            </select>
            <input value={field.default_value} onChange={(e) => patch(index, { default_value: e.target.value })} placeholder="Default value" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" />
            <select value={field.apply_mode} onChange={(e) => patch(index, { apply_mode: e.target.value })} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white">
              <option value="fill_empty">Fill empty only</option>
              <option value="overwrite_all">Overwrite all rows</option>
              <option value="ask_before_overwrite">Ask before overwrite</option>
              <option value="do_not_apply">Do not apply</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={field.enabled !== false} onChange={(e) => patch(index, { enabled: e.target.checked })} /> Enabled</label>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => onCreate({ name, marketplace, fields })}
        className="mt-4 rounded-xl bg-violet-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        Save profile
      </button>
    </section>
  )
}

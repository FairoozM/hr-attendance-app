import { useMemo, useState } from 'react'

export function BatchDefaultsRules({ batch, profiles = [], onApply, busy }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id || '')
  const [rules, setRules] = useState([])
  const columns = batch?.detected_columns || []
  const selectedProfile = profiles.find((p) => String(p.id) === String(profileId))
  const effectiveRules = useMemo(() => (rules.length ? rules : selectedProfile?.fields || []), [rules, selectedProfile])

  function addRule() {
    const col = columns[0]
    if (!col) return
    setRules((prev) => [...prev, { column_key: col.key, column_label: col.label, default_value: '', apply_mode: 'fill_empty', enabled: true }])
  }

  function patchRule(index, patch) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Batch Defaults & Rules</h2>
          <p className="text-sm text-slate-400">Default mode is fill empty only. Existing uploaded values stay protected.</p>
        </div>
        <button type="button" onClick={addRule} className="rounded-xl px-3 py-2 text-xs font-bold text-violet-200 ring-1 ring-violet-400/30">+ Add Default Field</button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[16rem_1fr_auto]">
        <select value={profileId} onChange={(e) => { setProfileId(e.target.value); setRules([]) }} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white">
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
        <p className="self-center text-xs text-slate-400">{effectiveRules.length} default fields ready to apply.</p>
        <button type="button" disabled={busy || effectiveRules.length === 0} onClick={() => onApply({ profileId, rules })} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Apply defaults
        </button>
      </div>
      {rules.length ? (
        <div className="mt-4 space-y-2">
          {rules.map((rule, index) => (
            <div key={index} className="grid gap-2 rounded-2xl border border-white/10 bg-black/15 p-3 md:grid-cols-[1fr_1fr_12rem_5rem]">
              <select value={rule.column_key} onChange={(e) => {
                const col = columns.find((c) => c.key === e.target.value)
                patchRule(index, { column_key: col?.key, column_label: col?.label })
              }} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
                {columns.map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}
              </select>
              <input value={rule.default_value} onChange={(e) => patchRule(index, { default_value: e.target.value })} placeholder="Default value" className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
              <select value={rule.apply_mode} onChange={(e) => patchRule(index, { apply_mode: e.target.value })} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
                <option value="fill_empty">Fill empty only</option>
                <option value="overwrite_all">Overwrite all rows</option>
                <option value="ask_before_overwrite">Ask before overwrite</option>
                <option value="do_not_apply">Do not apply</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={rule.enabled !== false} onChange={(e) => patchRule(index, { enabled: e.target.checked })} /> Enabled
              </label>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

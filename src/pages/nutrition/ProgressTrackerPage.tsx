import { useEffect, useState } from 'react'
import * as api from '../../api/nutritionCoach'

export function ProgressTrackerPage() {
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([])
  const [form, setForm] = useState({ weightKg: '', bodyFatPct: '', notes: '' })
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await api.fetchProgressLogs() as { logs?: Array<Record<string, unknown>> }
      setLogs(res.logs || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    await api.addProgressLog({
      weightKg: form.weightKg ? Number(form.weightKg) : null,
      bodyFatPct: form.bodyFatPct ? Number(form.bodyFatPct) : null,
      notes: form.notes,
    })
    setForm({ weightKg: '', bodyFatPct: '', notes: '' })
    await load()
  }

  return (
    <>
      <form className="nutrition-card" onSubmit={save}>
        <h3>Log progress</h3>
        <div className="nutrition-form-grid">
          <label>
            Weight (kg)
            <input type="number" step="0.1" value={form.weightKg}
              onChange={(e) => setForm({ ...form, weightKg: e.target.value })} />
          </label>
          <label>
            Body fat %
            <input type="number" step="0.1" value={form.bodyFatPct}
              onChange={(e) => setForm({ ...form, bodyFatPct: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button type="submit" className="nutrition-btn nutrition-btn--primary">Save progress</button>
      </form>

      {loading && <p>Loading…</p>}

      <div className="nutrition-table-wrap">
        <table className="nutrition-table">
          <thead>
            <tr><th>Date</th><th>Weight</th><th>Body fat</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={String(l.id)}>
                <td>{String(l.log_date)}</td>
                <td>{l.weight_kg != null ? `${l.weight_kg} kg` : '—'}</td>
                <td>{l.body_fat_pct != null ? `${l.body_fat_pct}%` : '—'}</td>
                <td>{String(l.notes || '')}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={4}>No progress logs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

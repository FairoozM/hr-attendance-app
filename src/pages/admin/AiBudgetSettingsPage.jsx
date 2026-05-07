import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import '../management/DocumentExpiryPage.css'

const DEFAULT_FORM = {
  daily_budget_usd: 50,
  monthly_budget_usd: 500,
  alert_threshold_percent: 80,
  default_model: 'gpt-4.1-mini',
  max_batch_size: 10,
  allow_ai_generation: true,
}

export function AiBudgetSettingsPage() {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/admin/ai/budget-settings')
      const s = res.settings
      if (s) {
        setForm({
          daily_budget_usd: s.daily_budget_usd,
          monthly_budget_usd: s.monthly_budget_usd,
          alert_threshold_percent: s.alert_threshold_percent,
          default_model: s.default_model,
          max_batch_size: s.max_batch_size,
          allow_ai_generation: s.allow_ai_generation,
        })
      }
    } catch (e) {
      setError(e.message || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await api.put('/api/admin/ai/budget-settings', form)
      setMessage('Settings saved.')
      await load()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="doc-expiry-page ai-page">
      <header className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">AI budget &amp; controls</h1>
          <p className="doc-page-subtitle">
            Daily and monthly caps apply before each OpenAI request (UTC). Set <code>OPENAI_API_KEY</code> only on
            the server — never in the browser.
          </p>
        </div>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          Reload
        </button>
      </header>

      {error ? <div className="ai-alert ai-alert--error">{error}</div> : null}
      {message ? <div className="ai-alert">{message}</div> : null}

      {loading ? (
        <p className="doc-page-subtitle">Loading…</p>
      ) : (
        <section className="ai-panel">
          <div className="ai-panel__head">
            <h2>Budget &amp; model defaults</h2>
          </div>
          <div className="ai-form-grid">
            <label>
              Daily budget (USD)
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.daily_budget_usd}
                onChange={(e) => setForm((f) => ({ ...f, daily_budget_usd: Number(e.target.value) }))}
              />
            </label>
            <label>
              Monthly budget (USD)
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.monthly_budget_usd}
                onChange={(e) => setForm((f) => ({ ...f, monthly_budget_usd: Number(e.target.value) }))}
              />
            </label>
            <label>
              Alert threshold (% of cap)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.alert_threshold_percent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, alert_threshold_percent: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Default model
              <input
                type="text"
                value={form.default_model}
                onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
              />
            </label>
            <label>
              Max batch size (Amazon listing)
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={form.max_batch_size}
                onChange={(e) => setForm((f) => ({ ...f, max_batch_size: Number(e.target.value) }))}
              />
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={form.allow_ai_generation}
                onChange={(e) => setForm((f) => ({ ...f, allow_ai_generation: e.target.checked }))}
              />
              Allow AI generation
            </label>
          </div>
          <div className="ai-actions">
            <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import * as api from '../../api/nutritionCoach'
import { GOALS, DIETARY_PREFERENCES, ACTIVITY_LEVELS } from '../../components/nutrition/nutritionConstants'

export function NutritionSettingsPage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'nutrition_fitness', 'manage')
  const { profile, saveProfile } = useNutritionCoach()
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [targets, setTargets] = useState<Array<Record<string, unknown>>>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({
        age: profile.age,
        gender: profile.gender,
        heightCm: profile.height_cm,
        weightKg: profile.weight_kg,
        targetWeightKg: profile.target_weight_kg,
        activityLevel: profile.activity_level,
        goal: profile.goal,
        dietaryPreference: profile.dietary_preference,
        allergies: profile.allergies,
        dislikedFoods: profile.disliked_foods,
        medicalCautionFlags: profile.medical_caution_flags || {},
      })
    }
  }, [profile])

  useEffect(() => {
    api.fetchNutrientTargets().then((res) => {
      setTargets((res as { targets?: Array<Record<string, unknown>> }).targets || [])
    })
  }, [])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await saveProfile(form)
    } finally {
      setSaving(false)
    }
  }

  async function updateTarget(key: string, defaultTarget: string) {
    if (!canManage) return
    await api.updateNutrientTarget(key, { default_target: Number(defaultTarget) })
    const res = await api.fetchNutrientTargets()
    setTargets((res as { targets?: Array<Record<string, unknown>> }).targets || [])
  }

  return (
    <>
      <form className="nutrition-card" onSubmit={handleSaveProfile}>
        <h3>Your profile</h3>
        <div className="nutrition-form-grid">
          <label>Age<input type="number" value={String(form.age ?? '')} onChange={(e) => setForm({ ...form, age: Number(e.target.value) })} /></label>
          <label>Gender<select value={String(form.gender ?? '')} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select></label>
          <label>Height (cm)<input type="number" value={String(form.heightCm ?? '')} onChange={(e) => setForm({ ...form, heightCm: Number(e.target.value) })} /></label>
          <label>Weight (kg)<input type="number" step="0.1" value={String(form.weightKg ?? '')} onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} /></label>
          <label>Target weight (kg)<input type="number" step="0.1" value={String(form.targetWeightKg ?? '')} onChange={(e) => setForm({ ...form, targetWeightKg: Number(e.target.value) })} /></label>
          <label>Activity<select value={String(form.activityLevel ?? '')} onChange={(e) => setForm({ ...form, activityLevel: e.target.value })}>
            <option value="">—</option>
            {ACTIVITY_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select></label>
          <label>Goal<select value={String(form.goal ?? '')} onChange={(e) => setForm({ ...form, goal: e.target.value })}>
            <option value="">—</option>
            {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select></label>
          <label>Diet<select value={String(form.dietaryPreference ?? '')} onChange={(e) => setForm({ ...form, dietaryPreference: e.target.value })}>
            <option value="">—</option>
            {DIETARY_PREFERENCES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select></label>
          <label style={{ gridColumn: '1 / -1' }}>Allergies<textarea value={String(form.allergies ?? '')} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Disliked foods<textarea value={String(form.dislikedFoods ?? '')} onChange={(e) => setForm({ ...form, dislikedFoods: e.target.value })} /></label>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Medical caution flags are optional notes only — this app does not diagnose or prescribe.
        </p>
        <label>
          <input type="checkbox" checked={!!(form.medicalCautionFlags as Record<string, boolean>)?.kidney}
            onChange={(e) => setForm({ ...form, medicalCautionFlags: { ...(form.medicalCautionFlags as object), kidney: e.target.checked } })} />
          {' '}Kidney-related caution (informational)
        </label>
        <div className="nutrition-btn-row">
          <button type="submit" className="nutrition-btn nutrition-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <section className="nutrition-card">
        <h3>Nutrient targets (evidence-based defaults)</h3>
        {!canManage && <p style={{ fontSize: '0.85rem' }}>Admin can edit targets. You can view reference sources below.</p>}
        <div className="nutrition-table-wrap">
          <table className="nutrition-table">
            <thead>
              <tr><th>Nutrient</th><th>Target</th><th>Unit</th><th>Reference</th>{canManage && <th>Edit</th>}</tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={String(t.nutrient_key)}>
                  <td>{String(t.display_name)}</td>
                  <td>{String(t.default_target ?? '—')}</td>
                  <td>{String(t.unit)}</td>
                  <td><a href={String(t.reference_url || '#')} target="_blank" rel="noreferrer">{String(t.reference_source || '—')}</a></td>
                  {canManage && (
                    <td>
                      <input type="number" defaultValue={String(t.default_target ?? '')} id={`target-${t.nutrient_key}`} style={{ width: '5rem' }} />
                      <button type="button" className="nutrition-btn" onClick={() => {
                        const el = document.getElementById(`target-${t.nutrient_key}`) as HTMLInputElement
                        updateTarget(String(t.nutrient_key), el.value)
                      }}>Save</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

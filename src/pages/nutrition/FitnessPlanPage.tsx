import { useEffect, useState } from 'react'
import * as api from '../../api/nutritionCoach'
import { WELLNESS_DISCLAIMER } from './NutritionCoachShell'

export function FitnessPlanPage() {
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null)
  const [level, setLevel] = useState('beginner')
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api.fetchWorkoutPlan(level) as { plan?: Record<string, unknown> }
      setPlan(res.plan || null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [level])

  const schedule = (plan?.weekly_schedule || {}) as Record<string, Record<string, unknown>>
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const todayKey = dayNames[new Date().getDay()]
  const today = schedule[todayKey]

  async function markComplete() {
    setMarking(true)
    try {
      await api.saveWorkoutSession({
        sessionDate: new Date().toISOString().slice(0, 10),
        sessionType: String(today?.type || 'workout'),
        completed: true,
        durationMinutes: 45,
        exercises: (today?.exercises as unknown[]) || [],
        notes: 'Marked complete from fitness plan',
      })
    } finally {
      setMarking(false)
    }
  }

  return (
    <>
      <div className="nutrition-btn-row">
        <label>
          Level{' '}
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
          </select>
        </label>
        <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={markComplete} disabled={marking}>
          {marking ? 'Saving…' : 'Mark today\'s workout complete'}
        </button>
        <button type="button" className="nutrition-btn" onClick={() => window.open(api.nutritionExportUrl('workout'), '_blank')}>
          Export workout XLSX
        </button>
      </div>

      {loading && <p>Loading fitness plan…</p>}

      {plan && (
        <>
          <section className="nutrition-card">
            <h3>{String(plan.title)}</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{String(plan.safety_notes || WELLNESS_DISCLAIMER)}</p>
          </section>

          <section className="nutrition-card">
            <h3>Today — {todayKey}</h3>
            {today ? (
              <>
                <p><strong>Type:</strong> {String(today.type)}</p>
                {today.message && <p>{String(today.message)}</p>}
                <p><strong>Warm-up:</strong> {String(today.warmup || '—')}</p>
                <ul>
                  {((today.exercises as Array<Record<string, unknown>>) || []).map((ex, i) => (
                    <li key={i}>
                      {String(ex.name)} — {String(ex.sets)}×{String(ex.reps)} @ RPE {String(ex.rpe || '—')}
                    </li>
                  ))}
                </ul>
                <p><strong>Cool-down:</strong> {String(today.cooldown || '—')}</p>
                <p><strong>Cardio:</strong> {String(today.cardio || '—')}</p>
              </>
            ) : (
              <p>No workout scheduled.</p>
            )}
          </section>

          <div className="nutrition-grid">
            {dayNames.map((day) => {
              const d = schedule[day]
              return (
                <div key={day} className="nutrition-card">
                  <h3>{day}</h3>
                  <p>{String(d?.type || 'rest')}</p>
                  <small>{((d?.muscleGroups as string[]) || []).join(', ')}</small>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

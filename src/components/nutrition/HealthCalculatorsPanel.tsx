import { useMemo, useState } from 'react'
import type { NutritionProfile } from '../hooks/useNutritionCoach'
import { computeLiveCalculators } from '../../utils/healthCalculators'

function CalculatorGrid({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values).filter(([, v]) => v != null && typeof v !== 'object')
  return (
    <div className="nutrition-grid nutrition-grid--calc">
      {entries.map(([k, v]) => (
        <div key={k} className="nutrition-card nutrition-card--calc">
          <h3>{k.replace(/([A-Z])/g, ' $1')}</h3>
          <div className="pct">{String(v)}</div>
        </div>
      ))}
    </div>
  )
}

export function HealthCalculatorsPanel({ profile }: { profile: Partial<NutritionProfile> | null }) {
  const [overrides, setOverrides] = useState({
    weightKg: '',
    heightCm: '',
    age: '',
    gender: 'male',
    activityLevel: 'moderate',
    goal: 'maintenance',
  })

  const live = useMemo(
    () =>
      computeLiveCalculators(profile, {
        weight_kg: overrides.weightKg ? Number(overrides.weightKg) : undefined,
        height_cm: overrides.heightCm ? Number(overrides.heightCm) : undefined,
        age: overrides.age ? Number(overrides.age) : undefined,
        gender: overrides.gender,
        activity_level: overrides.activityLevel,
        goal: overrides.goal,
      }),
    [profile, overrides],
  )

  return (
    <div className="nutrition-card">
      <h3>Interactive calculators</h3>
      <p className="nutrition-muted">BMI · BMR · TDEE · calories · protein · carbs · fat · water · fiber · ideal weight · workout burn · macro split · pace</p>
      <div className="nutrition-form-grid">
        <label>Weight (kg)<input value={overrides.weightKg} onChange={(e) => setOverrides({ ...overrides, weightKg: e.target.value })} placeholder={String(profile?.weight_kg ?? '')} /></label>
        <label>Height (cm)<input value={overrides.heightCm} onChange={(e) => setOverrides({ ...overrides, heightCm: e.target.value })} placeholder={String(profile?.height_cm ?? '')} /></label>
        <label>Age<input value={overrides.age} onChange={(e) => setOverrides({ ...overrides, age: e.target.value })} placeholder={String(profile?.age ?? '')} /></label>
        <label>Gender<select value={overrides.gender} onChange={(e) => setOverrides({ ...overrides, gender: e.target.value })}><option value="male">Male</option><option value="female">Female</option></select></label>
        <label>Activity<select value={overrides.activityLevel} onChange={(e) => setOverrides({ ...overrides, activityLevel: e.target.value })}>
          {['sedentary', 'light', 'moderate', 'active', 'extra'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select></label>
        <label>Goal<select value={overrides.goal} onChange={(e) => setOverrides({ ...overrides, goal: e.target.value })}>
          <option value="fat_loss">Fat loss</option><option value="maintenance">Maintenance</option><option value="muscle_gain">Muscle gain</option><option value="strength">Strength</option>
        </select></label>
      </div>
      <CalculatorGrid values={live as Record<string, unknown>} />
      {live.idealWeightRange && (
        <p className="nutrition-muted">Ideal weight range: {live.idealWeightRange.minKg}–{live.idealWeightRange.maxKg} kg (estimate)</p>
      )}
      {live.pace && (
        <p className="nutrition-muted">Pace estimate: ~{live.pace.weeklySafeKg} kg/week · ~{live.pace.weeks} weeks (wellness guidance only)</p>
      )}
    </div>
  )
}

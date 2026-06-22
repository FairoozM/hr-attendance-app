import { useEffect, useState } from 'react'
import * as api from '../../api/nutritionCoach'
import { HealthCalculatorsPanel } from '../../components/nutrition/HealthCalculatorsPanel'
import type { NutritionProfile } from '../../hooks/useNutritionCoach'
import { WellnessDisclaimer } from './NutritionCoachShell'

export function HealthCalculatorsPage() {
  const [profile, setProfile] = useState<NutritionProfile | null>(null)
  const [serverCalcs, setServerCalcs] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.fetchNutritionProfile(), api.fetchCalculators()])
      .then(([p, c]) => {
        setProfile((p as { profile?: NutritionProfile }).profile || null)
        setServerCalcs((c as { calculators?: Record<string, unknown> }).calculators || null)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p>Loading calculators…</p>

  return (
    <>
      <WellnessDisclaimer />
      <HealthCalculatorsPanel profile={profile} />
      {serverCalcs && (
        <section className="nutrition-card">
          <h3>Saved profile calculator snapshot</h3>
          <div className="nutrition-grid nutrition-grid--calc">
            {Object.entries(serverCalcs).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => (
              <div key={k} className="nutrition-card nutrition-card--calc">
                <h3>{k.replace(/([A-Z])/g, ' $1')}</h3>
                <div className="pct">{String(v)}</div>
              </div>
            ))}
          </div>
          {typeof serverCalcs.idealWeightRange === 'object' && serverCalcs.idealWeightRange && (
            <p className="nutrition-muted">
              Ideal weight range: {String((serverCalcs.idealWeightRange as { minKg: number }).minKg)}–
              {String((serverCalcs.idealWeightRange as { maxKg: number }).maxKg)} kg
            </p>
          )}
        </section>
      )}
    </>
  )
}

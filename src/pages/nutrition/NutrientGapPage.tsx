import { useState } from 'react'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { statusClass } from './NutritionCoachShell'
import { NutrientScoreCard } from '../../components/nutrition/NutrientScoreCard'
import { FoodSuggestionChip } from '../../components/nutrition/FoodSuggestionChip'
import * as api from '../../api/nutritionCoach'

export function NutrientGapPage() {
  const { loading, error, summary, dashboard, addFoodItem, reload } = useNutritionCoach()
  const [fixMsg, setFixMsg] = useState<string | null>(null)

  if (loading) return <p>Loading nutrient analysis…</p>
  if (error) return <p role="alert">{error}</p>

  const s = summary as Record<string, unknown> | null
  const d = dashboard as Record<string, unknown> | null
  const cards = (s?.cards as Array<Record<string, unknown>>) || []
  const missing = (s?.missing_nutrients as Array<Record<string, unknown>>) || []
  const foods = (d?.suggestionFoods as Array<{ name: string; image_url?: string; id?: number }>) || []

  async function handleFixToday() {
    const res = await api.fetchFixTodayNutrition() as { mealReplacements?: Array<{ message?: string }> }
    setFixMsg((res.mealReplacements || []).map((m) => m.message).join(' · '))
  }

  return (
    <>
      <div className="nutrition-btn-row">
        <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={handleFixToday}>Fix today&apos;s nutrition</button>
        <button type="button" className="nutrition-btn" onClick={() => window.open(api.nutritionExportUrl('weekly'), '_blank')}>Export weekly XLSX</button>
      </div>
      {fixMsg && <div className="nutrition-card nutrition-suggestion-banner">{fixMsg}</div>}

      <div className="nutrition-grid">
        {cards.map((card) => (
          <NutrientScoreCard key={String(card.key)} label={String(card.label)} pct={Number(card.pct || 0)} status={String(card.status)} />
        ))}
      </div>

      <section className="nutrition-card nutrition-missing-alert">
        <h3>Missing nutrients &amp; replacements</h3>
        {missing.map((m) => (
          <div key={String(m.key)} className="nutrition-missing-item">
            <span className={statusClass('low')}>{String(m.displayName)}</span>
            <strong>{Number(m.pct || 0)}%</strong>
            <p className="nutrition-suggestion">Try: {((m.suggestions as string[]) || []).join(', ')}</p>
          </div>
        ))}
        <div className="nutrition-suggestion-row">
          {foods.map((f) => (
            <FoodSuggestionChip
              key={f.name}
              name={f.name}
              imageUrl={f.image_url}
              onClick={() => addFoodItem({ foodName: f.name, foodLibraryId: f.id, mealType: 'snack', quantity: 1, whyNotes: 'Gap fix suggestion' }).then(reload)}
            />
          ))}
        </div>
      </section>
    </>
  )
}

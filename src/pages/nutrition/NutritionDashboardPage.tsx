import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { NutritionAssistantPanel } from '../../components/nutrition/NutritionAssistantPanel'
import { ProgressRing } from '../../components/nutrition/ProgressRing'
import { NutrientScoreCard } from '../../components/nutrition/NutrientScoreCard'
import { MissingNutrientAlert } from '../../components/nutrition/MissingNutrientAlert'
import { QuickActionBar } from '../../components/nutrition/QuickActionBar'
import { FoodSuggestionChip } from '../../components/nutrition/FoodSuggestionChip'
import { MediterraneanPlateBuilder } from '../../components/nutrition/MediterraneanPlateBuilder'
import { WorldPlateBuilder } from '../../components/nutrition/WorldPlateBuilder'
import { FatComparisonCard } from '../../components/nutrition/FatComparisonCard'
import * as api from '../../api/nutritionCoach'
import { statusClass } from './NutritionCoachShell'

export function NutritionDashboardPage() {
  const navigate = useNavigate()
  const { loading, error, dashboard, summary, reload, addFoodItem } = useNutritionCoach()
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  if (loading) return <p>Loading dashboard…</p>
  if (error) return <p role="alert">{error}</p>

  const d = dashboard as Record<string, unknown> | null
  const cards = (summary as { cards?: Array<Record<string, unknown>> } | null)?.cards || (d?.cards as Array<Record<string, unknown>>) || []
  const compare = d?.compareYesterday as Record<string, number> | undefined
  const suggestionFoods = (d?.suggestionFoods as Array<{ name: string; image_url?: string; id?: number; whyNotes?: string }>) || []

  async function handleWhatToEat() {
    const res = await api.fetchWhatToEatNext() as { message?: string; foods?: Array<{ name: string }> }
    setActionMsg(`${res.message || 'Suggestion ready'} — ${(res.foods || []).map((f) => f.name).slice(0, 4).join(', ')}`)
  }

  async function handleFixToday() {
    const res = await api.fetchFixTodayNutrition() as { mealReplacements?: Array<{ message?: string }> }
    setActionMsg((res.mealReplacements || []).map((m) => m.message).slice(0, 3).join(' · ') || 'Review food suggestions below.')
  }

  async function quickAddFood(food: { name: string; id?: number | null; whyNotes?: string | null }) {
    await addFoodItem({
      foodName: food.name,
      foodLibraryId: food.id,
      mealType: 'snack',
      quantity: 1,
      whyNotes: food.whyNotes || 'Added from dashboard suggestion',
    })
    setActionMsg(`Logged ${food.name} as a snack.`)
    await reload()
  }

  return (
    <>
      <QuickActionBar onRefresh={reload} onWhatToEat={handleWhatToEat} onFixToday={handleFixToday} />
      {actionMsg && <div className="nutrition-card nutrition-suggestion-banner">{actionMsg}</div>}

      {d?.worldDietMode && (
        <WorldPlateBuilder plate={d.worldPlate as Parameters<typeof WorldPlateBuilder>[0]['plate']} />
      )}

      {d?.mediterraneanMode && !d?.worldDietMode && (
        <>
          <MediterraneanPlateBuilder plate={d.mediterraneanPlate as Parameters<typeof MediterraneanPlateBuilder>[0]['plate']} />
          <FatComparisonCard data={d.fatComparison as Parameters<typeof FatComparisonCard>[0]['data']} />
        </>
      )}

      <div className="nutrition-ring-row">
        <ProgressRing label="Calories" value={Number(d?.calories || 0)} target={Number(d?.calorieTarget || 0)} color="blue" />
        <ProgressRing label="Protein" value={Number(d?.protein || 0)} target={Number(d?.proteinTarget || 0)} unit="g" color="green" />
        <ProgressRing label="Water" value={Number(d?.waterMl || 0)} target={Number(d?.waterTarget || 0)} unit=" ml" color="blue" />
        <div className="nutrition-card nutrition-score-hero">
          <h3>Food quality</h3>
          <div className={`pct ${statusClass(Number(d?.foodQualityScore) >= 70 ? 'okay' : 'low')}`}>{Number(d?.foodQualityScore || 0)}</div>
          <small>Nutrient streak: {Number(d?.nutrientStreak || 0)} days</small>
        </div>
      </div>

      {compare && (
        <section className="nutrition-card nutrition-compare">
          <h3>Yesterday vs today</h3>
          <div className="nutrition-grid">
            <div><span>Calories Δ</span><strong className={compare.deltaCalories >= 0 ? 'nutrition-status--okay' : 'nutrition-status--low'}>{compare.deltaCalories > 0 ? '+' : ''}{compare.deltaCalories}</strong></div>
            <div><span>Protein Δ</span><strong>{compare.deltaProtein > 0 ? '+' : ''}{compare.deltaProtein}g</strong></div>
            <div><span>Water Δ</span><strong>{compare.deltaWater > 0 ? '+' : ''}{compare.deltaWater} ml</strong></div>
            <div><span>Quality Δ</span><strong>{compare.deltaQuality > 0 ? '+' : ''}{compare.deltaQuality}</strong></div>
          </div>
        </section>
      )}

      <MissingNutrientAlert
        items={(d?.topMissingNutrients as Array<Record<string, unknown>>) || []}
        foods={suggestionFoods}
        onAddFood={quickAddFood}
      />

      <section className="nutrition-card">
        <h3 className="nutrition-suggestion">Tap to add suggested foods</h3>
        <div className="nutrition-suggestion-row">
          {suggestionFoods.map((f) => (
            <FoodSuggestionChip key={f.name} name={f.name} imageUrl={f.image_url} whyNotes={f.whyNotes} onClick={() => quickAddFood(f)} />
          ))}
        </div>
      </section>

      <section className="nutrition-card">
        <h3>Nutrient coverage</h3>
        <div className="nutrition-grid">
          {cards.map((c) => (
            <NutrientScoreCard
              key={String(c.key)}
              label={String(c.label)}
              pct={Number(c.pct || 0)}
              status={String(c.status)}
            />
          ))}
        </div>
      </section>

      <div className="nutrition-btn-row">
        <button type="button" className="nutrition-btn" onClick={() => navigate('/health-fitness/nutrient-gaps')}>View gap analysis</button>
        <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={() => navigate('/health-fitness/meal-plan')}>Open meal planner</button>
      </div>

      <NutritionAssistantPanel onConfirmed={reload} />
    </>
  )
}

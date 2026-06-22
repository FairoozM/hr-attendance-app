import { useEffect, useState } from 'react'
import * as api from '../../api/nutritionCoach'
import { DragDropMealPlanner } from '../../components/nutrition/DragDropMealPlanner'
import { FoodImage } from '../../components/nutrition/FoodImage'
import { MediterraneanPlateBuilder } from '../../components/nutrition/MediterraneanPlateBuilder'
import { WorldPlateBuilder } from '../../components/nutrition/WorldPlateBuilder'
import { FatComparisonCard } from '../../components/nutrition/FatComparisonCard'

export function MealPlanPage() {
  const [plans, setPlans] = useState<Array<Record<string, unknown>>>([])
  const [foods, setFoods] = useState<Array<{ id?: number; name: string; image_url?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [latest, setLatest] = useState<Record<string, unknown> | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [planRes, foodRes] = await Promise.all([api.fetchMealPlans(), api.fetchFoodLibrary()])
      setPlans((planRes as { plans?: Array<Record<string, unknown>> }).plans || [])
      setLatest((planRes as { plans?: Array<Record<string, unknown>> }).plans?.[0] || null)
      setFoods(((foodRes as { foods?: Array<Record<string, unknown>> }).foods || []).map((f) => ({
        id: f.id as number,
        name: String(f.name),
        image_url: f.image_url as string,
      })))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function generate() {
    setGenerating(true)
    try {
      const res = await api.generateMealPlan({ title: 'Daily meal plan' }) as { plan?: Record<string, unknown> }
      setLatest(res.plan || null)
      await load()
    } finally {
      setGenerating(false)
    }
  }

  const planData = (latest?.plan_data || {}) as Record<string, unknown>
  const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snacks', 'preWorkout', 'postWorkout']
  const mealPlanForDrag = Object.fromEntries(
    MEAL_KEYS.map((k) => [k, planData[k]]).filter(([, v]) => Array.isArray(v)),
  ) as Record<string, { id?: number; name: string; image_url?: string }[]>

  return (
    <>
      <div className="nutrition-btn-row">
        <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={generate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate today\'s meal plan'}
        </button>
      </div>

      {loading && <p>Loading meal plans…</p>}

      {planData.worldPlate && (
        <>
          <WorldPlateBuilder plate={planData.worldPlate as Parameters<typeof WorldPlateBuilder>[0]['plate']} />
          <FatComparisonCard data={planData.fatGuidance as Parameters<typeof FatComparisonCard>[0]['data']} />
        </>
      )}

      {!planData.worldPlate && planData.mediterraneanPlate && (
        <>
          <MediterraneanPlateBuilder plate={planData.mediterraneanPlate as Parameters<typeof MediterraneanPlateBuilder>[0]['plate']} />
          <FatComparisonCard data={planData.fatGuidance as Parameters<typeof FatComparisonCard>[0]['data']} />
        </>
      )}

      <DragDropMealPlanner foods={foods} initialPlan={mealPlanForDrag} />

      {latest && (
        <section className="nutrition-card">
          <h3>Generated plan preview</h3>
          <div className="nutrition-food-grid">
            {MEAL_KEYS.flatMap((meal) =>
              ((planData[meal] as Array<Record<string, unknown>>) || []).map((item, i) => (
                <div key={`${meal}-${i}`} className="nutrition-card nutrition-food-card">
                  <FoodImage name={String(item.name)} imageUrl={item.image_url as string} size="md" />
                  <h3>{String(item.name)}</h3>
                  <p className="nutrition-muted">{meal}</p>
                </div>
              )),
            )}
          </div>
        </section>
      )}

      <section className="nutrition-card">
        <h3>Recent plans</h3>
        <ul>{plans.map((p) => <li key={String(p.id)}>{String(p.plan_date)} — {String(p.title || 'Meal plan')}</li>)}</ul>
      </section>
    </>
  )
}

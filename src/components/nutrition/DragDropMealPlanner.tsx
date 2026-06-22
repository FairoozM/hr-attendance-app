import { useState } from 'react'
import { FoodImage } from './FoodImage'

type FoodItem = { id?: number | null; name: string; image_url?: string | null }

type MealSlots = Record<string, FoodItem[]>

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks', 'preWorkout', 'postWorkout']

type Props = {
  foods: FoodItem[]
  initialPlan?: MealSlots
}

export function DragDropMealPlanner({ foods, initialPlan = {} }: Props) {
  const [plan, setPlan] = useState<MealSlots>(() => {
    const base: MealSlots = {}
    for (const m of MEALS) base[m] = initialPlan[m] ? [...initialPlan[m]] : []
    return base
  })
  const [dragFood, setDragFood] = useState<FoodItem | null>(null)

  function onDrop(meal: string) {
    if (!dragFood) return
    setPlan((prev) => ({ ...prev, [meal]: [...(prev[meal] || []), dragFood] }))
    setDragFood(null)
  }

  return (
    <div className="nutrition-meal-planner">
      <div className="nutrition-meal-planner__palette">
        <h4>Drag foods into meals</h4>
        <div className="nutrition-food-chip-row">
          {foods.slice(0, 16).map((f) => (
            <div
              key={`${f.id}-${f.name}`}
              className="nutrition-food-chip nutrition-food-chip--draggable"
              draggable
              onDragStart={() => setDragFood(f)}
            >
              <FoodImage name={f.name} imageUrl={f.image_url} size="sm" />
              <span>{f.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="nutrition-meal-planner__grid">
        {MEALS.map((meal) => (
          <div
            key={meal}
            className="nutrition-card nutrition-meal-slot"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(meal)}
          >
            <h3>{meal.replace(/([A-Z])/g, ' $1')}</h3>
            {(plan[meal] || []).map((f, i) => (
              <div key={`${meal}-${i}`} className="nutrition-meal-slot__item">
                <FoodImage name={f.name} imageUrl={f.image_url} size="sm" />
                <span>{f.name}</span>
              </div>
            ))}
            {!plan[meal]?.length && <p className="nutrition-muted">Drop foods here</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

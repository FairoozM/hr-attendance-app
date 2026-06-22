import { useState } from 'react'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import * as api from '../../api/nutritionCoach'
import { NutritionAssistantPanel } from '../../components/nutrition/NutritionAssistantPanel'
import { FoodImage } from '../../components/nutrition/FoodImage'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre-workout', 'post-workout']

export function FoodLogPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const { loading, error, foodLog, reload, removeFoodItem } = useNutritionCoach(date)
  const [form, setForm] = useState({ mealType: 'lunch', foodName: '', quantity: 1, unit: 'serving', whyNotes: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.addFoodLogItem({ logDate: date, ...form, mealType: form.mealType, foodName: form.foodName, whyNotes: form.whyNotes })
      setForm({ ...form, foodName: '', whyNotes: '' })
      await reload()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Loading food log…</p>
  if (error) return <p role="alert">{error}</p>

  const items = foodLog as Array<Record<string, unknown>>

  return (
    <>
      <div className="nutrition-btn-row">
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="nutrition-btn" onClick={() => window.open(api.nutritionExportUrl('daily', { date }), '_blank')}>Export daily XLSX</button>
      </div>

      <form className="nutrition-card" onSubmit={handleAdd}>
        <h3>Add food entry</h3>
        <div className="nutrition-form-grid">
          <label>Meal<select value={form.mealType} onChange={(e) => setForm({ ...form, mealType: e.target.value })}>{MEAL_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>Food name<input required value={form.foodName} onChange={(e) => setForm({ ...form, foodName: e.target.value })} /></label>
          <label>Quantity<input type="number" min={0.1} step={0.1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
          <label>Unit<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
          <label className="nutrition-wizard-field--full">Why I ate this<textarea value={form.whyNotes} onChange={(e) => setForm({ ...form, whyNotes: e.target.value })} /></label>
        </div>
        <button type="submit" className="nutrition-btn nutrition-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Log food'}</button>
      </form>

      <div className="nutrition-food-log-list">
        {items.map((item) => {
          const n = (item.nutrients || {}) as Record<string, number>
          return (
            <div key={String(item.id)} className="nutrition-card nutrition-food-log-item">
              <FoodImage name={String(item.food_name)} imageUrl={item.image_url as string} size="md" />
              <div>
                <strong>{String(item.food_name)}</strong>
                <div className="nutrition-muted">{String(item.meal_type)} · {String(item.quantity)} {String(item.unit || '')}</div>
                <div>{Number(n.calories || 0).toFixed(0)} kcal · {Number(n.protein || 0).toFixed(1)}g protein</div>
                {item.why_notes && <div className="nutrition-muted">{String(item.why_notes)}</div>}
              </div>
              <button type="button" className="nutrition-btn nutrition-btn--danger" onClick={() => removeFoodItem(item.id as number)}>Remove</button>
            </div>
          )
        })}
        {!items.length && <p className="nutrition-muted">No entries yet for this date.</p>}
      </div>

      <NutritionAssistantPanel logDate={date} onConfirmed={reload} />
    </>
  )
}

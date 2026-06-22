import { useState } from 'react'
import * as api from '../../api/nutritionCoach'
import { statusClass } from '../../pages/nutrition/NutritionCoachShell'

type ParsedItem = {
  inputToken: string
  quantity: number
  matched: boolean
  confidence: string
  foodName: string
  food?: {
    id: number
    name: string
    estimatedNutrients: Record<string, number>
  }
}

type Props = {
  logDate?: string
  onConfirmed?: () => void
}

export function NutritionAssistantPanel({ logDate, onConfirmed }: Props) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedItem[]>([])
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({})
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleParse() {
    setLoading(true)
    setResult(null)
    try {
      const res = await api.parseNutritionAssistant(text) as { parsed?: ParsedItem[] }
      setParsed(res.parsed || [])
      const init: Record<number, boolean> = {}
      ;(res.parsed || []).forEach((_, i) => { init[i] = true })
      setConfirmed(init)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    setLoading(true)
    try {
      const items = parsed.map((p, i) => ({
        confirmed: confirmed[i] !== false,
        foodName: p.food?.name || p.foodName,
        foodLibraryId: p.food?.id,
        quantity: p.quantity,
        nutrients: p.food?.estimatedNutrients,
      }))
      const res = await api.confirmNutritionAssistant({ logDate, items, mealType: 'snack' })
      setResult(res as Record<string, unknown>)
      setParsed([])
      setText('')
      onConfirmed?.()
    } finally {
      setLoading(false)
    }
  }

  const summary = result?.summary as Record<string, unknown> | undefined
  const nextMeal = result?.nextMeal as { message?: string; foods?: string[] } | undefined
  const gym = result?.gymSuggestion as { message?: string; type?: string } | undefined

  return (
    <section className="nutrition-assistant">
      <h3>AI Food Assistant</h3>
      <p style={{ fontSize: '0.85rem', margin: 0 }}>
        Describe what you ate. Parsed items are shown for confirmation — nothing is saved until you confirm.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="I ate 2 eggs, rice, chicken, almonds, raisins, yogurt."
      />
      <div className="nutrition-btn-row">
        <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={handleParse} disabled={loading || !text.trim()}>
          Parse foods
        </button>
        {parsed.length > 0 && (
          <button type="button" className="nutrition-btn" onClick={handleConfirm} disabled={loading}>
            Confirm &amp; save
          </button>
        )}
      </div>

      {parsed.length > 0 && (
        <div className="nutrition-card" style={{ marginTop: '0.75rem' }}>
          <h4>Review parsed foods</h4>
          {parsed.map((p, i) => (
            <label key={i} style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={confirmed[i] !== false}
                onChange={(e) => setConfirmed({ ...confirmed, [i]: e.target.checked })}
              />
              {' '}
              {p.quantity}× {p.food?.name || p.foodName}
              {' '}
              <span className={p.matched ? statusClass('okay') : statusClass('low')}>
                ({p.confidence}{p.matched ? '' : ' — verify'})
              </span>
            </label>
          ))}
        </div>
      )}

      {result && (
        <div className="nutrition-card" style={{ marginTop: '0.75rem' }}>
          <h4>After logging</h4>
          <p><strong>Coverage:</strong> food quality {String(summary?.food_quality_score ?? '—')}</p>
          <p className={statusClass('low')}>
            <strong>Missing:</strong>{' '}
            {((summary?.missing_nutrients as Array<{ displayName: string }>) || []).slice(0, 4).map((m) => m.displayName).join(', ') || 'None major'}
          </p>
          <p className="nutrition-suggestion"><strong>Next meal:</strong> {nextMeal?.message} {nextMeal?.foods?.join(', ')}</p>
          <p><strong>Gym today:</strong> {gym?.message || gym?.type}</p>
        </div>
      )}
    </section>
  )
}

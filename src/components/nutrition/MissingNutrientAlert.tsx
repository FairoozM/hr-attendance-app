import { FoodSuggestionChip } from './FoodSuggestionChip'

type Missing = {
  key?: string
  displayName?: string
  pct?: number
  suggestions?: string[]
}

type Food = { name: string; image_url?: string | null; id?: number | null }

type Props = {
  items: Missing[]
  foods?: Food[]
  onAddFood?: (food: Food) => void
}

export function MissingNutrientAlert({ items, foods = [], onAddFood }: Props) {
  if (!items.length) return null
  return (
    <section className="nutrition-card nutrition-missing-alert">
      <h3>Missing nutrients today</h3>
      <ul className="nutrition-missing-list">
        {items.map((m) => (
          <li key={String(m.key || m.displayName)} className="nutrition-missing-item">
            <span>{m.displayName}</span>
            <strong>{Number(m.pct || 0)}%</strong>
          </li>
        ))}
      </ul>
      {foods.length > 0 && (
        <div className="nutrition-suggestion-row">
          {foods.map((f) => (
            <FoodSuggestionChip key={f.name} name={f.name} imageUrl={f.image_url} onClick={() => onAddFood?.(f)} />
          ))}
        </div>
      )}
    </section>
  )
}

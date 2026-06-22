import { FoodImage } from './FoodImage'
import { MEDITERRANEAN_PLATE_SLOTS } from './nutritionConstants'

type PlateItem = { id?: number; name: string; image_url?: string | null }
type PlateSlot = { label: string; items?: PlateItem[]; suggestion?: string }
type Plate = {
  mode?: string
  slots?: Record<string, PlateSlot>
  summary?: string
  example?: { title?: string; description?: string; slots?: Record<string, string> }
}

export function MediterraneanPlateBuilder({ plate }: { plate: Plate | null | undefined }) {
  if (!plate?.slots) return null

  return (
    <section className="nutrition-card nutrition-med-plate">
      <h3>Mediterranean Plate Builder</h3>
      {plate.mode && <p className="nutrition-suggestion">Mode: {plate.mode}</p>}
      <div className="nutrition-med-plate-grid">
        {MEDITERRANEAN_PLATE_SLOTS.map(({ key, label }) => {
          const slot = plate.slots?.[key]
          const item = slot?.items?.[0]
          return (
            <div key={key} className="nutrition-med-plate-slot">
              <span className="nutrition-med-plate-slot__label">{label}</span>
              {item ? (
                <>
                  <FoodImage name={item.name} imageUrl={item.image_url} size="md" />
                  <strong>{item.name}</strong>
                </>
              ) : (
                <strong>{slot?.suggestion || '—'}</strong>
              )}
            </div>
          )
        })}
      </div>
      {plate.summary && (
        <p className="nutrition-med-plate-example">
          <strong>Built plate:</strong> {plate.summary}
        </p>
      )}
      {plate.example?.description && (
        <p className="nutrition-muted">Example: {plate.example.description}</p>
      )}
    </section>
  )
}

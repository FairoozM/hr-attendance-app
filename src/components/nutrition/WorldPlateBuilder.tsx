import { FoodImage } from './FoodImage'
import { WORLD_PLATE_SLOTS } from './nutritionConstants'

type PlateItem = {
  id?: number
  name: string
  image_url?: string | null
  why_recommended?: string | null
  origin_region?: string | null
  caution_tags?: string[]
}

type PlateSlot = { label: string; items?: PlateItem[]; suggestion?: string }
type Plate = {
  mode?: string
  region?: string
  regionLabel?: string
  slots?: Record<string, PlateSlot>
  summary?: string
  example?: { title?: string; description?: string }
  disclaimer?: string
}

export function WorldPlateBuilder({ plate }: { plate: Plate | null | undefined }) {
  if (!plate?.slots) return null

  return (
    <section className="nutrition-card nutrition-world-plate">
      <h3>World Plate Builder</h3>
      {plate.regionLabel && <p className="nutrition-suggestion">{plate.regionLabel}{plate.mode ? ` · ${plate.mode}` : ''}</p>}
      <div className="nutrition-med-plate-grid">
        {WORLD_PLATE_SLOTS.map(({ key, label }) => {
          const slot = plate.slots?.[key]
          const item = slot?.items?.[0]
          return (
            <div key={key} className="nutrition-med-plate-slot">
              <span className="nutrition-med-plate-slot__label">{label}</span>
              {item ? (
                <>
                  <FoodImage name={item.name} imageUrl={item.image_url} size="md" />
                  <strong>{item.name}</strong>
                  {item.why_recommended && <span className="nutrition-muted nutrition-why">{item.why_recommended}</span>}
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
      {plate.disclaimer && <p className="nutrition-muted nutrition-disclaimer">{plate.disclaimer}</p>}
    </section>
  )
}

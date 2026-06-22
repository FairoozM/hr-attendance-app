import { useEffect, useState } from 'react'
import * as api from '../../api/nutritionCoach'
import { FoodImage } from '../../components/nutrition/FoodImage'
import {
  FOOD_LIBRARY_FILTERS,
  NUTRIENT_GAP_FILTERS,
  WORLD_REGIONS,
} from '../../components/nutrition/nutritionConstants'
import { statusClass } from './NutritionCoachShell'

type FoodRow = {
  id?: number
  name: string
  serving_size?: number
  serving_unit?: string
  image_url?: string
  origin_region?: string
  why_recommended?: string
  caution_notes?: string[]
  calories_per_serving?: number
  protein?: number
  tags?: string[]
  diet_tags?: string[]
  nutrient_tags?: string[]
  caution_tags?: string[]
}

type Filters = {
  q: string
  origin_region: string
  nutrient_gap: string
  high_protein: boolean
  probiotic: boolean
  healthy_fat: boolean
  budget_friendly: boolean
  vegetarian: boolean
}

export function FoodLibraryPage() {
  const [foods, setFoods] = useState<FoodRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({
    q: '',
    origin_region: '',
    nutrient_gap: '',
    high_protein: false,
    probiotic: false,
    healthy_fat: false,
    budget_friendly: false,
    vegetarian: false,
  })

  async function load(next = filters) {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (next.q) params.q = next.q
      if (next.origin_region) params.origin_region = next.origin_region
      if (next.nutrient_gap) params.nutrient_gap = next.nutrient_gap
      if (next.high_protein) params.high_protein = 'true'
      if (next.probiotic) params.probiotic = 'true'
      if (next.healthy_fat) params.healthy_fat = 'true'
      if (next.budget_friendly) params.budget_friendly = 'true'
      if (next.vegetarian) params.vegetarian = 'true'
      const res = await api.fetchFoodLibrary(params) as { foods?: FoodRow[] }
      setFoods(res.foods || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleFilter(key: keyof Omit<Filters, 'q' | 'origin_region' | 'nutrient_gap'>) {
    const next = { ...filters, [key]: !filters[key] }
    setFilters(next)
    load(next)
  }

  const grouped = foods.reduce<Record<string, FoodRow[]>>((acc, f) => {
    const region = f.origin_region || 'global'
    if (!acc[region]) acc[region] = []
    acc[region].push(f)
    return acc
  }, {})

  return (
    <>
      <section className="nutrition-card">
        <h3>Global food library</h3>
        <p className="nutrition-muted">Traditional foods tagged by region and evidence-supported nutrition value — wellness guidance only, not medical advice.</p>
        <div className="nutrition-filter-row">
          <input
            type="search"
            placeholder="Search foods…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load(filters)}
          />
          <select
            value={filters.origin_region}
            onChange={(e) => {
              const next = { ...filters, origin_region: e.target.value }
              setFilters(next)
              load(next)
            }}
          >
            {WORLD_REGIONS.map((r) => (
              <option key={r.value || 'all'} value={r.value}>{r.label}</option>
            ))}
          </select>
          <select
            value={filters.nutrient_gap}
            onChange={(e) => {
              const next = { ...filters, nutrient_gap: e.target.value }
              setFilters(next)
              load(next)
            }}
          >
            {NUTRIENT_GAP_FILTERS.map((g) => (
              <option key={g.value || 'any'} value={g.value}>{g.label}</option>
            ))}
          </select>
          <button type="button" className="nutrition-btn" onClick={() => load(filters)}>Apply</button>
        </div>
        <div className="nutrition-filter-chips">
          {FOOD_LIBRARY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`nutrition-tag nutrition-tag--filter ${filters[f.key as keyof Filters] ? 'nutrition-tag--active' : ''}`}
              onClick={() => toggleFilter(f.key as keyof Omit<Filters, 'q' | 'origin_region' | 'nutrient_gap'>)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {loading && <p>Loading food library…</p>}

      {Object.entries(grouped).map(([region, regionFoods]) => (
        <section key={region} className="nutrition-card">
          <h3>{WORLD_REGIONS.find((r) => r.value === region)?.label || region.replace(/_/g, ' ')}</h3>
          <div className="nutrition-food-grid">
            {regionFoods.map((f) => (
              <div key={String(f.id)} className="nutrition-card nutrition-food-card nutrition-food-card--world">
                <FoodImage name={f.name} imageUrl={f.image_url} size="lg" />
                <h3>{f.name}</h3>
                <p className="nutrition-muted">{f.serving_size} {f.serving_unit}</p>
                <p>
                  <span className={statusClass('okay')}>{Number(f.calories_per_serving || 0).toFixed(0)} kcal</span>
                  {' · '}{Number(f.protein || 0).toFixed(1)}g protein
                </p>
                {f.why_recommended && (
                  <p className="nutrition-why"><strong>Why it helps:</strong> {f.why_recommended}</p>
                )}
                {(f.caution_notes || []).length > 0 && (
                  <p className="nutrition-status--high nutrition-caution">{(f.caution_notes || []).join(' ')}</p>
                )}
                <div className="nutrition-tag-row">
                  {(f.nutrient_tags || []).slice(0, 4).map((t) => (
                    <span key={t} className="nutrition-tag nutrition-tag--nutrient">{t.replace(/_/g, ' ')}</span>
                  ))}
                  {(f.diet_tags || []).includes('budget_friendly') && (
                    <span className="nutrition-tag">budget</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {!loading && foods.length === 0 && (
        <p className="nutrition-muted">No foods match these filters. Try clearing filters or searching another term.</p>
      )}
    </>
  )
}

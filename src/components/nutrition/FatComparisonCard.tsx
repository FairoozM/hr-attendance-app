type FatComparison = {
  totalFatG?: number
  saturatedFatG?: number
  unsaturatedEstimateG?: number
  omega3G?: number
  calorieDensityFromFatPct?: number
  healthyUnsaturatedSources?: Array<{ foodName: string; highlight?: string; portionNote?: string; caution?: string | null }>
  traditionalSaturatedSources?: Array<{ foodName: string; highlight?: string; portionNote?: string; caution?: string | null }>
  comparisonNote?: string
  oliveOilNote?: string
  gheeNote?: string
}

export function FatComparisonCard({ data }: { data: FatComparison | null | undefined }) {
  if (!data) return null
  return (
    <section className="nutrition-card nutrition-fat-card">
      <h3>Fat comparison today</h3>
      <div className="nutrition-grid nutrition-grid--calc">
        <div className="nutrition-card nutrition-card--calc">
          <h3>Total fat</h3>
          <div className="pct">{data.totalFatG ?? 0}g</div>
        </div>
        <div className="nutrition-card nutrition-card--calc">
          <h3>Saturated</h3>
          <div className="pct nutrition-status--high">{data.saturatedFatG ?? 0}g</div>
        </div>
        <div className="nutrition-card nutrition-card--calc">
          <h3>Unsaturated (est.)</h3>
          <div className="pct nutrition-status--okay">{data.unsaturatedEstimateG ?? 0}g</div>
        </div>
        <div className="nutrition-card nutrition-card--calc">
          <h3>Fat calorie share</h3>
          <div className="pct">{data.calorieDensityFromFatPct ?? 0}%</div>
        </div>
      </div>
      <p className="nutrition-muted">{data.comparisonNote}</p>
      <p className="nutrition-suggestion">{data.oliveOilNote}</p>
      <p className="nutrition-muted">{data.gheeNote}</p>
      {(data.healthyUnsaturatedSources || []).map((s) => (
        <div key={s.foodName} className="nutrition-fat-source nutrition-fat-source--good">
          <strong>{s.foodName}</strong> — {s.highlight}
          <div className="nutrition-muted">{s.portionNote}</div>
        </div>
      ))}
      {(data.traditionalSaturatedSources || []).map((s) => (
        <div key={s.foodName} className="nutrition-fat-source nutrition-fat-source--caution">
          <strong>{s.foodName}</strong> — {s.highlight}
          <div className="nutrition-muted">{s.portionNote}</div>
          {s.caution && <div className="nutrition-status--high">{s.caution}</div>}
        </div>
      ))}
    </section>
  )
}

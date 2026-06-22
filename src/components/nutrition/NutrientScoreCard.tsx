import { statusClass } from '../../pages/nutrition/NutritionCoachShell'

type Props = {
  label: string
  pct: number
  status?: string
  subtitle?: string
}

export function NutrientScoreCard({ label, pct, status, subtitle }: Props) {
  return (
    <div className={`nutrition-card nutrition-score-card ${statusClass(status)}`}>
      <h3>{label}</h3>
      <div className={`pct ${statusClass(status)}`}>{pct}%</div>
      {subtitle && <small>{subtitle}</small>}
    </div>
  )
}

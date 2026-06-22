type Props = {
  label: string
  value: number
  target: number
  unit?: string
  color?: 'green' | 'amber' | 'blue'
}

export function ProgressRing({ label, value, target, unit = '', color = 'blue' }: Props) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  const r = 42
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <div className={`nutrition-ring nutrition-ring--${color}`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="nutrition-ring__track" cx="50" cy="50" r={r} />
        <circle
          className="nutrition-ring__progress"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="nutrition-ring__label">
        <strong>{Math.round(value)}{unit}</strong>
        <span>{label}</span>
        <small>{pct}% of {Math.round(target)}{unit}</small>
      </div>
    </div>
  )
}

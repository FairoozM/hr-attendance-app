export interface IsoSummaryCardItem {
  key: string
  label: string
  value: number | string
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
  onClick?: () => void
}

interface IsoSummaryCardsProps {
  items: IsoSummaryCardItem[]
}

export function IsoSummaryCards({ items }: IsoSummaryCardsProps) {
  return (
    <div className="iso-summary-cards">
      {items.map((item) => {
        const clickable = typeof item.onClick === 'function'
        const tone = item.tone && item.tone !== 'neutral' ? `iso-summary-card--${item.tone}` : ''
        const className = `iso-summary-card ${tone} ${clickable ? 'iso-summary-card--clickable' : ''}`.trim()
        if (clickable) {
          return (
            <button
              key={item.key}
              type="button"
              className={className}
              onClick={item.onClick}
            >
              <span className="iso-summary-card__count">{item.value}</span>
              <span className="iso-summary-card__label">{item.label}</span>
            </button>
          )
        }
        return (
          <div key={item.key} className={className}>
            <span className="iso-summary-card__count">{item.value}</span>
            <span className="iso-summary-card__label">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}

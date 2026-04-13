import { memo } from 'react'
import type { ReactNode } from 'react'

type Props = {
  title: string
  value: string | number
  icon?: ReactNode
  color?: string
  subtitle?: string
}

export const AttendanceSummaryCard = memo(function AttendanceSummaryCard({ title, value, icon, color, subtitle }: Props) {
  return (
    <div className="adash-card">
      <span className="adash-card__label">{title}</span>
      <span className="adash-card__value" style={color ? { color } : undefined}>
        {icon && <span className="adash-card__icon">{icon} </span>}
        {value}
      </span>
      {subtitle && (
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{subtitle}</span>
      )}
    </div>
  )
})

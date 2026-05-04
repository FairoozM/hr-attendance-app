import { memo } from 'react'
import type { ReactNode } from 'react'

type FooterTone = 'good' | 'bad' | 'neutral'

type Props = {
  title: string
  value: string | number
  icon?: ReactNode
  color?: string
  subtitle?: string
  /** Second line under subtitle (e.g. day-over-day delta). */
  footer?: string
  footerTone?: FooterTone
}

export const AttendanceSummaryCard = memo(function AttendanceSummaryCard({
  title,
  value,
  icon,
  color,
  subtitle,
  footer,
  footerTone = 'neutral',
}: Props) {
  const footerClass =
    footerTone === 'good'
      ? 'adash-card__footer adash-card__footer--good'
      : footerTone === 'bad'
        ? 'adash-card__footer adash-card__footer--bad'
        : 'adash-card__footer adash-card__footer--neutral'

  return (
    <div className="adash-card">
      <span className="adash-card__label">{title}</span>
      <span className="adash-card__value" style={color ? { color } : undefined}>
        {icon && <span className="adash-card__icon">{icon} </span>}
        {value}
      </span>
      {subtitle && <span className="adash-card__subtitle">{subtitle}</span>}
      {footer && <span className={footerClass}>{footer}</span>}
    </div>
  )
})

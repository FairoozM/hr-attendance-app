function toneForStatus(status?: string | null): string {
  const s = String(status || '').toLowerCase()
  if (!s) return 'neutral'
  if (/(approved|current|closed|conforming|ok|active)/.test(s)) return 'ok'
  if (/(review|pending|planned|progress|due|warn|observation|ofi)/.test(s)) return 'warn'
  if (/(obsolete|expired|reject|major|overdue|danger|cancelled)/.test(s)) return 'danger'
  if (/(draft|superseded|archived|minor)/.test(s)) return 'neutral'
  return 'info'
}

interface IsoStatusBadgeProps {
  status?: string | null
  className?: string
}

export function IsoStatusBadge({ status, className = '' }: IsoStatusBadgeProps) {
  const tone = toneForStatus(status)
  const label = status || '—'
  return (
    <span className={`iso-badge iso-badge--${tone} ${className}`.trim()} title={label}>
      {label}
    </span>
  )
}

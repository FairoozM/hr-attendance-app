interface StepBadgeProps {
  number?: number | string | null
  className?: string
}

export function StepBadge({ number, className = '' }: StepBadgeProps) {
  const value = Number(number)
  const displayNumber = Number.isFinite(value)
    ? String(Math.max(1, Math.trunc(value))).padStart(2, '0')
    : ''

  return (
    <span
      className={['ip-step-badge', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {displayNumber}
    </span>
  )
}

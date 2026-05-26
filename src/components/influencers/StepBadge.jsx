export function StepBadge({ number, className = '' }) {
  const value = Number(number)
  const displayNumber = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : ''

  return (
    <span
      className={['ip-step-badge', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {displayNumber}
    </span>
  )
}

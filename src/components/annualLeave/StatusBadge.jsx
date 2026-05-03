const STATUS_CFG = {
  Pending: { color: '#b45309', bg: '#fef3c7', dot: '#f59e0b' },
  Approved: { color: '#1d4ed8', bg: '#dbeafe', dot: '#3b82f6' },
  Ongoing: { color: '#6d28d9', bg: '#ede9fe', dot: '#8b5cf6' },
  ReturnPending: { color: '#c2410c', bg: '#ffedd5', dot: '#f97316' },
  Completed: { color: '#15803d', bg: '#dcfce7', dot: '#22c55e' },
  Overstayed: { color: '#b91c1c', bg: '#fee2e2', dot: '#ef4444' },
  Rejected: { color: '#4b5563', bg: '#f3f4f6', dot: '#9ca3af' },
}

/**
 * @param {object} p
 * @param {string} p.status
 * @param {string} [p.labelOverride] user-facing label; backend `status` key stays in cfg
 */
export function StatusBadge({ status, labelOverride }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.Pending
  const label = labelOverride || status
  return (
    <span className="al-badge" style={{ color: cfg.color, background: cfg.bg }}>
      <span className="al-badge__dot" style={{ background: cfg.dot }} />
      {label}
    </span>
  )
}

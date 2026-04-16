import { getDaysLeft, getSmartStatus, STATUS } from '../utils/docExpiryUtils'

/* ── Dot bullet ── */
function Dot() {
  return <span className="doc-badge__dot" aria-hidden />
}

/* ── Checkmark icon for OK status ── */
function IconCheck() {
  return (
    <svg
      width="11" height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const WORKFLOW_CONFIG = {
  'Pending':     { cls: 'doc-wf-badge--pending'     },
  'In Progress': { cls: 'doc-wf-badge--in-progress' },
  'Submitted':   { cls: 'doc-wf-badge--submitted'   },
  'Completed':   { cls: 'doc-wf-badge--completed'   },
}

/* ── Smart-status badge with days embedded ── */
export function DocStatusBadge({ expiryDate }) {
  const status = getSmartStatus(expiryDate)
  const days   = getDaysLeft(expiryDate)

  if (status === STATUS.OK) {
    const daysText = days !== null ? ` - ${days}d left` : ''
    return (
      <span className="doc-badge doc-badge--ok">
        <IconCheck />
        {`OK${daysText}`}
      </span>
    )
  }

  if (status === STATUS.URGENT) {
    const daysText = days !== null ? ` - ${days}d left` : ''
    return (
      <span className="doc-badge doc-badge--urgent">
        <Dot />
        {`Urgent${daysText}`}
      </span>
    )
  }

  if (status === STATUS.DUE_SOON) {
    const daysText = days !== null ? ` - ${days}d left` : ''
    return (
      <span className="doc-badge doc-badge--due-soon">
        <Dot />
        {`Due Soon${daysText}`}
      </span>
    )
  }

  // EXPIRED
  const overdue = days !== null ? ` - ${Math.abs(days)}d ago` : ''
  return (
    <span className="doc-badge doc-badge--expired">
      <Dot />
      {`Expired${overdue}`}
    </span>
  )
}

/* ── Workflow badge (unchanged) ── */
export function DocWorkflowBadge({ status }) {
  const cfg = WORKFLOW_CONFIG[status] || WORKFLOW_CONFIG['Pending']
  return (
    <span className={`doc-wf-badge ${cfg.cls}`}>
      <Dot />
      {status || 'Pending'}
    </span>
  )
}

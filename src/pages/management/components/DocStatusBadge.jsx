import { getSmartStatus, STATUS } from '../utils/docExpiryUtils'

/* ── Dot bullet used by both badge types ── */
function Dot() {
  return <span className="doc-badge__dot" aria-hidden />
}

/* ── Config maps ── */
const STATUS_CONFIG = {
  [STATUS.EXPIRED]:  { label: 'Expired',  cls: 'doc-badge--expired'  },
  [STATUS.URGENT]:   { label: 'Urgent',   cls: 'doc-badge--urgent'   },
  [STATUS.DUE_SOON]: { label: 'Due Soon', cls: 'doc-badge--due-soon' },
  [STATUS.OK]:       { label: 'On Track', cls: 'doc-badge--ok'       },
}

const WORKFLOW_CONFIG = {
  'Pending':     { cls: 'doc-wf-badge--pending'     },
  'In Progress': { cls: 'doc-wf-badge--in-progress' },
  'Submitted':   { cls: 'doc-wf-badge--submitted'   },
  'Completed':   { cls: 'doc-wf-badge--completed'   },
}

/* ── Badge components ── */
export function DocStatusBadge({ expiryDate }) {
  const status = getSmartStatus(expiryDate)
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG[STATUS.OK]
  return (
    <span className={`doc-badge ${cfg.cls}`}>
      <Dot />
      {cfg.label}
    </span>
  )
}

export function DocWorkflowBadge({ status }) {
  const cfg = WORKFLOW_CONFIG[status] || WORKFLOW_CONFIG['Pending']
  return (
    <span className={`doc-wf-badge ${cfg.cls}`}>
      <Dot />
      {status || 'Pending'}
    </span>
  )
}

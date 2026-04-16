import { getSmartStatus, STATUS } from '../utils/docExpiryUtils'

const STATUS_CONFIG = {
  [STATUS.EXPIRED]:  { label: 'Expired',  cls: 'doc-badge--expired'  },
  [STATUS.URGENT]:   { label: 'Urgent',   cls: 'doc-badge--urgent'   },
  [STATUS.DUE_SOON]: { label: 'Due Soon', cls: 'doc-badge--due-soon' },
  [STATUS.OK]:       { label: 'OK',       cls: 'doc-badge--ok'       },
}

const WORKFLOW_CONFIG = {
  'Pending':     'doc-wf-badge--pending',
  'In Progress': 'doc-wf-badge--in-progress',
  'Submitted':   'doc-wf-badge--submitted',
  'Completed':   'doc-wf-badge--completed',
}

export function DocStatusBadge({ expiryDate }) {
  const status = getSmartStatus(expiryDate)
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG[STATUS.OK]
  return <span className={`doc-badge ${cfg.cls}`}>{cfg.label}</span>
}

export function DocWorkflowBadge({ status }) {
  const cls = WORKFLOW_CONFIG[status] || 'doc-wf-badge--pending'
  return <span className={`doc-wf-badge ${cls}`}>{status || 'Pending'}</span>
}

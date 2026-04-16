import { getSmartStatus, STATUS } from '../utils/docExpiryUtils'

/* ── Smart status icons ── */
function IconExpired() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function IconUrgent() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function IconDueSoon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconOK() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

/* ── Workflow status icons ── */
function IconPending() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function IconInProgress() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function IconSubmitted() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function IconCompleted() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/* ── Config maps ── */
const STATUS_CONFIG = {
  [STATUS.EXPIRED]:  { label: 'Expired',  cls: 'doc-badge--expired',  Icon: IconExpired  },
  [STATUS.URGENT]:   { label: 'Urgent',   cls: 'doc-badge--urgent',   Icon: IconUrgent   },
  [STATUS.DUE_SOON]: { label: 'Due Soon', cls: 'doc-badge--due-soon', Icon: IconDueSoon  },
  [STATUS.OK]:       { label: 'OK',       cls: 'doc-badge--ok',       Icon: IconOK       },
}

const WORKFLOW_CONFIG = {
  'Pending':     { cls: 'doc-wf-badge--pending',     Icon: IconPending     },
  'In Progress': { cls: 'doc-wf-badge--in-progress', Icon: IconInProgress  },
  'Submitted':   { cls: 'doc-wf-badge--submitted',   Icon: IconSubmitted   },
  'Completed':   { cls: 'doc-wf-badge--completed',   Icon: IconCompleted   },
}

/* ── Badge components ── */
export function DocStatusBadge({ expiryDate }) {
  const status = getSmartStatus(expiryDate)
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG[STATUS.OK]
  return (
    <span className={`doc-badge ${cfg.cls}`}>
      <cfg.Icon />
      {cfg.label}
    </span>
  )
}

export function DocWorkflowBadge({ status }) {
  const cfg = WORKFLOW_CONFIG[status] || WORKFLOW_CONFIG['Pending']
  return (
    <span className={`doc-wf-badge ${cfg.cls}`}>
      <cfg.Icon />
      {status || 'Pending'}
    </span>
  )
}

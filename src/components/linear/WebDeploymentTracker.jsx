/**
 * WebDeploymentTracker
 *
 * Website & backend deployment tracking for lifesmile.ae releases.
 * Shared data persisted to backend (Phase 14A). Falls back to localStorage on API error.
 * Does NOT execute deploys, call AWS, or expose credentials.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Server, Plus, Edit2, Trash2, ChevronDown, ChevronUp,
  Check, Copy, X, AlertTriangle, Link, ExternalLink, Globe, WifiOff,
} from 'lucide-react'
import { normalizeStatus, issueKey } from './IssueRow'
import WorkspaceMigrationBanner from './WorkspaceMigrationBanner'
import {
  listDeploymentsApi, createDeploymentApi, updateDeploymentApi, deleteDeploymentApi,
  isMigrated, markMigrated,
} from '../../lib/linearWorkspaceApi'
import './WebDeploymentTracker.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lifesmile.linear.webDeployments.v1'

const DEPLOY_TYPES = ['Frontend', 'Backend', 'Full Stack', 'Config/Env', 'Database']
const ENVIRONMENTS = ['Staging', 'Production']
const STATUSES = [
  { value: 'Planning',    color: '#6b7280', bg: '#f9fafb'  },
  { value: 'Ready',       color: '#2563eb', bg: '#eff6ff'  },
  { value: 'Deploying',   color: '#d97706', bg: '#fffbeb'  },
  { value: 'Deployed',    color: '#7c3aed', bg: '#f5f3ff'  },
  { value: 'Verified',    color: '#059669', bg: '#ecfdf5'  },
  { value: 'Rolled Back', color: '#dc2626', bg: '#fef2f2'  },
  { value: 'Failed',      color: '#dc2626', bg: '#fef2f2'  },
]
const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.value, s]))

const FRONTEND_CHECKLIST = [
  { id: 'build_passed',        label: 'Build passed (npm run build / CI)'               },
  { id: 's3_sync',             label: 'S3 sync completed'                                },
  { id: 'cf_invalidation',     label: 'CloudFront invalidation created'                  },
  { id: 'homepage_smoke',      label: 'Homepage smoke test — loads, no console errors'   },
  { id: 'product_smoke',       label: 'Product page smoke test'                          },
  { id: 'search_smoke',        label: 'Search smoke test'                                },
  { id: 'cart_smoke',          label: 'Cart smoke test'                                  },
  { id: 'checkout_smoke',      label: 'Checkout flow smoke test'                         },
  { id: 'mobile_smoke',        label: 'Mobile responsive smoke test (375px)'             },
]

const BACKEND_CHECKLIST = [
  { id: 'build_passed',        label: 'Backend build / lint / check passed'              },
  { id: 'service_restarted',   label: 'Service restarted / redeployed'                   },
  { id: 'health_ok',           label: '/api/health returns 200 OK'                       },
  { id: 'logs_checked',        label: 'Logs checked — no unexpected errors'              },
  { id: 'auth_smoke',          label: 'Auth / login API smoke test'                      },
  { id: 'api_smoke',           label: 'Critical API endpoints smoke test'                },
  { id: 'no_5xx',              label: 'No 5xx spike observed in logs/monitor'            },
]

const DATABASE_CHECKLIST = [
  { id: 'migration_reviewed',  label: 'Migration script reviewed'                        },
  { id: 'idempotent',          label: 'Migration is idempotent (IF NOT EXISTS / safe)'   },
  { id: 'backup_considered',   label: 'Backup / snapshot created or considered'          },
  { id: 'rollback_plan',       label: 'Rollback plan documented'                         },
  { id: 'post_migration',      label: 'Post-migration smoke test passed'                 },
]

const CONFIG_CHECKLIST = [
  { id: 'env_reviewed',        label: 'Env vars / config reviewed'                       },
  { id: 'secrets_safe',        label: 'Secrets not hardcoded or exposed'                 },
  { id: 'service_restarted',   label: 'Service restarted after config change'            },
  { id: 'feature_tested',      label: 'Config-dependent feature tested end-to-end'       },
]

const ALL_CHECKLIST_KEYS = {
  frontend: FRONTEND_CHECKLIST,
  backend:  BACKEND_CHECKLIST,
  database: DATABASE_CHECKLIST,
  config:   CONFIG_CHECKLIST,
}

function checklistsForType(deployType) {
  switch (deployType) {
    case 'Frontend':   return [{ key: 'frontend', list: FRONTEND_CHECKLIST }]
    case 'Backend':    return [{ key: 'backend',  list: BACKEND_CHECKLIST  }]
    case 'Full Stack': return [{ key: 'frontend', list: FRONTEND_CHECKLIST }, { key: 'backend', list: BACKEND_CHECKLIST }]
    case 'Database':   return [{ key: 'database', list: DATABASE_CHECKLIST  }]
    case 'Config/Env': return [{ key: 'config',   list: CONFIG_CHECKLIST   }]
    default:           return [{ key: 'frontend', list: FRONTEND_CHECKLIST }]
  }
}

// ── Storage helpers (localStorage fallback / migration cache) ─────────────────

function loadDeployments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data?.deployments) ? data.deployments : []
  } catch { return [] }
}

function saveDeployments(deployments) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ deployments })) } catch { /* ignore */ }
}

// ── Backend ↔ frontend field normalizers ──────────────────────────────────────

function normalizeDeployment(row) {
  if (!row) return null
  return {
    id:             row.id,
    name:           row.name || '',
    deployType:     row.deployment_type || row.deployType || 'Frontend',
    environment:    row.environment || 'Production',
    status:         row.status || 'Planning',
    targetDate:     row.target_date ? row.target_date.split('T')[0] : (row.targetDate || ''),
    startedAt:      row.started_at  || row.startedAt  || '',
    deployedAt:     row.deployed_at || row.deployedAt || '',
    verifiedAt:     row.verified_at || row.verifiedAt || '',
    deployedBy:     row.deployed_by || row.deployedBy || '',
    verifiedBy:     row.verified_by || row.verifiedBy || '',
    notes:          row.notes           || '',
    rollbackNotes:  row.rollback_notes  || row.rollbackNotes || '',
    linkedIssueIds: row.linked_issue_ids || row.linkedIssueIds || [],
    checklist:      row.checklist || {},
  }
}

function denormalizeDeployment(d) {
  return {
    name:             d.name,
    deployment_type:  d.deployType || '',
    environment:      d.environment || '',
    status:           d.status,
    target_date:      d.targetDate  || null,
    started_at:       d.startedAt   || null,
    deployed_at:      d.deployedAt  || null,
    verified_at:      d.verifiedAt  || null,
    notes:            d.notes         || '',
    rollback_notes:   d.rollbackNotes || '',
    linked_issue_ids: d.linkedIssueIds || [],
    checklist:        d.checklist || {},
  }
}

function defaultChecklist() {
  return {
    frontend: Object.fromEntries(FRONTEND_CHECKLIST.map((i) => [i.id, false])),
    backend:  Object.fromEntries(BACKEND_CHECKLIST.map((i)  => [i.id, false])),
    database: Object.fromEntries(DATABASE_CHECKLIST.map((i) => [i.id, false])),
    config:   Object.fromEntries(CONFIG_CHECKLIST.map((i)   => [i.id, false])),
  }
}

function newDeployment(overrides = {}) {
  return {
    id:             `wd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name:           '',
    deployType:     'Frontend',
    environment:    'Production',
    status:         'Planning',
    targetDate:     '',
    startedAt:      '',
    deployedAt:     '',
    verifiedAt:     '',
    deployedBy:     '',
    verifiedBy:     '',
    notes:          '',
    rollbackNotes:  '',
    linkedIssueIds: [],
    checklist:      defaultChecklist(),
    createdAt:      new Date().toISOString(),
    ...overrides,
  }
}

// ── Copy text builders ────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return d }
}

function checklistText(title, items, values) {
  const lines = [`## ${title}`]
  for (const item of items) {
    lines.push(`${values?.[item.id] ? '[x]' : '[ ]'} ${item.label}`)
  }
  return lines.join('\n')
}

function buildFrontendChecklist(dep) {
  return [
    `# Frontend Deploy Checklist — ${dep.name || 'Unnamed'}`,
    `Environment: ${dep.environment}  |  Status: ${dep.status}`,
    `Date: ${fmtDate(dep.deployedAt) || fmtDate(dep.targetDate)}`,
    '',
    checklistText('Frontend Deployment', FRONTEND_CHECKLIST, dep.checklist?.frontend),
  ].join('\n')
}

function buildBackendChecklist(dep) {
  return [
    `# Backend Deploy Checklist — ${dep.name || 'Unnamed'}`,
    `Environment: ${dep.environment}  |  Status: ${dep.status}`,
    `Date: ${fmtDate(dep.deployedAt) || fmtDate(dep.targetDate)}`,
    '',
    checklistText('Backend Deployment', BACKEND_CHECKLIST, dep.checklist?.backend),
  ].join('\n')
}

function buildFullStackChecklist(dep) {
  return [
    `# Full Stack Deploy Checklist — ${dep.name || 'Unnamed'}`,
    `Environment: ${dep.environment}  |  Status: ${dep.status}`,
    `Date: ${fmtDate(dep.deployedAt) || fmtDate(dep.targetDate)}`,
    '',
    checklistText('Frontend', FRONTEND_CHECKLIST, dep.checklist?.frontend),
    '',
    checklistText('Backend', BACKEND_CHECKLIST, dep.checklist?.backend),
  ].join('\n')
}

function buildSmokeTestPlan(dep, linkedIssues, projectsMap) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const needsFront = ['Frontend', 'Full Stack'].includes(dep.deployType)
  const needsBack  = ['Backend', 'Full Stack'].includes(dep.deployType)
  const needsDB    = dep.deployType === 'Database'
  const lines = [
    `# Smoke Test Plan — ${dep.name || 'Unnamed'}`,
    `Date: ${date}  |  Environment: ${dep.environment}  |  Type: ${dep.deployType}`,
    '',
  ]
  if (needsFront) {
    lines.push('## Frontend / Web Smoke Tests')
    lines.push('- [ ] https://lifesmile.ae — homepage loads, no JS errors')
    lines.push('- [ ] Product listing page displays items correctly')
    lines.push('- [ ] Product detail page loads with images')
    lines.push('- [ ] Search returns results')
    lines.push('- [ ] Add to cart, cart count updates')
    lines.push('- [ ] Checkout page loads, payment step reachable')
    lines.push('- [ ] Login / account pages accessible')
    lines.push('- [ ] Mobile view at 375px renders correctly')
    lines.push('')
  }
  if (needsBack) {
    lines.push('## Backend / API Smoke Tests')
    lines.push('- [ ] GET /api/health → 200 OK')
    lines.push('- [ ] Auth endpoint returns token correctly')
    lines.push('- [ ] Product listing API returns data')
    lines.push('- [ ] Cart / order APIs respond correctly')
    lines.push('- [ ] No 5xx errors in server logs')
    lines.push('- [ ] Response times are within acceptable range')
    lines.push('')
  }
  if (needsDB) {
    lines.push('## Database / Migration Smoke Tests')
    lines.push('- [ ] Migration applied cleanly (no errors)')
    lines.push('- [ ] Key tables have expected data structure')
    lines.push('- [ ] Application functions that touch migrated tables still work')
    lines.push('- [ ] Rollback migration was tested on staging if needed')
    lines.push('')
  }
  if (dep.deployType === 'Config/Env') {
    lines.push('## Config/Env Smoke Tests')
    lines.push('- [ ] Affected features work end-to-end with new config')
    lines.push('- [ ] Env variables correctly loaded by service')
    lines.push('- [ ] No secrets exposed in logs or responses')
    lines.push('')
  }
  if (linkedIssues.length > 0) {
    lines.push('## Issue-Specific Checks')
    for (const iss of linkedIssues) {
      const key = issueKey(projectsMap[iss.projectId]?.name, iss.id)
      lines.push(`- [ ] ${key}: ${iss.title}`)
    }
  }
  return lines.join('\n').trim()
}

function buildRollbackPlan(dep, linkedIssues, projectsMap) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const prLinks = linkedIssues
    .filter((i) => i.devMeta?.prUrl)
    .map((i) => `  - ${issueKey(projectsMap[i.projectId]?.name, i.id)}: ${i.devMeta.prUrl}`)

  const lines = [
    `# Rollback Plan — ${dep.name || 'Unnamed'}`,
    `Environment: ${dep.environment}  |  Date: ${date}`,
    `Type: ${dep.deployType}`,
    '',
    '## If Deployment Fails or Issues Arise',
    '1. Stop the current deployment immediately if still in progress.',
    '2. Identify the failure point (logs, /api/health, frontend errors).',
    '3. Notify the team and product lead.',
    '',
    '## Rollback Steps',
  ]

  if (['Frontend', 'Full Stack'].includes(dep.deployType)) {
    lines.push('**Frontend:**')
    lines.push('- Revert CloudFront distribution to the previous S3 deployment.')
    lines.push('- Or re-run the previous successful deploy pipeline.')
    lines.push('- Create a new CloudFront invalidation after rollback.')
    lines.push('')
  }
  if (['Backend', 'Full Stack'].includes(dep.deployType)) {
    lines.push('**Backend:**')
    lines.push('- Restart service with the previous build / Docker image tag.')
    lines.push('- Or run `git revert` on the relevant commits and redeploy.')
    lines.push('- Verify /api/health returns 200 after rollback.')
    lines.push('')
  }
  if (dep.deployType === 'Database') {
    lines.push('**Database:**')
    lines.push('- Run the reverse migration script if safe and idempotent.')
    lines.push('- If not safe to reverse, restore from pre-migration snapshot.')
    lines.push('- Verify application tables have expected structure after rollback.')
    lines.push('')
  }
  if (dep.deployType === 'Config/Env') {
    lines.push('**Config/Env:**')
    lines.push('- Revert env vars to previous values in config store.')
    lines.push('- Restart service to pick up reverted config.')
    lines.push('')
  }

  lines.push('## Verify Rollback')
  lines.push('- Run smoke tests after rollback to confirm stability.')
  lines.push('- Confirm no user-facing errors before announcing rollback complete.')
  lines.push('')

  if (dep.rollbackNotes) {
    lines.push('## Documented Rollback Notes')
    lines.push(dep.rollbackNotes)
    lines.push('')
  }

  if (prLinks.length > 0) {
    lines.push('## PR Links (for reverting)')
    lines.push(...prLinks)
  }

  return lines.join('\n').trim()
}

function buildDeploymentSummary(dep, linkedIssues, projectsMap) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const cl = dep.checklist || {}

  const allItems = checklistsForType(dep.deployType).flatMap(({ key, list }) =>
    list.map((item) => ({ done: !!cl[key]?.[item.id], label: item.label }))
  )
  const doneCount  = allItems.filter((i) => i.done).length
  const totalCount = allItems.length

  const lines = [
    `# Deployment Summary — ${dep.name || 'Unnamed'}`,
    `Date: ${date}`,
    `Type: ${dep.deployType}  |  Environment: ${dep.environment}  |  Status: ${dep.status}`,
    dep.deployedBy ? `Deployed by: ${dep.deployedBy}` : null,
    dep.verifiedBy ? `Verified by: ${dep.verifiedBy}` : null,
    dep.deployedAt  ? `Deployed at: ${fmtDate(dep.deployedAt)}`  : null,
    dep.verifiedAt  ? `Verified at: ${fmtDate(dep.verifiedAt)}`  : null,
    '',
    '## Included Issues',
    ...linkedIssues.map((iss) => {
      const key = issueKey(projectsMap[iss.projectId]?.name, iss.id)
      const qa  = iss.devMeta?.qaApproval?.approved ? 'QA ✓' : 'QA ?'
      const pr  = iss.devMeta?.prStatus ? `PR:${iss.devMeta.prStatus}` : ''
      return `- [${qa}] **${key}**: ${iss.title}${pr ? `  (${pr})` : ''}`
    }),
    '',
    '## PR Links',
    ...linkedIssues
      .filter((i) => i.devMeta?.prUrl)
      .map((i) => `- ${issueKey(projectsMap[i.projectId]?.name, i.id)}: ${i.devMeta.prUrl}`),
    '',
    `## Deployment Checklist  (${doneCount}/${totalCount} completed)`,
    ...allItems.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.label}`),
    '',
    '## Notes',
    dep.notes || '—',
  ].filter((l) => l !== null)

  if (dep.rollbackNotes) {
    lines.push('', '## Rollback Notes', dep.rollbackNotes)
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ label, getText }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    const text = typeof getText === 'function' ? getText() : getText
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;top:-9999px' })
        document.body.appendChild(ta); ta.select(); document.execCommand('copy')
        document.body.removeChild(ta)
      }
    } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button type="button" className={`wdt__copy-btn ${copied ? 'wdt__copy-btn--done' : ''}`} onClick={handle}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Checklist accordion ───────────────────────────────────────────────────────

function ChecklistSection({ title, items, values, onChange }) {
  const [open, setOpen] = useState(false)
  const done  = items.filter((i) => values?.[i.id]).length
  const total = items.length
  return (
    <div className="wdt__cl-section">
      <button type="button" className="wdt__cl-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {title}
        <span className="wdt__cl-progress" data-done={done === total ? 'all' : done > 0 ? 'partial' : 'none'}>
          {done}/{total}
        </span>
      </button>
      {open && (
        <div className="wdt__cl-items">
          {items.map((item) => (
            <label key={item.id} className="wdt__cl-item">
              <input
                type="checkbox"
                className="wdt__cl-check"
                checked={!!values?.[item.id]}
                onChange={(e) => onChange(item.id, e.target.checked)}
              />
              <span className={values?.[item.id] ? 'wdt__cl-item-done' : ''}>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Deployment card ───────────────────────────────────────────────────────────

function DeploymentCard({ dep, allIssues, projectsMap, onEdit, onDelete, onChecklistChange }) {
  const [expanded,   setExpanded]   = useState(false)
  const [delConfirm, setDelConfirm] = useState(false)

  const sc = STATUS_MAP[dep.status] || STATUSES[0]
  const linkedIssues = useMemo(
    () => (dep.linkedIssueIds || []).map((id) => allIssues.find((i) => i.id === id)).filter(Boolean),
    [dep.linkedIssueIds, allIssues]
  )

  const sections = checklistsForType(dep.deployType)
  const totalDone  = sections.reduce((sum, { key, list }) => sum + list.filter((i) => dep.checklist?.[key]?.[i.id]).length, 0)
  const totalItems = sections.reduce((sum, { list }) => sum + list.length, 0)

  const prLinks = linkedIssues.filter((i) => i.devMeta?.prUrl)

  return (
    <div className="wdt__card">
      {/* Header */}
      <div className="wdt__card-header">
        <div className="wdt__card-header-left">
          <span className="wdt__status-badge" style={{ '--sc': sc.color, '--scbg': sc.bg }}>{dep.status}</span>
          <span className={`wdt__type-badge wdt__type-badge--${dep.deployType.toLowerCase().replace(/[^a-z]/g, '-')}`}>{dep.deployType}</span>
          <span className="wdt__env-badge" data-env={dep.environment.toLowerCase()}>{dep.environment}</span>
          <span className="wdt__card-name">{dep.name || 'Unnamed Deployment'}</span>
        </div>
        <div className="wdt__card-header-right">
          <button type="button" className="wdt__icon-btn" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button type="button" className="wdt__icon-btn" onClick={() => onEdit(dep)} aria-label="Edit">
            <Edit2 size={13} />
          </button>
          {!delConfirm ? (
            <button type="button" className="wdt__icon-btn wdt__icon-btn--del" onClick={() => setDelConfirm(true)} aria-label="Delete">
              <Trash2 size={13} />
            </button>
          ) : (
            <span className="wdt__del-confirm">
              Delete?
              <button type="button" className="wdt__del-yes" onClick={() => onDelete(dep.id)}>Yes</button>
              <button type="button" className="wdt__del-no"  onClick={() => setDelConfirm(false)}>No</button>
            </span>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="wdt__card-meta">
        {dep.targetDate  && <span className="wdt__meta-chip wdt__meta-chip--date">Target: {dep.targetDate}</span>}
        {dep.deployedAt  && <span className="wdt__meta-chip">Deployed: {dep.deployedAt}</span>}
        {dep.verifiedAt  && <span className="wdt__meta-chip wdt__meta-chip--ok">Verified: {dep.verifiedAt}</span>}
        {dep.deployedBy  && <span className="wdt__meta-chip">By: {dep.deployedBy}</span>}
        {linkedIssues.length > 0 && <span className="wdt__meta-chip"><Link size={10} /> {linkedIssues.length} issue{linkedIssues.length !== 1 ? 's' : ''}</span>}
        {prLinks.length  > 0 && <span className="wdt__meta-chip"><ExternalLink size={10} /> {prLinks.length} PR{prLinks.length !== 1 ? 's' : ''}</span>}
        <span className={`wdt__meta-chip ${totalDone === totalItems && totalItems > 0 ? 'wdt__meta-chip--ok' : ''}`}>
          ✓ {totalDone}/{totalItems} checklist
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="wdt__card-body">
          {/* Linked issues */}
          {linkedIssues.length > 0 && (
            <div className="wdt__linked-issues">
              <p className="wdt__body-label">Linked Issues</p>
              <div className="wdt__linked-list">
                {linkedIssues.map((iss) => {
                  const proj = projectsMap[iss.projectId]
                  const key  = issueKey(proj?.name, iss.id)
                  const qa   = iss.devMeta?.qaApproval?.approved
                  const st   = normalizeStatus(iss.status)
                  return (
                    <div key={iss.id} className="wdt__linked-item">
                      <span className="wdt__linked-key">{key}</span>
                      <span className="wdt__linked-title">{iss.title}</span>
                      <span className={`wdt__linked-chip ${qa ? 'wdt__linked-chip--qa' : 'wdt__linked-chip--qa-no'}`}>
                        {qa ? 'QA ✓' : 'QA?'}
                      </span>
                      <span className="wdt__linked-status">{st}</span>
                      {iss.devMeta?.prStatus && (
                        <span className="wdt__linked-chip wdt__linked-chip--pr">PR:{iss.devMeta.prStatus}</span>
                      )}
                      {iss.devMeta?.prUrl && (
                        <a href={iss.devMeta.prUrl} target="_blank" rel="noopener noreferrer" className="wdt__pr-link" onClick={(e) => e.stopPropagation()} title={iss.devMeta.prUrl}>
                          <ExternalLink size={10} /> PR
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {dep.notes && (
            <div className="wdt__notes-section">
              <p className="wdt__body-label">Notes</p>
              <p className="wdt__notes-text">{dep.notes}</p>
            </div>
          )}
          {dep.rollbackNotes && (
            <div className="wdt__notes-section">
              <p className="wdt__body-label">Rollback Notes</p>
              <p className="wdt__notes-text wdt__notes-text--rollback">{dep.rollbackNotes}</p>
            </div>
          )}

          {/* Checklists */}
          {sections.map(({ key, list }) => (
            <ChecklistSection
              key={key}
              title={key.charAt(0).toUpperCase() + key.slice(1) + ' Checklist'}
              items={list}
              values={dep.checklist?.[key]}
              onChange={(itemId, checked) => onChecklistChange(dep.id, key, itemId, checked)}
            />
          ))}

          {/* Copy helpers */}
          <div className="wdt__card-copy">
            {['Frontend', 'Full Stack'].includes(dep.deployType) && (
              <CopyBtn label="Frontend Checklist" getText={() => buildFrontendChecklist(dep)} />
            )}
            {['Backend', 'Full Stack'].includes(dep.deployType) && (
              <CopyBtn label="Backend Checklist" getText={() => buildBackendChecklist(dep)} />
            )}
            {dep.deployType === 'Full Stack' && (
              <CopyBtn label="Full Stack Checklist" getText={() => buildFullStackChecklist(dep)} />
            )}
            <CopyBtn label="Smoke Test Plan"       getText={() => buildSmokeTestPlan(dep, linkedIssues, projectsMap)} />
            <CopyBtn label="Rollback Plan"         getText={() => buildRollbackPlan(dep, linkedIssues, projectsMap)} />
            <CopyBtn label="Deployment Summary"    getText={() => buildDeploymentSummary(dep, linkedIssues, projectsMap)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function DeploymentModal({ deployment, allIssues, projectsMap, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ ...deployment }))
  const [issueSearch, setIssueSearch] = useState('')
  const nameRef = useRef(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const patch = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const toggleIssue = (issueId) => {
    setForm((f) => {
      const linked = f.linkedIssueIds || []
      return {
        ...f,
        linkedIssueIds: linked.includes(issueId)
          ? linked.filter((id) => id !== issueId)
          : [...linked, issueId],
      }
    })
  }

  const filteredIssues = useMemo(() => {
    const q = issueSearch.toLowerCase()
    return allIssues.filter((i) => {
      if (!q) return true
      const key = issueKey(projectsMap[i.projectId]?.name, i.id).toLowerCase()
      return key.includes(q) || (i.title || '').toLowerCase().includes(q)
    }).slice(0, 50)
  }, [allIssues, projectsMap, issueSearch])

  const handleSubmit = (e) => { e.preventDefault(); onSave(form) }

  return createPortal(
    <div className="wdt__overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wdt__modal" role="dialog" aria-modal="true" aria-label="Deployment">
        <div className="wdt__modal-header">
          <h2 className="wdt__modal-title">
            <Server size={15} />
            {deployment.id && deployment.name ? `Edit: ${deployment.name}` : 'New Deployment'}
          </h2>
          <button type="button" className="wdt__modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <form className="wdt__modal-body" onSubmit={handleSubmit}>
          <div className="wdt__modal-grid">

            {/* Name */}
            <div className="wdt__mfield wdt__mfield--full">
              <label className="wdt__mlabel">Deployment Name *</label>
              <input
                ref={nameRef}
                required
                className="wdt__minput"
                type="text"
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="e.g. Website Checkout Fix Deploy — May 2026"
              />
            </div>

            {/* Type + Status */}
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Deployment Type</label>
              <select className="wdt__mselect" value={form.deployType} onChange={(e) => patch('deployType', e.target.value)}>
                {DEPLOY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Status</label>
              <select className="wdt__mselect" value={form.status} onChange={(e) => patch('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
              </select>
            </div>

            {/* Environment */}
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Environment</label>
              <select className="wdt__mselect" value={form.environment} onChange={(e) => patch('environment', e.target.value)}>
                {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>

            {/* Target date */}
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Target Date</label>
              <input className="wdt__minput" type="date" value={form.targetDate} onChange={(e) => patch('targetDate', e.target.value)} />
            </div>

            {/* Started / deployed / verified */}
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Started At</label>
              <input className="wdt__minput" type="date" value={form.startedAt} onChange={(e) => patch('startedAt', e.target.value)} />
            </div>
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Deployed At</label>
              <input className="wdt__minput" type="date" value={form.deployedAt} onChange={(e) => patch('deployedAt', e.target.value)} />
            </div>
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Verified At</label>
              <input className="wdt__minput" type="date" value={form.verifiedAt} onChange={(e) => patch('verifiedAt', e.target.value)} />
            </div>

            {/* Personnel */}
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Deployed By</label>
              <input className="wdt__minput" type="text" value={form.deployedBy} onChange={(e) => patch('deployedBy', e.target.value)} placeholder="Name or handle" />
            </div>
            <div className="wdt__mfield">
              <label className="wdt__mlabel">Verified By</label>
              <input className="wdt__minput" type="text" value={form.verifiedBy} onChange={(e) => patch('verifiedBy', e.target.value)} placeholder="Name or handle" />
            </div>

            {/* Notes */}
            <div className="wdt__mfield wdt__mfield--full">
              <label className="wdt__mlabel">Notes</label>
              <textarea className="wdt__mtextarea" rows={3} value={form.notes} onChange={(e) => patch('notes', e.target.value)} placeholder="Deploy steps, risks, env vars to update…" />
            </div>

            {/* Rollback notes */}
            <div className="wdt__mfield wdt__mfield--full">
              <label className="wdt__mlabel">Rollback Notes</label>
              <textarea className="wdt__mtextarea" rows={2} value={form.rollbackNotes} onChange={(e) => patch('rollbackNotes', e.target.value)} placeholder="How to rollback if deploy fails…" />
            </div>

            {/* Link issues */}
            <div className="wdt__mfield wdt__mfield--full">
              <label className="wdt__mlabel">
                Link Issues
                <span className="wdt__mlabel-count">{form.linkedIssueIds?.length || 0} linked</span>
              </label>
              <input
                className="wdt__minput"
                type="text"
                value={issueSearch}
                onChange={(e) => setIssueSearch(e.target.value)}
                placeholder="Search issues by key or title…"
              />
              <div className="wdt__issue-picker">
                {filteredIssues.map((iss) => {
                  const proj   = projectsMap[iss.projectId]
                  const key    = issueKey(proj?.name, iss.id)
                  const linked = (form.linkedIssueIds || []).includes(iss.id)
                  return (
                    <label key={iss.id} className={`wdt__issue-row ${linked ? 'wdt__issue-row--linked' : ''}`}>
                      <input type="checkbox" className="wdt__issue-check" checked={linked} onChange={() => toggleIssue(iss.id)} />
                      <span className="wdt__issue-key">{key}</span>
                      <span className="wdt__issue-title">{iss.title}</span>
                      <span className="wdt__issue-st">{normalizeStatus(iss.status)}</span>
                    </label>
                  )
                })}
                {allIssues.length === 0 && <p className="wdt__issue-empty">No issues loaded yet.</p>}
              </div>
            </div>
          </div>

          <div className="wdt__modal-footer">
            <button type="button" className="wdt__modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="wdt__modal-save">
              <Check size={13} /> Save Deployment
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   allIssues: object[],
 *   selectedIssues: object[],
 *   projectsMap: Record<string, object>,
 * }} props
 */
export function WebDeploymentTracker({ allIssues, selectedIssues, projectsMap }) {
  const [deployments,  setDeployments]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [backendError, setBackendError] = useState(false)
  const [showMigration,setShowMigration]= useState(false)
  const [modalDeploy,  setModalDeploy]  = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType,   setFilterType]   = useState('all')
  const [collapsed,    setCollapsed]    = useState(false)

  // Load from backend on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listDeploymentsApi()
        if (cancelled) return
        const normalized = (rows || []).map(normalizeDeployment)
        setDeployments(normalized)
        saveDeployments(normalized)
        if (normalized.length === 0 && !isMigrated()) {
          const local = loadDeployments()
          if (local?.length > 0) setShowMigration(true)
        }
      } catch (err) {
        if (cancelled) return
        console.error('[WebDeploymentTracker] backend load failed:', err)
        setBackendError(true)
        setDeployments(loadDeployments())
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    const detectedType = detectDeployType(selectedIssues, projectsMap)
    setModalDeploy(newDeployment({
      deployType:     detectedType,
      linkedIssueIds: selectedIssues.map((i) => i.id),
    }))
  }, [selectedIssues, projectsMap])

  const handleEdit = useCallback((dep) => { setModalDeploy({ ...dep }) }, [])

  const handleSave = useCallback(async (form) => {
    const isLocalId = !form.id || (typeof form.id === 'string' && form.id.startsWith('wd-'))
    try {
      let result
      if (isLocalId) {
        result = normalizeDeployment(await createDeploymentApi(denormalizeDeployment(form)))
      } else {
        result = normalizeDeployment(await updateDeploymentApi(form.id, denormalizeDeployment(form)))
      }
      setDeployments((prev) => {
        const idx = prev.findIndex((d) => d.id === form.id)
        const next = idx === -1 ? [...prev, result] : prev.map((d, i) => i === idx ? result : d)
        saveDeployments(next)
        return next
      })
    } catch (err) {
      console.error('[WebDeploymentTracker] save failed, using local fallback:', err)
      setDeployments((prev) => {
        const idx = prev.findIndex((d) => d.id === form.id)
        const next = idx === -1 ? [...prev, form] : prev.map((d, i) => i === idx ? { ...d, ...form } : d)
        saveDeployments(next)
        return next
      })
    }
    setModalDeploy(null)
  }, [])

  const handleDelete = useCallback(async (id) => {
    const isLocalId = typeof id === 'string'
    if (!isLocalId) {
      try { await deleteDeploymentApi(id) } catch (err) {
        console.error('[WebDeploymentTracker] delete failed:', err)
      }
    }
    setDeployments((prev) => {
      const next = prev.filter((d) => d.id !== id)
      saveDeployments(next)
      return next
    })
  }, [])

  const handleChecklistChange = useCallback((depId, clKey, itemId, checked) => {
    setDeployments((prev) => {
      const next = prev.map((d) => {
        if (d.id !== depId) return d
        const updated = {
          ...d,
          checklist: {
            ...d.checklist,
            [clKey]: { ...(d.checklist?.[clKey] || {}), [itemId]: checked },
          },
        }
        const isLocalId = typeof d.id === 'string'
        if (!isLocalId) {
          updateDeploymentApi(d.id, { checklist: updated.checklist }).catch(() => {})
        }
        return updated
      })
      saveDeployments(next)
      return next
    })
  }, [])

  const handleMigrateLocal = async () => {
    const local = loadDeployments()
    if (!local?.length) return true
    try {
      const results = await Promise.all(
        local.map(d => createDeploymentApi(denormalizeDeployment(d)).then(normalizeDeployment))
      )
      setDeployments(results)
      saveDeployments(results)
      markMigrated()
      setShowMigration(false)
      return true
    } catch { return false }
  }

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return deployments.filter((d) => {
      if (filterStatus !== 'all' && d.status     !== filterStatus) return false
      if (filterType   !== 'all' && d.deployType !== filterType)   return false
      return true
    }).sort((a, b) => {
      const ORDER = ['Deploying','Ready','Planning','Deployed','Verified','Rolled Back','Failed']
      return (ORDER.indexOf(a.status) + 99) % 99 - (ORDER.indexOf(b.status) + 99) % 99
    })
  }, [deployments, filterStatus, filterType])

  // ── Suggestion banner ──────────────────────────────────────────────────────
  const hasWebSelection = selectedIssues.some((i) => {
    const n = (projectsMap[i.projectId]?.name || '').toLowerCase()
    return n.includes('website') || n.includes('web') || n.includes('frontend') || n.includes('ux') || n.includes('ui') || n.includes('lifesmile')
  })
  const hasBackendSelection = selectedIssues.some((i) => {
    const n = (projectsMap[i.projectId]?.name || '').toLowerCase()
    return n.includes('backend') || n.includes('api') || n.includes('data') || n.includes('bi')
  })
  const showSuggest = selectedIssues.length > 0 && (hasWebSelection || hasBackendSelection)

  return (
    <div className="wdt">
      {/* Header */}
      <div className="wdt__header">
        <div className="wdt__header-left">
          <Globe size={15} className="wdt__header-icon" />
          <span className="wdt__header-title">Website & Backend Deployments</span>
          {deployments.length > 0 && (
            <span className="wdt__header-count">{deployments.length}</span>
          )}
          {backendError && (
            <span className="wdt__offline-badge" title="Using local data — backend unavailable">
              <WifiOff size={11} /> Local
            </span>
          )}
        </div>
        <div className="wdt__header-right">
          <button type="button" className="wdt__new-btn" onClick={handleNew}>
            <Plus size={13} /> New Deployment
          </button>
          <button
            type="button"
            className="wdt__collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Migration banner */}
          {showMigration && (
            <WorkspaceMigrationBanner
              localItemCount={loadDeployments().length}
              resourceLabel="deployments"
              onImport={handleMigrateLocal}
              onDismiss={() => { markMigrated(); setShowMigration(false) }}
            />
          )}

          {/* Suggestion banner */}
          {showSuggest && (
            <div className="wdt__suggest-banner">
              <Server size={13} />
              <span>
                You have {hasWebSelection && hasBackendSelection ? 'frontend & backend' : hasWebSelection ? 'frontend' : 'backend'} issues selected.
              </span>
              <button type="button" className="wdt__suggest-btn" onClick={handleNew}>
                Create Deployment from Selection
              </button>
            </div>
          )}

          {/* Filters */}
          {deployments.length > 0 && (
            <div className="wdt__filters">
              <select className="wdt__filter-select" value={filterType}   onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">All Types</option>
                {DEPLOY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="wdt__filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
              </select>
            </div>
          )}

          {/* List */}
          {filtered.length === 0 ? (
            <div className="wdt__empty">
              <Globe size={28} className="wdt__empty-icon" />
              <p>No deployments yet.</p>
              <p>Create a deployment to track frontend, backend, or database releases for lifesmile.ae.</p>
              <button type="button" className="wdt__new-btn" onClick={handleNew}>
                <Plus size={13} /> New Deployment
              </button>
            </div>
          ) : (
            <div className="wdt__list">
              {filtered.map((dep) => (
                <DeploymentCard
                  key={dep.id}
                  dep={dep}
                  allIssues={allIssues}
                  projectsMap={projectsMap}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onChecklistChange={handleChecklistChange}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modalDeploy && (
        <DeploymentModal
          deployment={modalDeploy}
          allIssues={allIssues}
          projectsMap={projectsMap}
          onSave={handleSave}
          onClose={() => setModalDeploy(null)}
        />
      )}
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function detectDeployType(issues, projectsMap) {
  const names = issues.map((i) => (projectsMap[i.projectId]?.name || '').toLowerCase())
  const hasFront = names.some((n) => n.includes('website') || n.includes('web') || n.includes('frontend') || n.includes('ux') || n.includes('ui') || n.includes('lifesmile'))
  const hasBack  = names.some((n) => n.includes('backend') || n.includes('api'))
  if (hasFront && hasBack) return 'Full Stack'
  if (hasBack)             return 'Backend'
  return 'Frontend'
}

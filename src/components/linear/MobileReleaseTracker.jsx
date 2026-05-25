/**
 * MobileReleaseTracker
 *
 * Mobile release tracking for Android and iOS app releases.
 * Shared data persisted to backend (Phase 14A). Falls back to localStorage on API error.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Smartphone, Plus, Edit2, Trash2, ChevronDown, ChevronUp,
  Check, Copy, X, AlertTriangle, CheckSquare, Square,
  ExternalLink, Link, WifiOff,
} from 'lucide-react'
import { normalizeStatus, issueKey } from './IssueRow'
import WorkspaceMigrationBanner from './WorkspaceMigrationBanner'
import {
  listMobileReleasesApi, createMobileReleaseApi, updateMobileReleaseApi, deleteMobileReleaseApi,
  isMigrated, markMigrated,
} from '../../lib/linearWorkspaceApi'
import './MobileReleaseTracker.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lifesmile.linear.mobileReleases.v1'

const PLATFORMS = ['Android', 'iOS', 'Both']

const STATUSES = [
  { value: 'Planning',    color: '#6b7280', bg: '#f9fafb' },
  { value: 'In QA',       color: '#d97706', bg: '#fffbeb' },
  { value: 'Submitted',   color: '#2563eb', bg: '#eff6ff' },
  { value: 'In Review',   color: '#4f46e5', bg: '#eef2ff' },
  { value: 'Approved',    color: '#7c3aed', bg: '#f5f3ff' },
  { value: 'Released',    color: '#059669', bg: '#ecfdf5' },
  { value: 'Rejected',    color: '#dc2626', bg: '#fef2f2' },
]

const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.value, s]))

const ANDROID_CHECKLIST = [
  { id: 'version_code',     label: 'Version code updated'                       },
  { id: 'version_name',     label: 'Version name updated'                       },
  { id: 'apk_aab',          label: 'APK/AAB generated successfully'              },
  { id: 'internal_testing', label: 'Internal testing build uploaded'             },
  { id: 'checkout',         label: 'Checkout flow tested'                        },
  { id: 'login',            label: 'Login tested'                                },
  { id: 'product_listing',  label: 'Product listing tested'                      },
  { id: 'push_deep_link',   label: 'Push / deep link tested (if relevant)'       },
  { id: 'store_listing',    label: 'Play Store listing checked'                  },
  { id: 'release_notes',    label: 'Release notes prepared'                      },
  { id: 'submitted',        label: 'Submitted to Play Console'                   },
  { id: 'released_prod',    label: 'Released to production'                      },
]

const IOS_CHECKLIST = [
  { id: 'build_number',     label: 'Build number updated'                        },
  { id: 'version',          label: 'Version updated'                             },
  { id: 'testflight',       label: 'TestFlight build uploaded'                   },
  { id: 'checkout',         label: 'Checkout flow tested'                        },
  { id: 'login',            label: 'Login tested'                                },
  { id: 'product_listing',  label: 'Product listing tested'                      },
  { id: 'push_deep_link',   label: 'Push / deep link tested (if relevant)'       },
  { id: 'screenshots',      label: 'App Store screenshots checked'               },
  { id: 'privacy',          label: 'Privacy / details checked'                   },
  { id: 'release_notes',    label: 'Release notes prepared'                      },
  { id: 'submitted',        label: 'Submitted to App Store Connect'              },
  { id: 'released_prod',    label: 'Released to production'                      },
]

const DEFAULT_CHECKLIST = () => ({
  android: Object.fromEntries(ANDROID_CHECKLIST.map((i) => [i.id, false])),
  ios:     Object.fromEntries(IOS_CHECKLIST.map((i)     => [i.id, false])),
})

// ── Storage helpers (localStorage fallback / migration cache) ─────────────────

function loadReleases() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data?.releases) ? data.releases : []
  } catch { return [] }
}

function saveReleases(releases) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ releases })) } catch { /* ignore */ }
}

// ── Backend ↔ frontend field normalizers ──────────────────────────────────────

function normalizeRelease(row) {
  if (!row) return null
  return {
    id:             row.id,
    name:           row.name || '',
    platform:       row.platform || 'Android',
    version:        row.version_number || row.version || '',
    buildNumber:    row.build_number || row.buildNumber || '',
    status:         row.status || 'Planning',
    targetDate:     row.target_date ? row.target_date.split('T')[0] : (row.targetDate || ''),
    submittedAt:    row.submitted_at || row.submittedAt || '',
    releasedAt:     row.released_at || row.releasedAt || '',
    notes:          row.notes || '',
    storeLinks:     row.store_links || row.storeLinks || {},
    linkedIssueIds: row.linked_issue_ids || row.linkedIssueIds || [],
    checklist:      row.checklist || {},
  }
}

function denormalizeRelease(r) {
  return {
    name:             r.name,
    platform:         r.platform,
    version_number:   r.version || '',
    build_number:     r.buildNumber || '',
    status:           r.status,
    target_date:      r.targetDate || null,
    submitted_at:     r.submittedAt || null,
    released_at:      r.releasedAt || null,
    notes:            r.notes || '',
    store_links:      r.storeLinks || {},
    linked_issue_ids: r.linkedIssueIds || [],
    checklist:        r.checklist || {},
  }
}

function newRelease(overrides = {}) {
  return {
    id:             `mr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name:           '',
    platform:       'Android',
    version:        '',
    buildNumber:    '',
    status:         'Planning',
    targetDate:     '',
    submittedAt:    '',
    releasedAt:     '',
    notes:          '',
    linkedIssueIds: [],
    playStoreLink:  '',
    appStoreLink:   '',
    checklist:      DEFAULT_CHECKLIST(),
    createdAt:      new Date().toISOString(),
    ...overrides,
  }
}

// ── Copy text builders ────────────────────────────────────────────────────────

function buildAndroidChecklist(release) {
  const lines = [
    `# Android Release Checklist — ${release.name || 'Unnamed'}`,
    `Version: ${release.version || '—'}  |  Build: ${release.buildNumber || '—'}`,
    `Status: ${release.status}`,
    '',
  ]
  for (const item of ANDROID_CHECKLIST) {
    const done = release.checklist?.android?.[item.id]
    lines.push(`${done ? '[x]' : '[ ]'} ${item.label}`)
  }
  return lines.join('\n')
}

function buildIOSChecklist(release) {
  const lines = [
    `# iOS Release Checklist — ${release.name || 'Unnamed'}`,
    `Version: ${release.version || '—'}  |  Build: ${release.buildNumber || '—'}`,
    `Status: ${release.status}`,
    '',
  ]
  for (const item of IOS_CHECKLIST) {
    const done = release.checklist?.ios?.[item.id]
    lines.push(`${done ? '[x]' : '[ ]'} ${item.label}`)
  }
  return lines.join('\n')
}

function buildStoreReleaseNotes(release, linkedIssues, projectsMap) {
  const lines = [
    `# ${release.platform} Release Notes — ${release.name || 'Unnamed'}`,
    `Version ${release.version || '—'} (${release.buildNumber || '—'})`,
    `Released: ${release.releasedAt || release.targetDate || '—'}`,
    '',
    '## What Changed',
    release.notes ? release.notes : '—',
    '',
    '## Bug Fixes',
    ...linkedIssues.filter((i) => (i.issueType || '').toLowerCase() === 'bug')
      .map((i) => `- ${issueKey(projectsMap[i.projectId]?.name, i.id)}: ${i.title}`),
    '',
    '## Improvements',
    ...linkedIssues.filter((i) => (i.issueType || '').toLowerCase() !== 'bug')
      .map((i) => `- ${issueKey(projectsMap[i.projectId]?.name, i.id)}: ${i.title}`),
    '',
    '## Linked Issues',
    ...linkedIssues.map((i) => {
      const key = issueKey(projectsMap[i.projectId]?.name, i.id)
      const qa  = i.devMeta?.qaApproval?.approved ? 'QA ✓' : 'QA ?'
      return `- [${qa}] ${key}: ${i.title}`
    }),
  ]
  if (release.playStoreLink) lines.push('', `Play Store: ${release.playStoreLink}`)
  if (release.appStoreLink)  lines.push(`App Store:  ${release.appStoreLink}`)
  return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function buildMobileQAHandoff(release, linkedIssues, projectsMap) {
  const needsAndroid = release.platform === 'Android' || release.platform === 'Both'
  const needsIOS     = release.platform === 'iOS'     || release.platform === 'Both'
  const lines = [
    `# Mobile QA Handoff — ${release.name || 'Unnamed'}`,
    `Platform: ${release.platform}  |  Version: ${release.version || '—'} (build ${release.buildNumber || '—'})`,
    `Status: ${release.status}  |  Target: ${release.targetDate || '—'}`,
    '',
    '## Issues to Verify',
    ...linkedIssues.map((i) => {
      const key = issueKey(projectsMap[i.projectId]?.name, i.id)
      const qa  = i.devMeta?.qaApproval?.approved ? '✓ QA Approved' : '⚠ QA Pending'
      const st  = normalizeStatus(i.status)
      return `- ${key}: ${i.title}  [${st}] [${qa}]`
    }),
    '',
  ]
  if (needsAndroid) {
    lines.push('## Android QA Checklist')
    for (const item of ANDROID_CHECKLIST) {
      const done = release.checklist?.android?.[item.id]
      lines.push(`${done ? '[x]' : '[ ]'} ${item.label}`)
    }
    lines.push('')
  }
  if (needsIOS) {
    lines.push('## iOS QA Checklist')
    for (const item of IOS_CHECKLIST) {
      const done = release.checklist?.ios?.[item.id]
      lines.push(`${done ? '[x]' : '[ ]'} ${item.label}`)
    }
    lines.push('')
  }
  if (release.playStoreLink) lines.push(`Play Store Console: ${release.playStoreLink}`)
  if (release.appStoreLink)  lines.push(`App Store Connect:  ${release.appStoreLink}`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ label, getText, size = 'sm' }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    const text = typeof getText === 'function' ? getText() : getText
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const ta = Object.assign(document.createElement('textarea'), {
          value: text, style: 'position:fixed;top:-9999px',
        })
        document.body.appendChild(ta); ta.select(); document.execCommand('copy')
        document.body.removeChild(ta)
      }
    } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      type="button"
      className={`mrt__copy-btn ${copied ? 'mrt__copy-btn--done' : ''}`}
      onClick={handle}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Checklist accordion ───────────────────────────────────────────────────────

function ChecklistSection({ title, items, values, onChange, platform }) {
  const [open, setOpen] = useState(false)
  const done  = items.filter((i) => values?.[i.id]).length
  const total = items.length
  return (
    <div className="mrt__cl-section">
      <button
        type="button"
        className="mrt__cl-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {title}
        <span className="mrt__cl-progress" data-done={done === total ? 'all' : done > 0 ? 'partial' : 'none'}>
          {done}/{total}
        </span>
      </button>
      {open && (
        <div className="mrt__cl-items">
          {items.map((item) => (
            <label key={item.id} className="mrt__cl-item">
              <input
                type="checkbox"
                className="mrt__cl-check"
                checked={!!values?.[item.id]}
                onChange={(e) => onChange(platform, item.id, e.target.checked)}
              />
              <span className={values?.[item.id] ? 'mrt__cl-item-done' : ''}>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Release card ──────────────────────────────────────────────────────────────

function MobileReleaseCard({
  release, allIssues, projectsMap, onEdit, onDelete, onChecklistChange,
}) {
  const [expanded,  setExpanded]  = useState(false)
  const [delConfirm, setDelConfirm] = useState(false)

  const sc = STATUS_MAP[release.status] || STATUSES[0]
  const linkedIssues = useMemo(
    () => (release.linkedIssueIds || []).map((id) => allIssues.find((i) => i.id === id)).filter(Boolean),
    [release.linkedIssueIds, allIssues]
  )

  const needsAndroid = release.platform === 'Android' || release.platform === 'Both'
  const needsIOS     = release.platform === 'iOS'     || release.platform === 'Both'
  const andDone      = needsAndroid ? ANDROID_CHECKLIST.filter((i) => release.checklist?.android?.[i.id]).length : 0
  const andTotal     = needsAndroid ? ANDROID_CHECKLIST.length : 0
  const iosDone      = needsIOS ? IOS_CHECKLIST.filter((i) => release.checklist?.ios?.[i.id]).length : 0
  const iosTotal     = needsIOS ? IOS_CHECKLIST.length : 0
  const checkDone    = andDone + iosDone
  const checkTotal   = andTotal + iosTotal

  return (
    <div className="mrt__card">
      {/* Card header */}
      <div className="mrt__card-header">
        <div className="mrt__card-header-left">
          <span
            className="mrt__status-badge"
            style={{ '--sc': sc.color, '--scbg': sc.bg }}
          >
            {release.status}
          </span>
          <span className="mrt__platform-badge" data-platform={release.platform.toLowerCase().replace(' ', '-')}>
            {release.platform}
          </span>
          <span className="mrt__card-name">{release.name || 'Unnamed Release'}</span>
        </div>
        <div className="mrt__card-header-right">
          <button
            type="button"
            className="mrt__icon-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button type="button" className="mrt__icon-btn" onClick={() => onEdit(release)} aria-label="Edit">
            <Edit2 size={13} />
          </button>
          {!delConfirm ? (
            <button type="button" className="mrt__icon-btn mrt__icon-btn--del" onClick={() => setDelConfirm(true)} aria-label="Delete">
              <Trash2 size={13} />
            </button>
          ) : (
            <span className="mrt__del-confirm">
              Delete?
              <button type="button" className="mrt__del-yes" onClick={() => onDelete(release.id)}>Yes</button>
              <button type="button" className="mrt__del-no"  onClick={() => setDelConfirm(false)}>No</button>
            </span>
          )}
        </div>
      </div>

      {/* Card meta row */}
      <div className="mrt__card-meta">
        {release.version && (
          <span className="mrt__meta-chip">v{release.version}{release.buildNumber ? ` (${release.buildNumber})` : ''}</span>
        )}
        {release.targetDate && (
          <span className="mrt__meta-chip mrt__meta-chip--date">Target: {release.targetDate}</span>
        )}
        {release.submittedAt && (
          <span className="mrt__meta-chip">Submitted: {release.submittedAt}</span>
        )}
        {release.releasedAt && (
          <span className="mrt__meta-chip mrt__meta-chip--released">Released: {release.releasedAt}</span>
        )}
        {linkedIssues.length > 0 && (
          <span className="mrt__meta-chip"><Link size={10} /> {linkedIssues.length} issue{linkedIssues.length !== 1 ? 's' : ''}</span>
        )}
        <span className={`mrt__meta-chip ${checkDone === checkTotal && checkTotal > 0 ? 'mrt__meta-chip--ok' : ''}`}>
          ✓ {checkDone}/{checkTotal} checklist
        </span>
        {release.playStoreLink && (
          <a href={release.playStoreLink} target="_blank" rel="noopener noreferrer" className="mrt__meta-link" onClick={(e) => e.stopPropagation()}>
            <ExternalLink size={10} /> Play Store
          </a>
        )}
        {release.appStoreLink && (
          <a href={release.appStoreLink} target="_blank" rel="noopener noreferrer" className="mrt__meta-link" onClick={(e) => e.stopPropagation()}>
            <ExternalLink size={10} /> App Store
          </a>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="mrt__card-body">
          {/* Linked issues */}
          {linkedIssues.length > 0 && (
            <div className="mrt__linked-issues">
              <p className="mrt__body-label">Linked Issues</p>
              <div className="mrt__linked-list">
                {linkedIssues.map((iss) => {
                  const proj = projectsMap[iss.projectId]
                  const key  = issueKey(proj?.name, iss.id)
                  const qa   = iss.devMeta?.qaApproval?.approved
                  const st   = normalizeStatus(iss.status)
                  return (
                    <div key={iss.id} className="mrt__linked-item">
                      <span className="mrt__linked-key">{key}</span>
                      <span className="mrt__linked-title">{iss.title}</span>
                      <span className={`mrt__linked-chip ${qa ? 'mrt__linked-chip--qa' : 'mrt__linked-chip--qa-no'}`}>
                        {qa ? 'QA ✓' : 'QA?'}
                      </span>
                      <span className="mrt__linked-status">{st}</span>
                      {iss.devMeta?.prStatus && (
                        <span className="mrt__linked-chip mrt__linked-chip--pr">PR:{iss.devMeta.prStatus}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {release.notes && (
            <div className="mrt__notes-section">
              <p className="mrt__body-label">Notes</p>
              <p className="mrt__notes-text">{release.notes}</p>
            </div>
          )}

          {/* Checklists */}
          {needsAndroid && (
            <ChecklistSection
              title="Android Checklist"
              items={ANDROID_CHECKLIST}
              values={release.checklist?.android}
              onChange={onChecklistChange(release.id)}
              platform="android"
            />
          )}
          {needsIOS && (
            <ChecklistSection
              title="iOS Checklist"
              items={IOS_CHECKLIST}
              values={release.checklist?.ios}
              onChange={onChecklistChange(release.id)}
              platform="ios"
            />
          )}

          {/* Copy helpers */}
          <div className="mrt__card-copy">
            {needsAndroid && (
              <CopyBtn
                label="Android Checklist"
                getText={() => buildAndroidChecklist(release)}
              />
            )}
            {needsIOS && (
              <CopyBtn
                label="iOS Checklist"
                getText={() => buildIOSChecklist(release)}
              />
            )}
            <CopyBtn
              label="Store Release Notes"
              getText={() => buildStoreReleaseNotes(release, linkedIssues, projectsMap)}
            />
            <CopyBtn
              label="Mobile QA Handoff"
              getText={() => buildMobileQAHandoff(release, linkedIssues, projectsMap)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function MobileReleaseModal({ release, allIssues, projectsMap, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ ...release }))
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

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return createPortal(
    <div className="mrt__overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mrt__modal" role="dialog" aria-modal="true" aria-label="Mobile Release">
        <div className="mrt__modal-header">
          <h2 className="mrt__modal-title">
            <Smartphone size={15} />
            {release.id && release.name ? `Edit: ${release.name}` : 'New Mobile Release'}
          </h2>
          <button type="button" className="mrt__modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="mrt__modal-body" onSubmit={handleSubmit}>
          <div className="mrt__modal-grid">

            {/* Release name */}
            <div className="mrt__mfield mrt__mfield--full">
              <label className="mrt__mlabel">Release Name *</label>
              <input
                ref={nameRef}
                required
                className="mrt__minput"
                type="text"
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="e.g. Android Release 1.0.8"
              />
            </div>

            {/* Platform + Status */}
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Platform</label>
              <select className="mrt__mselect" value={form.platform} onChange={(e) => patch('platform', e.target.value)}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Status</label>
              <select className="mrt__mselect" value={form.status} onChange={(e) => patch('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
              </select>
            </div>

            {/* Version + Build */}
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Version</label>
              <input className="mrt__minput" type="text" value={form.version} onChange={(e) => patch('version', e.target.value)} placeholder="1.0.8" />
            </div>
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Build Number</label>
              <input className="mrt__minput" type="text" value={form.buildNumber} onChange={(e) => patch('buildNumber', e.target.value)} placeholder="108" />
            </div>

            {/* Dates */}
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Target Release Date</label>
              <input className="mrt__minput" type="date" value={form.targetDate} onChange={(e) => patch('targetDate', e.target.value)} />
            </div>
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Submitted At</label>
              <input className="mrt__minput" type="date" value={form.submittedAt} onChange={(e) => patch('submittedAt', e.target.value)} />
            </div>
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Released At</label>
              <input className="mrt__minput" type="date" value={form.releasedAt} onChange={(e) => patch('releasedAt', e.target.value)} />
            </div>

            {/* Store links */}
            <div className="mrt__mfield">
              <label className="mrt__mlabel">Play Store Link</label>
              <input className="mrt__minput" type="url" value={form.playStoreLink} onChange={(e) => patch('playStoreLink', e.target.value)} placeholder="https://play.google.com/…" />
            </div>
            <div className="mrt__mfield">
              <label className="mrt__mlabel">App Store Link</label>
              <input className="mrt__minput" type="url" value={form.appStoreLink} onChange={(e) => patch('appStoreLink', e.target.value)} placeholder="https://apps.apple.com/…" />
            </div>

            {/* Notes */}
            <div className="mrt__mfield mrt__mfield--full">
              <label className="mrt__mlabel">Notes</label>
              <textarea
                className="mrt__mtextarea"
                rows={3}
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                placeholder="What changed, risks, migration steps…"
              />
            </div>

            {/* Link issues */}
            <div className="mrt__mfield mrt__mfield--full">
              <label className="mrt__mlabel">
                Link Issues
                <span className="mrt__mlabel-count">{form.linkedIssueIds?.length || 0} linked</span>
              </label>
              <input
                className="mrt__minput mrt__minput--search"
                type="text"
                value={issueSearch}
                onChange={(e) => setIssueSearch(e.target.value)}
                placeholder="Search issues by key or title…"
              />
              <div className="mrt__issue-picker">
                {filteredIssues.map((iss) => {
                  const proj = projectsMap[iss.projectId]
                  const key  = issueKey(proj?.name, iss.id)
                  const linked = (form.linkedIssueIds || []).includes(iss.id)
                  return (
                    <label key={iss.id} className={`mrt__issue-row ${linked ? 'mrt__issue-row--linked' : ''}`}>
                      <input
                        type="checkbox"
                        className="mrt__issue-check"
                        checked={linked}
                        onChange={() => toggleIssue(iss.id)}
                      />
                      <span className="mrt__issue-key">{key}</span>
                      <span className="mrt__issue-title">{iss.title}</span>
                      <span className="mrt__issue-st">{normalizeStatus(iss.status)}</span>
                    </label>
                  )
                })}
                {allIssues.length === 0 && (
                  <p className="mrt__issue-empty">No issues loaded yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mrt__modal-footer">
            <button type="button" className="mrt__modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="mrt__modal-save">
              <Check size={13} />
              Save Release
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
export function MobileReleaseTracker({ allIssues, selectedIssues, projectsMap }) {
  const [releases,       setReleases]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [backendError,   setBackendError]   = useState(false)
  const [showMigration,  setShowMigration]  = useState(false)
  const [modalRelease,   setModalRelease]   = useState(null)
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [collapsed,      setCollapsed]      = useState(false)

  // Load from backend on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listMobileReleasesApi()
        if (cancelled) return
        const normalized = (rows || []).map(normalizeRelease)
        setReleases(normalized)
        saveReleases(normalized)
        if (normalized.length === 0 && !isMigrated()) {
          const local = loadReleases()
          if (local?.length > 0) setShowMigration(true)
        }
      } catch (err) {
        if (cancelled) return
        console.error('[MobileReleaseTracker] backend load failed:', err)
        setBackendError(true)
        setReleases(loadReleases())
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    const detectedPlatform = selectedIssues.length > 0
      ? detectPlatform(selectedIssues, projectsMap)
      : 'Android'
    setModalRelease(newRelease({
      platform:       detectedPlatform,
      linkedIssueIds: selectedIssues.map((i) => i.id),
    }))
  }, [selectedIssues, projectsMap])

  const handleEdit = useCallback((release) => {
    setModalRelease({ ...release })
  }, [])

  const handleSave = useCallback(async (form) => {
    const isLocalId = !form.id || (typeof form.id === 'string' && form.id.startsWith('mr-'))
    try {
      let result
      if (isLocalId) {
        result = normalizeRelease(await createMobileReleaseApi(denormalizeRelease(form)))
      } else {
        result = normalizeRelease(await updateMobileReleaseApi(form.id, denormalizeRelease(form)))
      }
      setReleases((prev) => {
        const idx = prev.findIndex((r) => r.id === form.id)
        const next = idx === -1 ? [...prev, result] : prev.map((r, i) => i === idx ? result : r)
        saveReleases(next)
        return next
      })
    } catch (err) {
      console.error('[MobileReleaseTracker] save failed, using local fallback:', err)
      setReleases((prev) => {
        const idx = prev.findIndex((r) => r.id === form.id)
        const next = idx === -1 ? [...prev, form] : prev.map((r, i) => i === idx ? { ...r, ...form } : r)
        saveReleases(next)
        return next
      })
    }
    setModalRelease(null)
  }, [])

  const handleDelete = useCallback(async (id) => {
    const isLocalId = typeof id === 'string'
    if (!isLocalId) {
      try { await deleteMobileReleaseApi(id) } catch (err) {
        console.error('[MobileReleaseTracker] delete failed:', err)
      }
    }
    setReleases((prev) => {
      const next = prev.filter((r) => r.id !== id)
      saveReleases(next)
      return next
    })
  }, [])

  const handleChecklistChange = useCallback((releaseId) => async (platform, itemId, checked) => {
    setReleases((prev) => {
      const next = prev.map((r) => {
        if (r.id !== releaseId) return r
        const updated = {
          ...r,
          checklist: {
            ...r.checklist,
            [platform]: { ...(r.checklist?.[platform] || {}), [itemId]: checked },
          },
        }
        const isLocalId = typeof r.id === 'string'
        if (!isLocalId) {
          updateMobileReleaseApi(r.id, { checklist: updated.checklist }).catch(() => {})
        }
        return updated
      })
      saveReleases(next)
      return next
    })
  }, [])

  const handleMigrateLocal = async () => {
    const local = loadReleases()
    if (!local?.length) return true
    try {
      const results = await Promise.all(
        local.map(r => createMobileReleaseApi(denormalizeRelease(r)).then(normalizeRelease))
      )
      setReleases(results)
      saveReleases(results)
      markMigrated()
      setShowMigration(false)
      return true
    } catch { return false }
  }

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return releases.filter((r) => {
      if (filterStatus   !== 'all' && r.status   !== filterStatus)   return false
      if (filterPlatform !== 'all' && r.platform !== filterPlatform) return false
      return true
    }).sort((a, b) => {
      // Active statuses first
      const ORDER = ['In QA','Submitted','In Review','Approved','Planning','Released','Rejected']
      const ai = ORDER.indexOf(a.status)
      const bi = ORDER.indexOf(b.status)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [releases, filterStatus, filterPlatform])

  // ── Suggest creating from selection ─────────────────────────────────────────
  const hasAndroidSelection = selectedIssues.some((i) => {
    const name = (projectsMap[i.projectId]?.name || '').toLowerCase()
    return name.includes('android')
  })
  const hasIOSSelection = selectedIssues.some((i) => {
    const name = (projectsMap[i.projectId]?.name || '').toLowerCase()
    return name.includes('ios') || name.includes('apple')
  })
  const showSuggest = selectedIssues.length > 0 && (hasAndroidSelection || hasIOSSelection)

  return (
    <div className="mrt">
      {/* Header */}
      <div className="mrt__header">
        <div className="mrt__header-left">
          <Smartphone size={15} className="mrt__header-icon" />
          <span className="mrt__header-title">Mobile Release Tracker</span>
          {releases.length > 0 && (
            <span className="mrt__header-count">{releases.length}</span>
          )}
          {backendError && (
            <span className="mrt__offline-badge" title="Using local data — backend unavailable">
              <WifiOff size={11} /> Local
            </span>
          )}
        </div>
        <div className="mrt__header-right">
          <button type="button" className="mrt__new-btn" onClick={handleNew}>
            <Plus size={13} />
            New Mobile Release
          </button>
          <button
            type="button"
            className="mrt__collapse-btn"
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
              localItemCount={loadReleases().length}
              resourceLabel="mobile releases"
              onImport={handleMigrateLocal}
              onDismiss={() => { markMigrated(); setShowMigration(false) }}
            />
          )}

          {/* Suggestion banner */}
          {showSuggest && (
            <div className="mrt__suggest-banner">
              <Smartphone size={13} />
              <span>
                You have {hasAndroidSelection && hasIOSSelection ? 'Android & iOS' : hasAndroidSelection ? 'Android' : 'iOS'} issues selected.
              </span>
              <button type="button" className="mrt__suggest-btn" onClick={handleNew}>
                Create Mobile Release from Selection
              </button>
            </div>
          )}

          {/* Filters */}
          {releases.length > 0 && (
            <div className="mrt__filters">
              <select className="mrt__filter-select" value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
                <option value="all">All Platforms</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="mrt__filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
              </select>
            </div>
          )}

          {/* Release list */}
          {filtered.length === 0 ? (
            <div className="mrt__empty">
              <Smartphone size={28} className="mrt__empty-icon" />
              <p>No mobile releases yet.</p>
              <p>Create a release to track Android or iOS app submissions.</p>
              <button type="button" className="mrt__new-btn" onClick={handleNew}>
                <Plus size={13} /> New Mobile Release
              </button>
            </div>
          ) : (
            <div className="mrt__list">
              {filtered.map((release) => (
                <MobileReleaseCard
                  key={release.id}
                  release={release}
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
      {modalRelease && (
        <MobileReleaseModal
          release={modalRelease}
          allIssues={allIssues}
          projectsMap={projectsMap}
          onSave={handleSave}
          onClose={() => setModalRelease(null)}
        />
      )}
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function detectPlatform(issues, projectsMap) {
  const names = issues.map((i) => (projectsMap[i.projectId]?.name || '').toLowerCase())
  const android = names.some((n) => n.includes('android'))
  const ios     = names.some((n) => n.includes('ios') || n.includes('apple'))
  if (android && ios) return 'Both'
  if (ios)            return 'iOS'
  return 'Android'
}

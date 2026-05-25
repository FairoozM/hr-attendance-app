/**
 * ReleaseApprovalPanel
 *
 * Embedded in the Release Summary Builder section of LinearReleasesPage.
 * Manages release readiness, sign-off, approval, and deployment state.
 *
 * Persists draft state to localStorage (lifesmile.linear.releaseApproval.v1).
 * No backend calls; all data is computed from the selectedIssues prop.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldCheck, Rocket, CheckCircle2, AlertTriangle,
  XCircle, Copy, Check, ChevronDown, ChevronUp,
  Loader2, ClipboardCheck,
} from 'lucide-react'
import { normalizeStatus, normalizePriority, issueKey } from './IssueRow'
import './ReleaseApprovalPanel.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lifesmile.linear.releaseApproval.v1'

const RELEASE_TYPES   = ['Website', 'Android', 'iOS', 'Backend/API', 'UX/UI', 'Mixed']
const ENVIRONMENTS    = ['Production', 'Staging']
const DEPLOY_NEEDS    = ['Frontend', 'Backend', 'Mobile App Store', 'Database Migration', 'Config / Env Change']

const PR_OPEN_STATES  = new Set(['open', 'in_review', 'draft'])
const RELEASE_STATUSES = new Set(['Ready for Release', 'QA Approved', 'Done'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-AE', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

function safeLocalLoad(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

function safeLocalSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}

function calcReadiness(issues) {
  if (!issues.length) return null
  const total          = issues.length
  const qaApproved     = issues.filter((i) => i.devMeta?.qaApproval?.approved === true).length
  const notQaApproved  = total - qaApproved
  const prMerged       = issues.filter((i) => i.devMeta?.prStatus === 'merged').length
  const prOpen         = issues.filter((i) => PR_OPEN_STATES.has(i.devMeta?.prStatus)).length
  const canceled       = issues.filter((i) => normalizeStatus(i.status) === 'Canceled').length
  const notReady       = issues.filter((i) => !RELEASE_STATUSES.has(normalizeStatus(i.status))).length
  const highPri        = issues.filter((i) => ['Urgent', 'High'].includes(normalizePriority(i.priority))).length
  const hasPR          = issues.filter((i) => !!i.devMeta?.prUrl).length

  let status = 'ready'
  if (canceled > 0 || notReady > 0) status = 'blocked'
  else if (notQaApproved > 0 || prOpen > 0) status = 'needs_review'

  return { total, qaApproved, notQaApproved, prMerged, prOpen, canceled, notReady, highPri, hasPR, status }
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
      className={`rap__copy-btn rap__copy-btn--${size} ${copied ? 'rap__copy-btn--done' : ''}`}
      onClick={handle}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Text generators ───────────────────────────────────────────────────────────

function buildApprovalSummary({ releaseName, releaseType, environment, selectedIssues, projectsMap, approvalState, deployedState, signOffNotes, r }) {
  if (!r) return ''
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const lines = [
    `# Release Approval Summary`,
    `**Release**: ${releaseName || 'Unnamed Release'}`,
    `**Date**: ${date}`,
    `**Type**: ${releaseType}  |  **Environment**: ${environment}`,
    '',
    '## Readiness',
    `- Total issues selected: ${r.total}`,
    `- QA Approved: ${r.qaApproved}/${r.total}`,
    r.notQaApproved > 0 ? `- ⚠️ Not QA Approved: ${r.notQaApproved}` : null,
    `- PRs Merged: ${r.prMerged}/${r.hasPR}`,
    r.prOpen > 0 ? `- ⚠️ PRs still open/in-review: ${r.prOpen}` : null,
    r.canceled > 0 ? `- ❌ Canceled issues: ${r.canceled}` : null,
    '',
    '## Issues',
  ].filter((l) => l !== null)

  for (const iss of selectedIssues) {
    const proj = projectsMap[iss.projectId]
    const key = issueKey(proj?.name, iss.id)
    const qa = iss.devMeta?.qaApproval?.approved ? '✓ QA' : '? QA'
    const pr = iss.devMeta?.prStatus ? `PR:${iss.devMeta.prStatus}` : ''
    lines.push(`- [${qa}] **${key}**: ${iss.title}${pr ? `  (${pr})` : ''}`)
  }

  lines.push('')
  lines.push('## Sign-off')
  if (approvalState.approved) {
    lines.push(`✓ Release Approved by ${approvalState.approverName || 'Team'} at ${fmtDateTime(approvalState.approvedAt)}`)
  } else {
    lines.push('⚠️ Release not yet approved')
  }
  if (deployedState.deployed) {
    lines.push(`✓ Deployed by ${deployedState.deployerName || 'Team'} at ${fmtDateTime(deployedState.deployedAt)}`)
  }
  if (signOffNotes) {
    lines.push('')
    lines.push(`**Notes**: ${signOffNotes}`)
  }

  return lines.join('\n')
}

function buildDeploymentSignOff({ releaseName, releaseType, environment, deploymentNeeds, signOffNotes, approvalState, deployedState, selectedIssues, projectsMap }) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const lines = [
    `# Deployment Sign-off — ${releaseName || 'Unnamed Release'}`,
    `**Date**: ${date}`,
    `**Environment**: ${environment}  |  **Type**: ${releaseType}`,
    '',
    '## What Is Being Deployed',
    ...deploymentNeeds.map((d) => `- [x] ${d}`),
    '',
    '## Issues',
    ...selectedIssues.map((iss) => {
      const proj = projectsMap[iss.projectId]
      return `- ${issueKey(proj?.name, iss.id)}: ${iss.title}${iss.devMeta?.prUrl ? `  → ${iss.devMeta.prUrl}` : ''}`
    }),
    '',
    '## Approval',
    approvalState.approved
      ? `✓ Approved by ${approvalState.approverName || 'Team'} at ${fmtDateTime(approvalState.approvedAt)}`
      : '⚠️ Not yet approved',
    '',
    '## Deployment',
    deployedState.deployed
      ? `✓ Deployed by ${deployedState.deployerName || 'Team'} at ${fmtDateTime(deployedState.deployedAt)}`
      : '⬜ Not yet deployed',
    '',
    '## Smoke Test URLs',
    '- [ ] https://lifesmile.ae — homepage',
    '- [ ] https://lifesmile.ae — product page',
    '- [ ] https://lifesmile.ae — search',
    '- [ ] https://lifesmile.ae — cart',
    '- [ ] https://lifesmile.ae/checkout — checkout flow',
    '',
    '## Rollback',
    '- If critical issues arise: revert to previous deploy tag / app version.',
    '- Notify backend team and product lead immediately.',
  ]
  if (signOffNotes) {
    lines.push('', `**Notes**: ${signOffNotes}`)
  }
  return lines.join('\n')
}

function buildSmokeTest({ releaseName, releaseType, deploymentNeeds }) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const lines = [
    `# Post-deploy Smoke Test — ${releaseName || 'Unnamed Release'}`,
    `**Date**: ${date}  |  **Type**: ${releaseType}`,
    '',
  ]

  const needsFrontend = deploymentNeeds.includes('Frontend') || releaseType === 'Website' || releaseType === 'UX/UI' || releaseType === 'Mixed'
  const needsAndroid  = deploymentNeeds.includes('Mobile App Store') || releaseType === 'Android' || releaseType === 'Mixed'
  const needsIOS      = deploymentNeeds.includes('Mobile App Store') || releaseType === 'iOS' || releaseType === 'Mixed'
  const needsAPI      = deploymentNeeds.includes('Backend') || deploymentNeeds.includes('Database Migration') || releaseType === 'Backend/API' || releaseType === 'Mixed'

  if (needsFrontend) {
    lines.push('## lifesmile.ae Web Checks')
    lines.push('- [ ] Homepage loads correctly (no blank page, no console errors)')
    lines.push('- [ ] Product listing pages display correctly')
    lines.push('- [ ] Product detail page loads, images visible')
    lines.push('- [ ] Search returns results and filters work')
    lines.push('- [ ] Add to cart works, cart count updates')
    lines.push('- [ ] Checkout flow loads, payment step reachable')
    lines.push('- [ ] Login / account pages accessible')
    lines.push('- [ ] Mobile responsive at 375px and 768px')
    lines.push('- [ ] No new JS errors in console')
    lines.push('')
  }

  if (needsAndroid) {
    lines.push('## Android App Checks')
    lines.push('- [ ] App installs / updates successfully')
    lines.push('- [ ] Launch without crash')
    lines.push('- [ ] Affected feature works end-to-end')
    lines.push('- [ ] Back navigation works correctly')
    lines.push('- [ ] Dark mode renders correctly')
    lines.push('')
  }

  if (needsIOS) {
    lines.push('## iOS App Checks')
    lines.push('- [ ] App installs / updates from TestFlight or App Store')
    lines.push('- [ ] Launch without crash')
    lines.push('- [ ] Affected feature works end-to-end')
    lines.push('- [ ] Safe area / notch rendering correct')
    lines.push('')
  }

  if (needsAPI) {
    lines.push('## API / Backend Checks')
    lines.push('- [ ] Health endpoint returns 200')
    lines.push('- [ ] Key API endpoints return expected responses')
    lines.push('- [ ] No new 500 errors in server logs')
    lines.push('- [ ] Auth and permission guards enforced')
    if (deploymentNeeds.includes('Database Migration')) {
      lines.push('- [ ] DB migration ran successfully, no orphaned rows')
    }
    lines.push('')
  }

  lines.push('## General')
  lines.push('- [ ] Staging smoke test was completed before production deploy')
  lines.push('- [ ] No regression on unrelated features')
  lines.push('- [ ] Performance is not visibly degraded')
  lines.push('- [ ] All team members notified of deploy')

  return lines.join('\n')
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   selectedIssues: object[],
 *   projectsMap: Record<string, object>,
 *   membersMap: Record<string, object>,
 *   currentUser: object | null,
 *   onMoveToDone: (issues: object[]) => Promise<void>,
 * }} props
 */
export function ReleaseApprovalPanel({
  selectedIssues,
  projectsMap,
  membersMap,
  currentUser,
  onMoveToDone,
}) {
  // Load persisted draft
  const saved = safeLocalLoad(STORAGE_KEY) || {}

  // Form state
  const [releaseName,     setReleaseName]     = useState(saved.releaseName     || '')
  const [releaseType,     setReleaseType]     = useState(saved.releaseType     || 'Website')
  const [environment,     setEnvironment]     = useState(saved.environment     || 'Production')
  const [deploymentNeeds, setDeploymentNeeds] = useState(saved.deploymentNeeds || ['Frontend'])
  const [signOffNotes,    setSignOffNotes]    = useState(saved.signOffNotes    || '')

  // Approval / deployment
  const [approvalState,  setApprovalState]  = useState(saved.approvalState  || { approved: false })
  const [deployedState,  setDeployedState]  = useState(saved.deployedState  || { deployed: false })

  // UI state
  const [moveDoneChecked,   setMoveDoneChecked]   = useState(false)
  const [movingToDone,      setMovingToDone]       = useState(false)
  const [moveDoneConfirm,   setMoveDoneConfirm]    = useState(false)
  const [moveDoneDone,      setMoveDoneDone]       = useState(false)
  const [overrideWarnings,  setOverrideWarnings]   = useState(false)
  const [collapsed,         setCollapsed]           = useState(false)

  const r = useMemo(() => calcReadiness(selectedIssues), [selectedIssues])

  const currentUserName = currentUser
    ? (currentUser.displayName || currentUser.username || `User #${currentUser.userId || currentUser.id}`)
    : 'You'

  // ── Persist form state to localStorage ───────────────────────────────────
  useEffect(() => {
    safeLocalSave(STORAGE_KEY, {
      releaseName, releaseType, environment, deploymentNeeds, signOffNotes,
      approvalState, deployedState,
      selectedIssueIds: selectedIssues.map((i) => i.id),
    })
  }, [releaseName, releaseType, environment, deploymentNeeds, signOffNotes, approvalState, deployedState])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toggleDeployNeed = (need) => {
    setDeploymentNeeds((prev) =>
      prev.includes(need) ? prev.filter((n) => n !== need) : [...prev, need]
    )
  }

  const userApproverName = currentUserName

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleApprove = () => {
    const state = {
      approved:     true,
      approvedBy:   currentUser?.userId || currentUser?.id || null,
      approvedAt:   new Date().toISOString(),
      approverName: userApproverName,
    }
    setApprovalState(state)
  }

  const handleRevokeApproval = () => {
    setApprovalState({ approved: false })
  }

  const handleMarkDeployed = () => {
    if (!approvalState.approved && !overrideWarnings) {
      setOverrideWarnings(true)
      return
    }
    const state = {
      deployed:     true,
      deployedBy:   currentUser?.userId || currentUser?.id || null,
      deployedAt:   new Date().toISOString(),
      deployerName: userApproverName,
    }
    setDeployedState(state)
    setOverrideWarnings(false)
  }

  const handleMoveToDone = async () => {
    if (!moveDoneConfirm) { setMoveDoneConfirm(true); return }
    setMoveDoneConfirm(false)
    setMovingToDone(true)
    try {
      const toMove = selectedIssues.filter(
        (i) => normalizeStatus(i.status) !== 'Done' && normalizeStatus(i.status) !== 'Canceled'
      )
      await onMoveToDone(toMove)
      setMoveDoneDone(true)
      setTimeout(() => setMoveDoneDone(false), 3000)
    } catch (err) {
      console.error('[release] move to done error:', err)
    } finally {
      setMovingToDone(false)
    }
  }

  const handleClearDraft = () => {
    safeLocalSave(STORAGE_KEY, null)
    setReleaseName(''); setReleaseType('Website'); setEnvironment('Production')
    setDeploymentNeeds(['Frontend']); setSignOffNotes('')
    setApprovalState({ approved: false }); setDeployedState({ deployed: false })
  }

  // ── Copy text builders ────────────────────────────────────────────────────
  const ctx = { releaseName, releaseType, environment, deploymentNeeds, signOffNotes, approvalState, deployedState, selectedIssues, projectsMap, r }
  const getApprovalSummary  = () => buildApprovalSummary(ctx)
  const getDeploySignOff    = () => buildDeploymentSignOff(ctx)
  const getSmokeTest        = () => buildSmokeTest(ctx)

  // ── Readiness display ─────────────────────────────────────────────────────
  const statusConfig = {
    ready:        { color: '#059669', icon: CheckCircle2, label: 'Ready to Deploy' },
    needs_review: { color: '#d97706', icon: AlertTriangle, label: 'Needs Review'  },
    blocked:      { color: '#dc2626', icon: XCircle,      label: 'Blocked'         },
  }
  const sc = r ? (statusConfig[r.status] || statusConfig.needs_review) : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="rap">
      {/* Header */}
      <div className="rap__header">
        <div className="rap__header-left">
          <ClipboardCheck size={15} className="rap__header-icon" />
          <span className="rap__header-title">Release Approval</span>
          {sc && (
            <span className="rap__status-pill" style={{ '--sc': sc.color }}>
              <sc.icon size={11} />
              {sc.label}
            </span>
          )}
        </div>
        <div className="rap__header-right">
          <button type="button" className="rap__clear-btn" onClick={handleClearDraft} title="Clear draft">
            Clear
          </button>
          <button
            type="button"
            className="rap__collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Readiness summary */}
          {r && (
            <div className="rap__readiness">
              <div className="rap__readiness-row">
                <span className="rap__readiness-stat">
                  <span className="rap__stat-n" style={{ color: r.qaApproved === r.total ? '#059669' : '#d97706' }}>
                    {r.qaApproved}/{r.total}
                  </span>
                  QA Approved
                </span>
                {r.hasPR > 0 && (
                  <span className="rap__readiness-stat">
                    <span className="rap__stat-n" style={{ color: r.prOpen > 0 ? '#d97706' : '#059669' }}>
                      {r.prMerged}/{r.hasPR}
                    </span>
                    PRs Merged
                  </span>
                )}
                {r.canceled > 0 && (
                  <span className="rap__readiness-stat rap__readiness-stat--error">
                    <XCircle size={11} /> {r.canceled} Canceled
                  </span>
                )}
                {r.notReady > 0 && (
                  <span className="rap__readiness-stat rap__readiness-stat--warn">
                    <AlertTriangle size={11} /> {r.notReady} not ready
                  </span>
                )}
                {r.highPri > 0 && (
                  <span className="rap__readiness-stat rap__readiness-stat--info">
                    ⚡ {r.highPri} high-pri
                  </span>
                )}
              </div>
              {/* Progress bar */}
              <div className="rap__progress-track" title={`${r.qaApproved}/${r.total} QA approved`}>
                <div
                  className="rap__progress-fill"
                  style={{
                    width: `${r.total > 0 ? (r.qaApproved / r.total) * 100 : 0}%`,
                    background: r.status === 'ready' ? '#059669' : r.status === 'needs_review' ? '#d97706' : '#dc2626',
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Release info form ─────────────────────────────────────────── */}
          <div className="rap__form">
            <div className="rap__field">
              <label className="rap__label" htmlFor="rap-name">Release Name</label>
              <input
                id="rap-name"
                className="rap__input"
                type="text"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
                placeholder="e.g. Website UX Release — May 2026"
              />
            </div>

            <div className="rap__row">
              <div className="rap__field">
                <label className="rap__label">Type</label>
                <div className="rap__select-wrap">
                  <select
                    className="rap__select"
                    value={releaseType}
                    onChange={(e) => setReleaseType(e.target.value)}
                  >
                    {RELEASE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <ChevronDown size={11} className="rap__select-icon" />
                </div>
              </div>

              <div className="rap__field">
                <label className="rap__label">Environment</label>
                <div className="rap__select-wrap">
                  <select
                    className="rap__select"
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value)}
                  >
                    {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <ChevronDown size={11} className="rap__select-icon" />
                </div>
              </div>
            </div>

            <div className="rap__field">
              <label className="rap__label">Deployment Needs</label>
              <div className="rap__checkbox-group">
                {DEPLOY_NEEDS.map((need) => (
                  <label key={need} className="rap__checkbox-label">
                    <input
                      type="checkbox"
                      className="rap__checkbox"
                      checked={deploymentNeeds.includes(need)}
                      onChange={() => toggleDeployNeed(need)}
                    />
                    {need}
                  </label>
                ))}
              </div>
            </div>

            <div className="rap__field">
              <label className="rap__label" htmlFor="rap-notes">Sign-off Notes</label>
              <textarea
                id="rap-notes"
                className="rap__textarea"
                rows={3}
                value={signOffNotes}
                onChange={(e) => setSignOffNotes(e.target.value)}
                placeholder="Deployment notes, risks, migration steps…"
              />
            </div>
          </div>

          {/* ── Approval actions ──────────────────────────────────────────── */}
          <div className="rap__approval-section">
            {/* Approve / revoke */}
            <div className="rap__action-row">
              {!approvalState.approved ? (
                <button
                  type="button"
                  className="rap__btn rap__btn--approve"
                  onClick={handleApprove}
                  disabled={!releaseName.trim()}
                  title={!releaseName.trim() ? 'Enter a release name first' : 'Mark Release Approved'}
                >
                  <ShieldCheck size={13} />
                  Mark Release Approved
                </button>
              ) : (
                <div className="rap__approved-state">
                  <ShieldCheck size={14} className="rap__approved-icon" />
                  <span>
                    Release Approved by <strong>{approvalState.approverName || 'Team'}</strong>
                    {approvalState.approvedAt ? ` · ${fmtDateTime(approvalState.approvedAt)}` : ''}
                  </span>
                  <button type="button" className="rap__revoke-btn" onClick={handleRevokeApproval}>
                    Revoke
                  </button>
                </div>
              )}
            </div>

            {/* Override warning */}
            {overrideWarnings && !approvalState.approved && (
              <div className="rap__warn-banner" role="alert">
                <AlertTriangle size={13} />
                <span>Release is not yet approved. Mark as deployed anyway?</span>
                <button type="button" className="rap__warn-yes" onClick={handleMarkDeployed}>
                  Deploy Anyway
                </button>
                <button type="button" className="rap__warn-no" onClick={() => setOverrideWarnings(false)}>
                  Cancel
                </button>
              </div>
            )}

            {/* Deploy */}
            <div className="rap__action-row">
              {!deployedState.deployed ? (
                <button
                  type="button"
                  className="rap__btn rap__btn--deploy"
                  onClick={handleMarkDeployed}
                >
                  <Rocket size={13} />
                  Mark Deployed
                </button>
              ) : (
                <div className="rap__deployed-state">
                  <Rocket size={14} className="rap__deployed-icon" />
                  <span>
                    Deployed by <strong>{deployedState.deployerName || 'Team'}</strong>
                    {deployedState.deployedAt ? ` · ${fmtDateTime(deployedState.deployedAt)}` : ''}
                  </span>
                  <button
                    type="button"
                    className="rap__revoke-btn"
                    onClick={() => setDeployedState({ deployed: false })}
                  >
                    Undo
                  </button>
                </div>
              )}
            </div>

            {/* Move to Done */}
            {deployedState.deployed && (
              <div className="rap__move-done-section">
                <label className="rap__checkbox-label rap__checkbox-label--move">
                  <input
                    type="checkbox"
                    className="rap__checkbox"
                    checked={moveDoneChecked}
                    onChange={(e) => setMoveDoneChecked(e.target.checked)}
                  />
                  Move included issues to Done after deploying
                </label>

                {moveDoneChecked && !moveDoneDone && (
                  <>
                    {moveDoneConfirm && (
                      <div className="rap__confirm-banner" role="alert">
                        <AlertTriangle size={12} />
                        <span>
                          This will move {selectedIssues.filter(
                            (i) => normalizeStatus(i.status) !== 'Done' && normalizeStatus(i.status) !== 'Canceled'
                          ).length} issues to Done. Are you sure?
                        </span>
                        <button type="button" className="rap__warn-yes" onClick={handleMoveToDone} disabled={movingToDone}>
                          {movingToDone ? <Loader2 size={11} className="rap__spin" /> : null}
                          Yes, Move to Done
                        </button>
                        <button type="button" className="rap__warn-no" onClick={() => setMoveDoneConfirm(false)}>
                          Cancel
                        </button>
                      </div>
                    )}
                    {!moveDoneConfirm && (
                      <button
                        type="button"
                        className="rap__btn rap__btn--done"
                        onClick={handleMoveToDone}
                        disabled={movingToDone}
                      >
                        <CheckCircle2 size={13} />
                        Move Issues to Done
                      </button>
                    )}
                  </>
                )}

                {moveDoneDone && (
                  <p className="rap__done-msg">
                    <CheckCircle2 size={13} /> Issues moved to Done.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Copy helpers ──────────────────────────────────────────────── */}
          <div className="rap__copy-section">
            <p className="rap__copy-label">Copy</p>
            <div className="rap__copy-row">
              <CopyBtn label="Release Approval Summary" getText={getApprovalSummary} />
              <CopyBtn label="Deployment Sign-off"      getText={getDeploySignOff}   />
              <CopyBtn label="Post-deploy Smoke Test"   getText={getSmokeTest}        />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

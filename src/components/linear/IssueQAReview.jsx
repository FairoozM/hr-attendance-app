/**
 * IssueQAReview — "QA" tab inside IssueDetailPanel.
 *
 * Displays QA approval status, notes, evidence checklist, and
 * suggested QA steps. All actions require explicit user interaction;
 * nothing auto-saves.
 *
 * QA metadata lives in issue.devMeta.qaApproval:
 *   { approved, approvedBy, approvedAt, notes }
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldCheck, ShieldOff, CheckCircle2, XCircle,
  FileText, Image, AlertTriangle, Info, Loader2,
  ChevronDown, ChevronRight, BookOpen, ClipboardList,
} from 'lucide-react'
import { listAttachmentsApi } from '../../lib/projectsApi'
import { getRelatedDocsForQA } from '../../lib/linearDocsMatcher'
import { RelatedDocsList } from './RelatedDocsList'
import { getIssueChecklistCompliance } from '../../lib/linearChecklistCompliance'
import './IssueQAReview.css'

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

function memberName(members, userId) {
  if (!userId || !members?.length) return 'Unknown'
  const m = members.find((m) => m.id === userId || m.id === Number(userId))
  return m?.displayName || m?.username || `User #${userId}`
}

// Detect which platforms the project covers (mirrors roadmap/releases logic)
function detectPlatforms(projectName) {
  const n = (projectName || '').toLowerCase()
  const out = []
  if (n.includes('web') || n.includes('website') || n.includes('lifesmile')) out.push('web')
  if (n.includes('android'))                                                   out.push('android')
  if (n.includes('ios') || n.includes('iphone'))                              out.push('ios')
  if (n.includes('backend') || n.includes('api') || n.includes('server'))     out.push('api')
  if (n.includes('ux') || n.includes('ui') || n.includes('design'))           out.push('ux')
  if (n.includes('data') || n.includes('bi') || n.includes('analytics'))      out.push('bi')
  return out.length ? out : ['web']
}

function buildQaChecklist(platforms, hasBefore, hasAfter) {
  const items = [
    'Verify the described issue behavior is fixed or feature works as expected.',
    'Check that no related features have regressed.',
  ]
  if (platforms.includes('web') || platforms.includes('ux')) {
    items.push('Test on Chrome, Firefox, and Safari.')
    items.push('Check at 375px (mobile), 768px (tablet), and 1280px (desktop).')
    items.push('Verify loading, empty, and error states are correct.')
    items.push('Check no new console errors appear.')
  }
  if (platforms.includes('android')) {
    items.push('Test on Android 10+ device or emulator.')
    items.push('Verify back navigation and lifecycle behavior.')
    items.push('Check dark mode renders correctly.')
  }
  if (platforms.includes('ios')) {
    items.push('Test on iOS 15+ device or simulator.')
    items.push('Verify safe area insets and notch handling.')
    items.push('Check VoiceOver accessibility basics.')
  }
  if (platforms.includes('api')) {
    items.push('Confirm API returns correct response shape and HTTP status codes.')
    items.push('Check auth/permission guards are enforced.')
    items.push('Verify error responses return JSON, not HTML.')
    items.push('Review server logs for unexpected errors.')
  }
  if (platforms.includes('bi')) {
    items.push('Confirm filters apply correctly and totals match expected values.')
    items.push('Verify data export works and file format is correct.')
  }
  if (hasBefore && hasAfter) {
    items.push('Compare Before vs After screenshots — confirm improvement is visible.')
  }
  return items
}

// ── Evidence Checklist ────────────────────────────────────────────────────────

function EvidenceItem({ label, present, icon: Icon }) {
  return (
    <div className={`qa__evidence-item ${present ? 'qa__evidence-item--ok' : 'qa__evidence-item--missing'}`}>
      <Icon size={13} />
      <span>{label}</span>
      {present
        ? <CheckCircle2 size={11} className="qa__evidence-check" />
        : <span className="qa__evidence-miss">missing</span>
      }
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   issue: object,
 *   project: object|null,
 *   members: object[],
 *   currentUser: object|null,
 *   onApprove: (notes: string, moveToQaApproved: boolean) => Promise<void>,
 *   onRevoke: () => Promise<void>,
 *   onSaveNotes: (notes: string) => Promise<void>,
 *   onMoveToDone: () => Promise<void>,
 * }} props
 */
export function IssueQAReview({
  issue,
  project,
  members,
  currentUser,
  onApprove,
  onRevoke,
  onSaveNotes,
  onMoveToDone,
  onRunChecklist,
}) {
  const qa       = issue?.devMeta?.qaApproval || {}
  const approved = qa.approved === true
  const status   = issue?.status || ''

  // Notes local state
  const [notes,        setNotes]        = useState(qa.notes || '')
  const [notesSaved,   setNotesSaved]   = useState(false)
  const [savingNotes,  setSavingNotes]  = useState(false)

  // Action state
  const [acting,       setActing]       = useState(false)
  const [actionMsg,    setActionMsg]    = useState('')

  // Move to Done confirmation (when not yet approved)
  const [moveDoneConfirm, setMoveDoneConfirm] = useState(false)

  // Attachments for evidence checklist
  const [attachments,  setAttachments]  = useState([])
  const [loadingAtts,  setLoadingAtts]  = useState(false)

  // Checklist collapse state
  const [showChecklist, setShowChecklist] = useState(true)

  // SOP compliance warning (shown when approving with < 70% completion)
  const [approveWarnOpen, setApproveWarnOpen] = useState(false)

  // SOP compliance (recomputed when issue changes)
  const [sopCompliance, setSopCompliance] = useState(null)

  useEffect(() => {
    try { setSopCompliance(getIssueChecklistCompliance(issue, project)) }
    catch { setSopCompliance(null) }
  }, [issue?.id, issue?.devMeta])

  // Sync notes if issue prop changes
  useEffect(() => {
    setNotes(qa.notes || '')
  }, [issue?.id, qa.notes])

  // Load attachments for evidence checklist
  useEffect(() => {
    const projectId = issue?.projectId || project?.id
    const taskId = issue?.id
    if (!projectId || !taskId) return
    setLoadingAtts(true)
    listAttachmentsApi(projectId, taskId)
      .then((rows) => { if (Array.isArray(rows)) setAttachments(rows) })
      .catch(() => {})
      .finally(() => setLoadingAtts(false))
  }, [issue?.id])

  // ── Helpers ──────────────────────────────────────────────────────────────

  const platforms = detectPlatforms(project?.name)

  const hasBugEvidence    = attachments.some((a) => a.kind === 'bug_evidence')
  const hasBefore         = attachments.some((a) => a.kind === 'before')
  const hasAfter          = attachments.some((a) => a.kind === 'after')
  const hasQaProof        = attachments.some((a) => a.kind === 'qa_proof')
  const hasReleaseEvidence = attachments.some((a) => a.kind === 'release_evidence')

  const qaSuggestions = buildQaChecklist(platforms, hasBefore, hasAfter)

  const qaDocs = useMemo(() => getRelatedDocsForQA(issue, project), [issue, project])

  const flash = (msg, ms = 2000) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), ms)
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleApprove = async () => {
    // If compliance is below 70% and user hasn't confirmed yet, show warning
    if (
      sopCompliance?.hasChecklists &&
      sopCompliance.overallPct < 70 &&
      !approveWarnOpen
    ) {
      setApproveWarnOpen(true)
      return
    }
    setApproveWarnOpen(false)
    setActing(true)
    try {
      await onApprove(notes, true)
      flash('QA approved.')
    } catch {
      flash('Failed to approve. Please try again.')
    } finally {
      setActing(false)
    }
  }

  const handleRevoke = async () => {
    setActing(true)
    try {
      await onRevoke()
      flash('QA approval revoked.')
    } catch {
      flash('Failed to revoke. Please try again.')
    } finally {
      setActing(false)
    }
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try {
      await onSaveNotes(notes)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch {
      flash('Failed to save notes.')
    } finally {
      setSavingNotes(false)
    }
  }

  const handleMoveToDone = async () => {
    if (!approved && !moveDoneConfirm) {
      setMoveDoneConfirm(true)
      return
    }
    setMoveDoneConfirm(false)
    setActing(true)
    try {
      await onMoveToDone()
      flash('Moved to Done.')
    } catch {
      flash('Failed to move to Done.')
    } finally {
      setActing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isDone = status === 'Done' || status === 'done' || status === 'completed'

  return (
    <div className="qa">
      {/* ── Status card ──────────────────────────────────────────────────── */}
      <div className={`qa__status-card ${approved ? 'qa__status-card--approved' : 'qa__status-card--pending'}`}>
        <div className="qa__status-icon">
          {approved
            ? <ShieldCheck size={20} className="qa__icon--approved" />
            : <ShieldOff   size={20} className="qa__icon--pending" />
          }
        </div>
        <div className="qa__status-info">
          {approved ? (
            <>
              <p className="qa__status-label qa__status-label--approved">QA Approved</p>
              <p className="qa__status-meta">
                by <strong>{memberName(members, qa.approvedBy)}</strong>
                {qa.approvedAt ? ` · ${fmtDateTime(qa.approvedAt)}` : ''}
              </p>
              {qa.notes && <p className="qa__status-notes">{qa.notes}</p>}
            </>
          ) : (
            <>
              <p className="qa__status-label qa__status-label--pending">Not QA Approved</p>
              <p className="qa__status-meta">Approve after verifying the fix or feature.</p>
            </>
          )}
        </div>
      </div>

      {/* ── Action message ────────────────────────────────────────────────── */}
      {actionMsg && (
        <div className="qa__action-msg">
          <Info size={13} />
          {actionMsg}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="qa__actions">
        {!approved && (
          <button
            type="button"
            className="qa__btn qa__btn--approve"
            onClick={handleApprove}
            disabled={acting}
          >
            {acting ? <Loader2 size={13} className="qa__spin" /> : <ShieldCheck size={13} />}
            Approve QA
          </button>
        )}

        {approved && (
          <button
            type="button"
            className="qa__btn qa__btn--revoke"
            onClick={handleRevoke}
            disabled={acting}
          >
            {acting ? <Loader2 size={13} className="qa__spin" /> : <ShieldOff size={13} />}
            Revoke Approval
          </button>
        )}

        {!isDone && (
          <button
            type="button"
            className={`qa__btn qa__btn--done ${!approved ? 'qa__btn--done-warn' : ''}`}
            onClick={handleMoveToDone}
            disabled={acting}
            title={!approved ? 'Issue is not yet QA approved' : 'Move to Done'}
          >
            <CheckCircle2 size={13} />
            Move to Done
          </button>
        )}
      </div>

      {/* Move-to-Done confirmation when not approved */}
      {moveDoneConfirm && (
        <div className="qa__confirm-banner" role="alert">
          <AlertTriangle size={13} />
          <span>Issue is not QA approved. Move to Done anyway?</span>
          <button type="button" className="qa__confirm-yes" onClick={handleMoveToDone}>
            Yes, move to Done
          </button>
          <button type="button" className="qa__confirm-no" onClick={() => setMoveDoneConfirm(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* SOP Approve confirmation (< 70% compliance) */}
      {approveWarnOpen && (
        <div className="qa__confirm-banner qa__confirm-banner--sop" role="alert">
          <AlertTriangle size={13} />
          <span>
            SOP checklist is <strong>{sopCompliance?.overallPct ?? 0}%</strong> complete.
            Approve QA anyway?
          </span>
          <button type="button" className="qa__confirm-yes" onClick={handleApprove}>
            Approve anyway
          </button>
          <button type="button" className="qa__confirm-no" onClick={() => setApproveWarnOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* ── SOP Compliance card ──────────────────────────────────────────── */}
      {sopCompliance && (
        <div className="qa__section">
          <p className="qa__section-title">
            <ClipboardList size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            SOP Compliance
          </p>
          {!sopCompliance.hasChecklists ? (
            <p className="qa__sop-none">No SOP checklist linked to this issue.</p>
          ) : (
            <>
              <div className="qa__sop-overall">
                <span
                  className="qa__sop-badge"
                  style={{ '--sop-color': sopCompliance.status.color }}
                >
                  {sopCompliance.status.label}
                </span>
                <span className="qa__sop-pct">{sopCompliance.overallPct}% overall</span>
              </div>
              {sopCompliance.progresses.map(p => (
                <div key={p.doc.id} className="qa__sop-row">
                  <span className="qa__sop-doc-title">{p.doc.title}</span>
                  <div className="qa__sop-bar-wrap">
                    <div className="qa__sop-bar">
                      <div
                        className="qa__sop-bar-fill"
                        style={{ width: `${p.pct}%`, background: p.status.color }}
                      />
                    </div>
                    <span className="qa__sop-frac">{p.done}/{p.total}</span>
                  </div>
                  {onRunChecklist && (
                    <button
                      type="button"
                      className="qa__sop-run-btn"
                      onClick={() => onRunChecklist(p.doc)}
                    >
                      {p.done > 0 ? 'Continue' : 'Run'}
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── QA Notes ─────────────────────────────────────────────────────── */}
      <div className="qa__section">
        <p className="qa__section-title">QA Notes</p>
        <textarea
          className="qa__notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add QA notes, reproduction steps, or test observations…"
          rows={4}
        />
        <button
          type="button"
          className={`qa__btn qa__btn--save ${notesSaved ? 'qa__btn--saved' : ''}`}
          onClick={handleSaveNotes}
          disabled={savingNotes}
        >
          {savingNotes
            ? <><Loader2 size={12} className="qa__spin" /> Saving…</>
            : notesSaved
              ? 'Notes Saved'
              : 'Save Notes'
          }
        </button>
      </div>

      {/* ── Evidence checklist ───────────────────────────────────────────── */}
      <div className="qa__section">
        <p className="qa__section-title">Evidence</p>
        {loadingAtts ? (
          <div className="qa__loading">
            <Loader2 size={13} className="qa__spin" />
            <span>Loading attachments…</span>
          </div>
        ) : (
          <div className="qa__evidence-list">
            <EvidenceItem label="Bug Evidence screenshot" present={hasBugEvidence} icon={Image} />
            <EvidenceItem label="Before screenshot" present={hasBefore} icon={Image} />
            <EvidenceItem label="After screenshot"  present={hasAfter}  icon={Image} />
            <EvidenceItem label="QA Proof screenshot" present={hasQaProof} icon={Image} />
            <EvidenceItem label="Release Evidence screenshot" present={hasReleaseEvidence} icon={Image} />
          </div>
        )}
        {!loadingAtts && !attachments.length && (
          <p className="qa__evidence-hint">
            Upload screenshots in the Files tab and classify them (Bug Evidence, Before, After, QA Proof).
          </p>
        )}
      </div>

      {/* ── Suggested QA checklist ───────────────────────────────────────── */}
      <div className="qa__section">
        <button
          type="button"
          className="qa__checklist-toggle"
          onClick={() => setShowChecklist((v) => !v)}
        >
          <span className="qa__section-title">Suggested QA Checklist</span>
          {showChecklist ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {showChecklist && (
          <ul className="qa__checklist">
            {qaSuggestions.map((item, i) => (
              <li key={i} className="qa__checklist-item">
                <input
                  type="checkbox"
                  id={`qa-check-${issue?.id}-${i}`}
                  className="qa__checkbox"
                  defaultChecked={false}
                />
                <label htmlFor={`qa-check-${issue?.id}-${i}`}>{item}</label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Related QA Docs ──────────────────────────────────────────────── */}
      <div className="qa__section">
        <p className="qa__section-title">
          <BookOpen size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          QA Docs
        </p>
        <RelatedDocsList docs={qaDocs} emptyMessage="No QA docs matched." showViewAll onRunChecklist={onRunChecklist} />
      </div>

    </div>
  )
}

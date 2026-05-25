/**
 * IssueDetailPanel — Linear-style right slide-over for a single issue.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, BookOpen, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { issueKey } from './IssueRow'
import { IssueProperties } from './IssueProperties'
import { IssueComments } from './IssueComments'
import { IssueActivity } from './IssueActivity'
import { IssueAIAssistant } from './IssueAIAssistant'
import { IssueDevWorkflow } from './IssueDevWorkflow'
import { IssueAttachments } from './IssueAttachments'
import { IssueQAReview } from './IssueQAReview'
import { syncIssueGithubPr, approveIssueQA, revokeIssueQA, normalizeTask } from '../../lib/projectsApi'
import { loadDocsForIssue } from '../../lib/relatedDocs'
import './IssueDetailPanel.css'

const TABS = [
  { id: 'details',  label: 'Details'  },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
  { id: 'ai',       label: 'AI'       },
  { id: 'dev',      label: 'Dev'      },
  { id: 'files',    label: 'Files'    },
  { id: 'qa',       label: 'QA'       },
]

/** Map UI camelCase patch → API snake_case body */
function toApiPayload(patch) {
  const out = {}
  if (patch.title !== undefined) out.title = patch.title
  if (patch.description !== undefined) out.description = patch.description
  if (patch.status !== undefined) out.status = patch.status
  if (patch.priority !== undefined) out.priority = patch.priority
  if (patch.issueType !== undefined) out.issue_type = patch.issueType
  if (patch.assigneeUserId !== undefined) out.assignee_user_id = patch.assigneeUserId
  if (patch.dueDate !== undefined) out.due_date = patch.dueDate
  if (patch.storyPoints !== undefined) out.story_points = patch.storyPoints
  if (patch.blockedReason !== undefined) out.blocked_reason = patch.blockedReason
  if (patch.sprintId !== undefined) out.sprint_id = patch.sprintId == null ? null : Number(patch.sprintId)
  if (patch.labels !== undefined) out.labels = Array.isArray(patch.labels) ? patch.labels : []
  if (patch.devMeta !== undefined) out.dev_meta = patch.devMeta
  return out
}

export function IssueDetailPanel({
  issue,
  project,
  members = [],
  cycles = [],
  open,
  onClose,
  onUpdate,
  onDelete,
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('details')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [relatedDocs, setRelatedDocs] = useState([])
  const titleRef = useRef(null)

  const key = issue ? issueKey(project?.name, issue.id) : ''

  useEffect(() => {
    if (!issue) return
    setTitle(issue.title || '')
    setDescription(issue.description || '')
    setFields({
      status: issue.status,
      priority: issue.priority,
      issueType: issue.issueType,
      assigneeUserId: issue.assigneeUserId,
      sprintId: issue.sprintId ?? null,
      labels: issue.labels || [],
      dueDate: issue.dueDate,
      storyPoints: issue.storyPoints,
      blockedReason: issue.blockedReason,
    })
    setSaveError('')
    setDeleteConfirmOpen(false)
    setDeleteError('')
    setDeleting(false)
    setTab('details')
    // Load related docs from localStorage
    try {
      setRelatedDocs(loadDocsForIssue({
        projectName: project?.name || '',
        labels: issue.labels || [],
      }))
    } catch { setRelatedDocs([]) }
    setTimeout(() => titleRef.current?.focus(), 80)
  }, [issue?.id, issue?.updatedAt])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const persist = useCallback(async (patch) => {
    if (!issue || !onUpdate) return
    setSaving(true)
    setSaveError('')
    try {
      const updated = await onUpdate(issue.projectId, issue.id, toApiPayload(patch))
      if (updated) {
        setTitle(updated.title || '')
        setDescription(updated.description || '')
        setFields({
          status: updated.status,
          priority: updated.priority,
          issueType: updated.issueType,
          assigneeUserId: updated.assigneeUserId,
          dueDate: updated.dueDate,
          storyPoints: updated.storyPoints,
          blockedReason: updated.blockedReason,
        })
        setActivityRefresh((n) => n + 1)
      }
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }, [issue, onUpdate])

  const handlePropertiesChange = useCallback((patch) => {
    setFields((prev) => ({ ...prev, ...patch }))
    persist(patch)
  }, [persist])

  const handleTitleBlur = useCallback(() => {
    const t = title.trim()
    if (!t || t === issue?.title) return
    persist({ title: t })
  }, [title, issue?.title, persist])

  const handleDescriptionBlur = useCallback(() => {
    if (description === (issue?.description || '')) return
    persist({ description })
  }, [description, issue?.description, persist])

  // ── AI Assistant callbacks ────────────────────────────────────────────────
  const handleAiInsertDescription = useCallback((text) => {
    setDescription(text)
    // Persist immediately so user sees it saved
    persist({ description: text })
  }, [persist])

  const handleAiAppendDescription = useCallback((text) => {
    const current = description || ''
    const next = current ? `${current}\n\n${text}` : text
    setDescription(next)
    persist({ description: next })
  }, [description, persist])

  const handleAiReplaceTitle = useCallback((text) => {
    setTitle(text)
    persist({ title: text })
  }, [persist])

  // ── Dev Workflow callback ─────────────────────────────────────────────────
  const handleSaveDevMeta = useCallback(async (devMeta) => {
    await persist({ devMeta })
  }, [persist])

  const handleSyncGithubPr = useCallback(async (prUrl) => {
    if (!issue) return
    const { devMeta } = await syncIssueGithubPr(issue.projectId, issue.id, prUrl)
    // Persist locally so the panel and row chips update immediately
    await persist({ devMeta })
  }, [issue, persist])

  // ── GitHub Status Suggestions (Phase 7C) ─────────────────────────────────
  const handleApplyStatusSuggestion = useCallback(async (statusValue) => {
    if (!issue) return
    await persist({ status: statusValue })
  }, [issue, persist])

  const handleDismissStatusSuggestion = useCallback(async (key) => {
    if (!issue) return
    const existing = Array.isArray(issue.devMeta?.dismissedGithubSuggestions)
      ? issue.devMeta.dismissedGithubSuggestions
      : []
    if (existing.includes(key)) return
    await persist({ devMeta: { dismissedGithubSuggestions: [...existing, key] } })
  }, [issue, persist])

  // ── QA Review callbacks ───────────────────────────────────────────────────
  const handleQaApprove = useCallback(async (notes, moveToQaApproved) => {
    if (!issue) return
    setSaving(true)
    try {
      const raw = await approveIssueQA(issue.projectId, issue.id, { notes, moveToQaApproved })
      if (raw) {
        const normalized = normalizeTask(raw)
        // Update local fields so the panel reflects the new status immediately
        setFields((f) => ({ ...f, status: normalized.status }))
        // Notify parent context (triggers re-render with updated issue)
        onUpdate?.(issue.projectId, issue.id, {})
      }
    } catch (err) {
      console.error('[qa] approve failed:', err)
    } finally {
      setSaving(false)
    }
  }, [issue, onUpdate, setSaving])

  const handleQaRevoke = useCallback(async () => {
    if (!issue) return
    setSaving(true)
    try {
      await revokeIssueQA(issue.projectId, issue.id)
      onUpdate?.(issue.projectId, issue.id, {})
    } catch (err) {
      console.error('[qa] revoke failed:', err)
    } finally {
      setSaving(false)
    }
  }, [issue, onUpdate, setSaving])

  const handleQaSaveNotes = useCallback(async (notes) => {
    if (!issue) return
    // Merge notes into existing qaApproval without touching approved/approvedBy/approvedAt
    const currentQA = issue.devMeta?.qaApproval || {}
    await persist({ devMeta: { qaApproval: { ...currentQA, notes } } })
    setActivityRefresh((n) => n + 1)
  }, [issue, persist])

  const handleQaMoveToDone = useCallback(async () => {
    await persist({ status: 'Done' })
  }, [persist])

  const handleDeleteConfirm = useCallback(async () => {
    if (!issue || !onDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete(issue.projectId, issue.id)
      setDeleteConfirmOpen(false)
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete issue')
    } finally {
      setDeleting(false)
    }
  }, [issue, onDelete])

  if (!open || !issue) return null

  return createPortal(
    <>
      <button
        type="button"
        className="idp__backdrop"
        aria-label="Close issue panel"
        onClick={onClose}
      />
      <aside className="idp" role="dialog" aria-modal="true" aria-label={`Issue ${key}`}>
        <header className="idp__header">
          <div className="idp__header-top">
            <span className="idp__key">{key}</span>
            <button type="button" className="idp__close" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <input
            ref={titleRef}
            type="text"
            className="idp__title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="Issue title"
            disabled={saving}
          />
        </header>

        <nav className="idp__tabs" aria-label="Issue sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`idp__tab ${tab === t.id ? 'idp__tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'files' && issue?.attachments?.length > 0 && (
                <span className="idp__tab-badge">{issue.attachments.length}</span>
              )}
              {t.id === 'qa' && issue?.devMeta?.qaApproval?.approved && (
                <span className="idp__tab-badge idp__tab-badge--qa">✓</span>
              )}
            </button>
          ))}
        </nav>

        {saveError && (
          <div className="idp__save-error" role="alert">{saveError}</div>
        )}

        <div className="idp__body">
          {tab === 'details' && (
            <div className="idp__details">
              <section className="idp__section">
                <h3 className="idp__section-title">Description</h3>
                <textarea
                  className="idp__description"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={handleDescriptionBlur}
                  placeholder="Add a description…"
                  disabled={saving}
                />
              </section>

              <section className="idp__section">
                <h3 className="idp__section-title">Properties</h3>
                <IssueProperties
                  status={fields.status}
                  priority={fields.priority}
                  issueType={fields.issueType}
                  assigneeUserId={fields.assigneeUserId}
                  sprintId={fields.sprintId}
                  cycles={cycles}
                  labels={fields.labels}
                  dueDate={fields.dueDate}
                  storyPoints={fields.storyPoints}
                  blockedReason={fields.blockedReason}
                  projectName={project?.name}
                  members={members}
                  onChange={handlePropertiesChange}
                  saving={saving}
                />
              </section>

              {/* Related Docs — lightweight links to matching docs */}
              {relatedDocs.length > 0 && (
                <section className="idp__section idp__section--docs">
                  <h3 className="idp__section-title">
                    <BookOpen size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Related Docs
                  </h3>
                  <div className="idp__docs-chips">
                    {relatedDocs.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        className="idp__doc-chip"
                        onClick={() => navigate('/projects/linear/docs')}
                        title={d.summary || d.title}
                      >
                        {d.title}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="idp__doc-chip idp__doc-chip--all"
                      onClick={() => navigate('/projects/linear/docs')}
                    >
                      <ArrowRight size={11} /> All Docs
                    </button>
                  </div>
                </section>
              )}

              {onDelete && (
                <section className="idp__danger">
                  {!deleteConfirmOpen ? (
                    <button
                      type="button"
                      className="idp__delete-trigger"
                      onClick={() => {
                        setDeleteConfirmOpen(true)
                        setDeleteError('')
                      }}
                      disabled={saving || deleting}
                    >
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      Delete Issue
                    </button>
                  ) : (
                    <div className="idp__delete-confirm" role="alertdialog" aria-labelledby="idp-delete-title">
                      <p id="idp-delete-title" className="idp__delete-confirm-text">
                        Delete this issue? This cannot be undone.
                      </p>
                      {deleteError && (
                        <p className="idp__delete-error">{deleteError}</p>
                      )}
                      <div className="idp__delete-actions">
                        <button
                          type="button"
                          className="idp__delete-cancel"
                          onClick={() => {
                            setDeleteConfirmOpen(false)
                            setDeleteError('')
                          }}
                          disabled={deleting}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="idp__delete-confirm-btn"
                          onClick={handleDeleteConfirm}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <IssueComments
              projectId={issue.projectId}
              issueId={issue.id}
              refreshKey={activityRefresh}
            />
          )}

          {tab === 'activity' && (
            <IssueActivity
              projectId={issue.projectId}
              issueId={issue.id}
              refreshKey={activityRefresh}
            />
          )}

          {tab === 'ai' && (
            <IssueAIAssistant
              issue={issue}
              project={project}
              onInsertDescription={handleAiInsertDescription}
              onAppendDescription={handleAiAppendDescription}
              onReplaceTitle={handleAiReplaceTitle}
            />
          )}

          {tab === 'dev' && (
            <IssueDevWorkflow
              issue={issue}
              project={project}
              cycles={cycles}
              onSaveDevMeta={handleSaveDevMeta}
              onSyncGithubPr={handleSyncGithubPr}
              onApplyStatusSuggestion={handleApplyStatusSuggestion}
              onDismissStatusSuggestion={handleDismissStatusSuggestion}
            />
          )}

          {tab === 'files' && (
            <IssueAttachments
              issue={issue}
              project={project}
              onAppendDescription={handleAiAppendDescription}
            />
          )}

          {tab === 'qa' && (
            <IssueQAReview
              issue={issue}
              project={project}
              members={members}
              currentUser={null}
              onApprove={handleQaApprove}
              onRevoke={handleQaRevoke}
              onSaveNotes={handleQaSaveNotes}
              onMoveToDone={handleQaMoveToDone}
            />
          )}
        </div>

        {saving && (
          <div className="idp__saving" aria-live="polite">Saving…</div>
        )}
      </aside>
    </>,
    document.body
  )
}

export default IssueDetailPanel

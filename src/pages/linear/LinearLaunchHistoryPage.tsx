import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  History,
  Loader2,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react'
import { CommandMenu } from '../../components/linear/CommandMenu'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import {
  buildFollowUpActionsText,
  buildPostDeployReviewText,
  countFollowUpActions,
  normalizeLaunchRecord,
  type LaunchRecord,
} from '../../lib/linearLaunchRecords'
import {
  deleteLaunchRecordApi,
  listLaunchRecordsApi,
  updateLaunchRecordApi,
} from '../../lib/linearWorkspaceApi'
import {
  canDeleteLaunchRecords,
  canManageLaunchRecords,
  canViewLaunchRecords,
} from '../../lib/linearPermissions'
import { issueKey } from '../../components/linear/IssueRow'
import './LinearLaunchHistoryPage.css'

const TYPE_OPTIONS = ['Website', 'Backend', 'Full Stack', 'Android', 'iOS', 'Mixed']
const ENV_OPTIONS = ['Production', 'Staging']
const STATUS_OPTIONS = ['Completed', 'Verified', 'Failed', 'Rolled Back', 'Needs Follow-up']
const SMOKE_REVIEW_OPTIONS = ['passed', 'warning', 'failed', 'not_run']

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function copyText(text: string) {
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return true
    } catch {
      return false
    }
  })
}

function MetricCard({ label, value, detail }: { label: string, value: string | number, detail?: string }) {
  return (
    <article className="lhist-metric">
      <div className="lhist-metric__value">{value}</div>
      <div className="lhist-metric__label">{label}</div>
      {detail ? <div className="lhist-metric__detail">{detail}</div> : null}
    </article>
  )
}

type ReviewModalProps = {
  open: boolean
  record: LaunchRecord | null
  onClose: () => void
  onSave: (payload: Record<string, any>) => Promise<void>
}

function PostDeployReviewModal({ open, record, onClose, onSave }: ReviewModalProps) {
  const [status, setStatus] = useState('Completed')
  const [qaSummary, setQaSummary] = useState('')
  const [deploymentSummary, setDeploymentSummary] = useState('')
  const [smokeResult, setSmokeResult] = useState('not_run')
  const [rollbackUsed, setRollbackUsed] = useState(false)
  const [incidentNotes, setIncidentNotes] = useState('')
  const [whatWentWell, setWhatWentWell] = useState('')
  const [whatWentWrong, setWhatWentWrong] = useState('')
  const [followUpActions, setFollowUpActions] = useState('')
  const [markReviewed, setMarkReviewed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!record) return
    setStatus(record.status || 'Completed')
    setQaSummary(record.qaSummary || '')
    setDeploymentSummary(record.deploymentSummary || '')
    setSmokeResult(String(record.smokeSnapshot?.manualResult || record.smokeSnapshot?.status || 'not_run').toLowerCase())
    setRollbackUsed(Boolean(record.rollbackUsed))
    setIncidentNotes(record.incidentNotes || '')
    setWhatWentWell(record.whatWentWell || '')
    setWhatWentWrong(record.whatWentWrong || '')
    setFollowUpActions(record.followUpActions || '')
    setMarkReviewed(Boolean(record.reviewedAt))
  }, [record])

  if (!open || !record) return null

  return (
    <div className="lhist-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="lhist-modal" role="dialog" aria-modal="true" aria-labelledby="launch-review-title" onClick={(event) => event.stopPropagation()}>
        <div className="lhist-modal__header">
          <div>
            <h2 id="launch-review-title">Post-Deploy Review</h2>
            <p>{record.launchName}</p>
          </div>
          <button type="button" className="lhist-icon-btn" onClick={onClose} aria-label="Close review">
            <X size={16} />
          </button>
        </div>

        <div className="lhist-form-grid">
          <label className="lhist-field">
            <span>Status</span>
            <div className="lhist-select-wrap">
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <ChevronDown size={14} />
            </div>
          </label>

          <label className="lhist-field">
            <span>Smoke test result</span>
            <div className="lhist-select-wrap">
              <select value={smokeResult} onChange={(event) => setSmokeResult(event.target.value)}>
                {SMOKE_REVIEW_OPTIONS.map((option) => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}
              </select>
              <ChevronDown size={14} />
            </div>
          </label>

          <label className="lhist-field lhist-field--full">
            <span>QA summary</span>
            <textarea rows={3} value={qaSummary} onChange={(event) => setQaSummary(event.target.value)} />
          </label>

          <label className="lhist-field lhist-field--full">
            <span>Deployment summary</span>
            <textarea rows={3} value={deploymentSummary} onChange={(event) => setDeploymentSummary(event.target.value)} />
          </label>

          <label className="lhist-field lhist-field--full">
            <span>Incident notes</span>
            <textarea rows={3} value={incidentNotes} onChange={(event) => setIncidentNotes(event.target.value)} />
          </label>

          <label className="lhist-field lhist-field--full">
            <span>What went well</span>
            <textarea rows={3} value={whatWentWell} onChange={(event) => setWhatWentWell(event.target.value)} />
          </label>

          <label className="lhist-field lhist-field--full">
            <span>What went wrong</span>
            <textarea rows={3} value={whatWentWrong} onChange={(event) => setWhatWentWrong(event.target.value)} />
          </label>

          <label className="lhist-field lhist-field--full">
            <span>Follow-up actions</span>
            <textarea rows={4} value={followUpActions} onChange={(event) => setFollowUpActions(event.target.value)} />
          </label>
        </div>

        <div className="lhist-inline-controls">
          <label className="lhist-inline-check">
            <input type="checkbox" checked={rollbackUsed} onChange={(event) => setRollbackUsed(event.target.checked)} />
            <span>Rollback used</span>
          </label>
          <label className="lhist-inline-check">
            <input type="checkbox" checked={markReviewed} onChange={(event) => setMarkReviewed(event.target.checked)} />
            <span>Mark reviewed</span>
          </label>
        </div>

        <div className="lhist-modal__actions">
          <button type="button" className="lhist-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="lhist-btn lhist-btn--primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave({
                  status,
                  qa_summary: qaSummary,
                  deployment_summary: deploymentSummary,
                  smoke_snapshot: {
                    ...(record.smokeSnapshot || {}),
                    manualResult: smokeResult,
                  },
                  rollback_used: rollbackUsed,
                  incident_notes: incidentNotes,
                  what_went_well: whatWentWell,
                  what_went_wrong: whatWentWrong,
                  follow_up_actions: followUpActions,
                  markReviewed,
                })
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <Loader2 size={14} className="lhist-spin" /> : <CheckCircle2 size={14} />}
            Save Review
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LinearLaunchHistoryPage() {
  const { user } = useAuth()
  const { projects, getTasksForProject, actions } = useTeamProjectsContext()
  const location = useLocation()
  const navigate = useNavigate()
  const canOpenHistory = canViewLaunchRecords(user)
  const canManageHistory = canManageLaunchRecords(user)
  const canDeleteHistory = canDeleteLaunchRecords(user)
  const [records, setRecords] = useState<LaunchRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [envFilter, setEnvFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<LaunchRecord | null>(null)
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)
  const actionHandledRef = useRef('')
  const feedbackTimerRef = useRef<number | null>(null)

  const flashMessage = useCallback((text: string) => {
    setFeedback(text)
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 2200)
  }, [])

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    if (!canOpenHistory) return
    void actions.fetchProjects().then((rows) => {
      const list = Array.isArray(rows) ? rows : []
      return Promise.all(list.map((project) => actions.fetchTasks(project.id)))
    })
  }, [actions, canOpenHistory])

  const allIssues = useMemo(
    () => projects.flatMap((project) => getTasksForProject(project.id) || []),
    [projects, getTasksForProject]
  )

  const projectsMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    projects.forEach((project) => {
      map[project.id] = project
    })
    return map
  }, [projects])

  const issueMap = useMemo(() => {
    const map: Record<number, any> = {}
    allIssues.forEach((issue) => {
      map[Number(issue.id)] = issue
    })
    return map
  }, [allIssues])

  const getIssueLabels = useCallback((record: LaunchRecord) => (
    record.linkedIssueIds.map((id) => {
      const issue = issueMap[id]
      if (!issue) return `ISS-${id}`
      return issueKey(projectsMap[issue.projectId]?.name, issue.id)
    })
  ), [issueMap, projectsMap])

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listLaunchRecordsApi()
      setRecords(Array.isArray(rows) ? rows.map(normalizeLaunchRecord) : [])
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load launch history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canOpenHistory) return
    void loadRecords()
  }, [canOpenHistory, loadRecords])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setCmdMenuOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase()
    return records.filter((record) => {
      if (typeFilter && record.launchType !== typeFilter) return false
      if (envFilter && record.environment !== envFilter) return false
      if (statusFilter && record.status !== statusFilter) return false
      if (fromDate && String(record.createdAt || '').slice(0, 10) < fromDate) return false
      if (toDate && String(record.createdAt || '').slice(0, 10) > toDate) return false
      if (!term) return true
      const haystack = [
        record.launchName,
        record.launchType,
        record.environment,
        record.status,
        record.qaSummary,
        record.deploymentSummary,
        record.incidentNotes,
        record.whatWentWell,
        record.whatWentWrong,
        record.followUpActions,
      ].join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [records, typeFilter, envFilter, statusFilter, fromDate, toDate, search])

  const metrics = useMemo(() => {
    const now = new Date()
    const monthItems = records.filter((record) => {
      if (!record.createdAt) return false
      const date = new Date(record.createdAt)
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    })
    const failedOrRolledBack = records.filter((record) => ['Failed', 'Rolled Back'].includes(record.status))
    const needingFollowUp = records.filter((record) => record.status === 'Needs Follow-up' || countFollowUpActions(record.followUpActions) > 0)
    const lastProduction = records.find((record) => record.environment === 'Production') || null
    return {
      launchesThisMonth: monthItems.length,
      failedOrRolledBack: failedOrRolledBack.length,
      needingFollowUp: needingFollowUp.length,
      lastProduction,
    }
  }, [records])

  const copyRecordReview = useCallback(async (record: LaunchRecord) => {
    const ok = await copyText(buildPostDeployReviewText(record, getIssueLabels(record)))
    flashMessage(ok ? 'Post-deploy review copied.' : 'Copy failed.')
  }, [flashMessage, getIssueLabels])

  const copyRecordFollowUps = useCallback(async (record: LaunchRecord) => {
    const ok = await copyText(buildFollowUpActionsText(record, getIssueLabels(record)))
    flashMessage(ok ? 'Follow-up actions copied.' : 'Copy failed.')
  }, [flashMessage, getIssueLabels])

  const copyLastReview = useCallback(async () => {
    const record = records[0]
    if (!record) {
      flashMessage('No launch record available.')
      return
    }
    await copyRecordReview(record)
  }, [copyRecordReview, flashMessage, records])

  useEffect(() => {
    if (loading || records.length === 0) return
    const params = new URLSearchParams(location.search)
    const action = params.get('action')
    if (!action) return
    if (actionHandledRef.current === location.search) return
    actionHandledRef.current = location.search
    void (async () => {
      if (action === 'copy-last-review') {
        await copyLastReview()
      }
      params.delete('action')
      const nextSearch = params.toString()
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
    })()
  }, [copyLastReview, loading, location.pathname, location.search, navigate, records])

  if (!canOpenHistory) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to view launch history."
      />
    )
  }

  return (
    <div className="lhist-shell">
      <LinearSidebar />

      <main className="lhist-page">
        <header className="lhist-header">
          <div>
            <h1>Launch History</h1>
            <p>Post-deploy reviews and release records.</p>
          </div>

          <div className="lhist-header__actions">
            <button type="button" className="lhist-btn" onClick={() => void loadRecords()}>
              <RefreshCcw size={14} />
              Refresh
            </button>
            <button type="button" className="lhist-btn lhist-btn--primary" onClick={copyLastReview}>
              <Copy size={14} />
              Copy Last Post-Deploy Review
            </button>
          </div>
        </header>

        {feedback && <div className="lhist-banner">{feedback}</div>}
        {error && <div className="lhist-banner lhist-banner--error">{error}</div>}

        <section className="lhist-metrics">
          <MetricCard label="Launches this month" value={metrics.launchesThisMonth} />
          <MetricCard label="Failed / Rolled Back" value={metrics.failedOrRolledBack} />
          <MetricCard label="Need follow-up" value={metrics.needingFollowUp} />
          <MetricCard label="Last production launch" value={metrics.lastProduction?.launchName || 'None'} detail={metrics.lastProduction?.createdAt ? formatDateTime(metrics.lastProduction.createdAt) : undefined} />
        </section>

        <section className="lhist-panel">
          <div className="lhist-panel__header">
            <div>
              <h2>Filters</h2>
              <p>Filter by type, environment, status, date range, or text search.</p>
            </div>
          </div>

          <div className="lhist-filters">
            <label className="lhist-field">
              <span>Type</span>
              <div className="lhist-select-wrap">
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                  <option value="">All</option>
                  {TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>

            <label className="lhist-field">
              <span>Environment</span>
              <div className="lhist-select-wrap">
                <select value={envFilter} onChange={(event) => setEnvFilter(event.target.value)}>
                  <option value="">All</option>
                  {ENV_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>

            <label className="lhist-field">
              <span>Status</span>
              <div className="lhist-select-wrap">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">All</option>
                  {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>

            <label className="lhist-field">
              <span>From</span>
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>

            <label className="lhist-field">
              <span>To</span>
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>

            <label className="lhist-field lhist-field--search">
              <span>Search</span>
              <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Launch name, summary, incidents, follow-ups…" />
            </label>
          </div>
        </section>

        <section className="lhist-panel">
          <div className="lhist-panel__header">
            <div>
              <h2>Launch Records</h2>
              <p>{filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''} shown</p>
            </div>
          </div>

          {loading ? (
            <div className="lhist-empty">Loading launch records…</div>
          ) : filteredRecords.length === 0 ? (
            <div className="lhist-empty">No launch records match the current filters.</div>
          ) : (
            <div className="lhist-list">
              {filteredRecords.map((record) => {
                const issueLabels = getIssueLabels(record)
                const followUpCount = countFollowUpActions(record.followUpActions)
                return (
                  <article key={record.id} className="lhist-card">
                    <div className="lhist-card__top">
                      <div>
                        <h3>{record.launchName}</h3>
                        <p>{formatDateTime(record.createdAt)}</p>
                      </div>

                      <div className="lhist-card__chips">
                        <span className="lhist-chip">{record.launchType || 'Unknown type'}</span>
                        <span className="lhist-chip">{record.environment || 'Unknown env'}</span>
                        <span className="lhist-chip lhist-chip--accent">{record.status}</span>
                        <span className={`lhist-chip ${record.reviewedAt ? 'lhist-chip--good' : 'lhist-chip--warn'}`}>{record.reviewedAt ? 'Reviewed' : 'Not reviewed'}</span>
                      </div>
                    </div>

                    <div className="lhist-card__grid">
                      <div><strong>Issues</strong><span>{issueLabels.length}</span></div>
                      <div><strong>Health</strong><span>{record.healthSnapshot?.status || 'not run'}</span></div>
                      <div><strong>Smoke</strong><span>{record.smokeSnapshot?.manualResult || record.smokeSnapshot?.status || 'not run'}</span></div>
                      <div><strong>Rollback used</strong><span>{record.rollbackUsed ? 'Yes' : 'No'}</span></div>
                      <div><strong>Follow-up count</strong><span>{followUpCount}</span></div>
                    </div>

                    {issueLabels.length > 0 && (
                      <div className="lhist-card__issues">
                        {issueLabels.slice(0, 8).map((label) => <span key={label} className="lhist-chip">{label}</span>)}
                      </div>
                    )}

                    <div className="lhist-card__actions">
                      {canManageHistory && (
                        <button type="button" className="lhist-btn" onClick={() => setSelectedRecord(record)}>
                          <History size={14} />
                          Open Review
                        </button>
                      )}
                      {(record.linkedDeploymentId || record.linkedMobileReleaseId) && (
                        <button type="button" className="lhist-btn" onClick={() => navigate('/projects/linear/releases')}>
                          <ExternalLink size={14} />
                          Open Linked Release
                        </button>
                      )}
                      {issueLabels.length > 0 && (
                        <button type="button" className="lhist-btn" onClick={() => navigate('/projects/linear')}>
                          <ExternalLink size={14} />
                          Open Linked Issues
                        </button>
                      )}
                      <button type="button" className="lhist-btn" onClick={() => void copyRecordReview(record)}>
                        <Copy size={14} />
                        Copy Post-Deploy Review
                      </button>
                      <button type="button" className="lhist-btn" onClick={() => void copyRecordFollowUps(record)}>
                        <Copy size={14} />
                        Copy Follow-up Actions
                      </button>
                      {canDeleteHistory && (
                        <button
                          type="button"
                          className="lhist-btn lhist-btn--danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete launch record "${record.launchName}"?`)) return
                            try {
                              await deleteLaunchRecordApi(record.id)
                              setRecords((current) => current.filter((item) => item.id !== record.id))
                              flashMessage('Launch record deleted.')
                            } catch (deleteError: any) {
                              setError(deleteError?.message || 'Failed to delete launch record.')
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>

      <PostDeployReviewModal
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onSave={async (payload) => {
          if (!selectedRecord) return
          try {
            const updated = await updateLaunchRecordApi(selectedRecord.id, payload)
            const normalized = normalizeLaunchRecord(updated)
            setRecords((current) => current.map((item) => item.id === normalized.id ? normalized : item))
            setSelectedRecord(null)
            flashMessage('Launch review saved.')
          } catch (saveError: any) {
            setError(saveError?.message || 'Failed to save launch review.')
          }
        }}
      />

      <CommandMenu open={cmdMenuOpen} onClose={() => setCmdMenuOpen(false)} />
    </div>
  )
}

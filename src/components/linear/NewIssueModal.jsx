/**
 * NewIssueModal.jsx
 * Minimal quick-create modal for new issues.
 * Maps UI "issue" terminology → server "task" API fields.
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus } from 'lucide-react'
import { LabelPicker } from './LabelPicker'
import './NewIssueModal.css'

const STATUS_OPTIONS = [
  { value: 'Backlog',            label: 'Backlog'            },
  { value: 'Todo',               label: 'Todo'               },
  { value: 'In Progress',        label: 'In Progress'        },
  { value: 'In Review',          label: 'In Review'          },
  { value: 'Ready for Release',  label: 'Ready for Release'  },
]

const PRIORITY_OPTIONS = [
  { value: 'No Priority', label: 'No Priority' },
  { value: 'Urgent',      label: 'Urgent'      },
  { value: 'High',        label: 'High'        },
  { value: 'Medium',      label: 'Medium'      },
  { value: 'Low',         label: 'Low'         },
]

// Product engineering issue types — kept subtle in the row, visible here in create modal
const ISSUE_TYPE_OPTIONS = [
  { value: 'feature',     label: 'Feature'     },
  { value: 'bug',         label: 'Bug'         },
  { value: 'ux/ui',       label: 'UX/UI'       },
  { value: 'performance', label: 'Performance'  },
  { value: 'scalability', label: 'Scalability'  },
  { value: 'release',     label: 'Release'      },
  { value: 'content',     label: 'Content'      },
  { value: 'integration', label: 'Integration'  },
  { value: 'task',        label: 'Task'         },
]

export function NewIssueModal({
  open,
  onClose,
  onCreate,
  projects = [],
  members  = [],
}) {
  const [title,      setTitle]      = useState('')
  const [status,     setStatus]     = useState('Todo')
  const [priority,   setPriority]   = useState('Medium')
  const [issueType,  setIssueType]  = useState('feature')
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId,  setProjectId]  = useState('')
  const [labels,     setLabels]     = useState([])
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const titleRef = useRef(null)

  // Focus title on open
  useEffect(() => {
    if (open) {
      setTitle(''); setStatus('Todo'); setPriority('Medium'); setIssueType('feature')
      setAssigneeId(''); setProjectId(projects[0]?.id ? String(projects[0].id) : '')
      setLabels([]); setError(''); setSaving(false)
      setTimeout(() => titleRef.current?.focus(), 60)
    }
  }, [open, projects])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onClose])

  async function handleCreate(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Issue title is required.'); return }
    if (!projectId)    { setError('Please select a project.');  return }

    setSaving(true)
    setError('')
    try {
      // Map UI fields → API payload (server uses "task" terminology internally)
      // issue_type is stored in the existing project_tasks.issue_type column (added in Phase 1)
      await onCreate({
        projectId: Number(projectId),
        payload: {
          title:            title.trim(),
          status,
          priority,
          assignee_user_id: assigneeId ? Number(assigneeId) : null,
          issue_type:       issueType,
          labels,
        },
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create issue. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="nim-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="nim-panel" role="dialog" aria-modal="true" aria-label="Create new issue">
        {/* Header */}
        <div className="nim-header">
          <span className="nim-header__title">
            <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
            New Issue
          </span>
          <button type="button" className="nim-close" onClick={onClose} aria-label="Close">
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <form className="nim-form" onSubmit={handleCreate} noValidate>
          {/* Title */}
          <div className="nim-field nim-field--title">
            <input
              ref={titleRef}
              type="text"
              className="nim-title-input"
              placeholder="Issue title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              aria-label="Issue title"
              required
            />
          </div>

          {/* Row: status, priority */}
          <div className="nim-row">
            <label className="nim-select-wrap">
              <span className="nim-select-label">Status</span>
              <select
                className="nim-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="nim-select-wrap">
              <span className="nim-select-label">Priority</span>
              <select
                className="nim-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITY_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Row: issue type, project */}
          <div className="nim-row">
            <label className="nim-select-wrap">
              <span className="nim-select-label">Type</span>
              <select
                className="nim-select"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
              >
                {ISSUE_TYPE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="nim-select-wrap">
              <span className="nim-select-label">Project</span>
              <select
                className="nim-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Row: assignee */}
          <div className="nim-row">
            <label className="nim-select-wrap">
              <span className="nim-select-label">Assignee</span>
              <select
                className="nim-select"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.displayName || m.username}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Labels */}
          <div className="nim-labels-row">
            <span className="nim-select-label">Labels</span>
            <LabelPicker labels={labels} onChange={setLabels} />
          </div>

          {/* Error */}
          {error && <p className="nim-error" role="alert">{error}</p>}

          {/* Actions */}
          <div className="nim-actions">
            <button type="button" className="nim-btn nim-btn--cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="nim-btn nim-btn--create" disabled={saving || !title.trim()}>
              {saving ? 'Creating…' : 'Create Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

export default NewIssueModal

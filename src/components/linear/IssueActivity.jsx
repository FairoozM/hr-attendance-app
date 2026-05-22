/**
 * IssueActivity — audit trail for an issue.
 */
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Circle } from 'lucide-react'
import { activityApi } from '../../lib/projectsApi'

const ACTION_LABELS = {
  issue_created: 'Issue created',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  assignee_changed: 'Assignee changed',
  issue_type_changed: 'Type changed',
  title_changed: 'Title updated',
  due_date_changed: 'Due date changed',
  story_points_changed: 'Story points changed',
  blocked_reason_changed: 'Blocked reason updated',
  cycle_changed: 'Cycle changed',
  description_updated: 'Description updated',
  comment_added: 'Comment added',
  created: 'Issue created',
  updated: 'Issue updated',
}

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function describeEntry(entry) {
  const label = ACTION_LABELS[entry.action] || entry.action.replace(/_/g, ' ')
  if (entry.oldValue != null && entry.newValue != null && entry.oldValue !== entry.newValue) {
    return `${label}: ${entry.oldValue} → ${entry.newValue}`
  }
  if (entry.newValue) return `${label}: ${entry.newValue}`
  return label
}

export function IssueActivity({ projectId, issueId, refreshKey = 0 }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!projectId || !issueId) return
    setLoading(true)
    setError('')
    try {
      const rows = await activityApi.list(projectId, issueId)
      setItems(rows)
    } catch (err) {
      // TODO: richer activity types when webhook integrations land
      setError(err.message || 'Failed to load activity')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [projectId, issueId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  return (
    <div className="iact">
      {loading && (
        <div className="iact__status">
          <Loader2 size={14} className="iact__spin" aria-hidden="true" />
          Loading activity…
        </div>
      )}

      {error && (
        <div className="iact__error" role="alert">{error}</div>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="iact__empty">No activity recorded yet.</p>
      )}

      <ul className="iact__list">
        {items.map((entry) => (
          <li key={entry.id} className="iact__item">
            <Circle size={8} className="iact__dot" aria-hidden="true" />
            <div className="iact__content">
              <p className="iact__text">{describeEntry(entry)}</p>
              <p className="iact__meta">
                <span>{entry.actorName}</span>
                <span className="iact__sep">·</span>
                <time dateTime={entry.createdAt}>{fmtWhen(entry.createdAt)}</time>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default IssueActivity

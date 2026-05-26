import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  BookOpen, ChevronDown, ChevronRight, Clock3, ExternalLink, FileText,
  GitBranch, History, Package, RefreshCw, Rocket, Search,
  ShieldCheck, Upload, ClipboardList,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { canViewAudit } from '../../lib/linearPermissions'
import { listAuditLogApi } from '../../lib/linearWorkspaceApi'
import './LinearAuditPage.css'

const ENTITY_OPTIONS = [
  ['', 'All entities'],
  ['issue', 'Issue'],
  ['doc', 'Doc'],
  ['intake', 'Intake'],
  ['mobile_release', 'Mobile Release'],
  ['deployment', 'Deployment'],
  ['digest_outbox', 'Digest Outbox'],
  ['checklist_run', 'Checklist Run'],
  ['qa_approval', 'QA Approval'],
  ['github', 'GitHub'],
  ['attachment', 'Attachment'],
  ['user', 'User'],
  ['admin', 'Admin'],
]

const ACTION_OPTIONS = [
  ['', 'All actions'],
  ['created', 'Created'],
  ['updated', 'Updated'],
  ['deleted', 'Deleted'],
  ['status_changed', 'Status Changed'],
  ['linked', 'Linked'],
  ['dismissed', 'Dismissed'],
  ['checklist_updated', 'Checklist Updated'],
  ['reset', 'Reset'],
  ['qa_approved', 'QA Approved'],
  ['qa_revoked', 'QA Revoked'],
  ['attachment_uploaded', 'Attachment Uploaded'],
  ['attachment_deleted', 'Attachment Deleted'],
  ['deployment_verified', 'Deployment Verified'],
  ['rolled_back', 'Rolled Back'],
  ['github_pr_synced', 'GitHub PR Synced'],
  ['linear_role_updated', 'Linear Role Updated'],
  ['digest_draft_created', 'Digest Draft Created'],
  ['digest_updated', 'Digest Updated'],
  ['digest_copied', 'Digest Copied'],
  ['digest_archived', 'Digest Archived'],
  ['digest_deleted', 'Digest Deleted'],
  ['exported', 'Exported'],
  ['imported', 'Imported'],
]

function formatDateTime(value) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatLabel(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatValue(value) {
  if (value == null || value === '') return 'Empty'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Empty'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function entityIcon(entityType, action) {
  if (entityType === 'doc') return BookOpen
  if (entityType === 'github') return GitBranch
  if (entityType === 'attachment') return Upload
  if (entityType === 'qa_approval') return ShieldCheck
  if (entityType === 'mobile_release') return Package
  if (entityType === 'deployment') return Rocket
  if (entityType === 'digest_outbox') return FileText
  if (entityType === 'checklist_run') return ClipboardList
  if (action === 'status_changed') return Clock3
  return FileText
}

function changedFieldsFromItem(item) {
  const before = item.before_snapshot || {}
  const after = item.after_snapshot || {}
  const explicit = Array.isArray(item.metadata?.changedFields) ? item.metadata.changedFields : []
  const keys = explicit.length
    ? explicit
    : Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
        (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
      )

  return keys
    .filter((key) => !['created_at', 'updated_at', 'id'].includes(key))
    .slice(0, 8)
    .map((key) => ({
      key,
      label: formatLabel(key),
      before: formatValue(before[key]),
      after: formatValue(after[key]),
    }))
}

function metadataEntries(item) {
  const metadata = item.metadata || {}
  return Object.entries(metadata)
    .filter(([key]) => key !== 'changedFields')
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: formatLabel(key),
      value: formatValue(value),
    }))
}

function relatedLink(item) {
  const metadata = item.metadata || {}
  const relatedIssueId = metadata.taskId || metadata.issueId || (item.entity_type === 'issue' ? item.entity_id : null)
  const projectId = metadata.projectId

  if (relatedIssueId) {
    const qs = new URLSearchParams({ issueId: String(relatedIssueId) })
    if (projectId) qs.set('projectId', String(projectId))
    return { href: `#/projects/linear?${qs.toString()}`, label: 'Open Issue' }
  }
  if (item.entity_type === 'doc') return { href: '#/projects/linear/docs', label: 'Open Docs' }
  if (['mobile_release', 'deployment', 'checklist_run'].includes(item.entity_type)) {
    return { href: '#/projects/linear/releases', label: 'Open Releases' }
  }
  return null
}

export default function LinearAuditPage() {
  const { user } = useAuth()
  const location = useLocation()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])

  if (!canViewAudit(user)) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to view the audit log."
      />
    )
  }

  const [entityType, setEntityType] = useState(params.get('entityType') || '')
  const [entityId, setEntityId] = useState(params.get('entityId') || '')
  const [relatedIssueId, setRelatedIssueId] = useState(params.get('relatedIssueId') || '')
  const [action, setAction] = useState(params.get('action') || '')
  const [actorUserId, setActorUserId] = useState(params.get('actorUserId') || '')
  const [from, setFrom] = useState(params.get('from') || '')
  const [to, setTo] = useState(params.get('to') || '')
  const [search, setSearch] = useState(params.get('search') || '')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [offset, setOffset] = useState(0)

  const limit = 50

  useEffect(() => {
    setEntityType(params.get('entityType') || '')
    setEntityId(params.get('entityId') || '')
    setRelatedIssueId(params.get('relatedIssueId') || '')
    setAction(params.get('action') || '')
    setActorUserId(params.get('actorUserId') || '')
    setFrom(params.get('from') || '')
    setTo(params.get('to') || '')
    setSearch(params.get('search') || '')
    setOffset(0)
  }, [params])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listAuditLogApi({
        entityType,
        entityId,
        relatedIssueId,
        action,
        actorUserId,
        from,
        to,
        search,
        limit,
        offset,
      })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total || 0))
    } catch (err) {
      setItems([])
      setTotal(0)
      setError(err.message || 'Failed to load audit log.')
    } finally {
      setLoading(false)
    }
  }, [action, actorUserId, entityId, entityType, from, offset, relatedIssueId, search, to])

  useEffect(() => {
    load()
  }, [load])

  const actorOptions = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      if (item.actor_user_id == null) continue
      map.set(String(item.actor_user_id), item.actor_name || `User #${item.actor_user_id}`)
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [items])

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canPageBack = offset > 0
  const canPageNext = offset + items.length < total

  return (
    <div className="la-page">
      <LinearSidebar />

      <main className="la-main">
        <header className="la-header">
          <div className="la-header__icon">
            <History size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="la-title">Audit Log</h1>
            <p className="la-subtitle">Recent changes across product workspace</p>
          </div>
        </header>

        <section className="la-filters">
          <label className="la-field">
            <span>Entity type</span>
            <select value={entityType} onChange={(e) => { setOffset(0); setEntityType(e.target.value) }}>
              {ENTITY_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
          </label>

          <label className="la-field">
            <span>Action</span>
            <select value={action} onChange={(e) => { setOffset(0); setAction(e.target.value) }}>
              {ACTION_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
          </label>

          <label className="la-field">
            <span>Actor</span>
            <select value={actorUserId} onChange={(e) => { setOffset(0); setActorUserId(e.target.value) }}>
              <option value="">All actors</option>
              {actorOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="la-field">
            <span>From</span>
            <input type="date" value={from} onChange={(e) => { setOffset(0); setFrom(e.target.value) }} />
          </label>

          <label className="la-field">
            <span>To</span>
            <input type="date" value={to} onChange={(e) => { setOffset(0); setTo(e.target.value) }} />
          </label>

          <label className="la-field la-field--search">
            <span>Search</span>
            <div className="la-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => { setOffset(0); setSearch(e.target.value) }}
                placeholder="Summary, actor, entity, issue id"
              />
            </div>
          </label>

          <label className="la-field">
            <span>Entity id</span>
            <input
              type="text"
              value={entityId}
              onChange={(e) => { setOffset(0); setEntityId(e.target.value) }}
              placeholder="Optional"
            />
          </label>

          <label className="la-field">
            <span>Issue history</span>
            <input
              type="text"
              value={relatedIssueId}
              onChange={(e) => { setOffset(0); setRelatedIssueId(e.target.value) }}
              placeholder="Issue id"
            />
          </label>

          <button type="button" className="la-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'la-spin' : ''} />
            Refresh
          </button>
        </section>

        <div className="la-toolbar">
          <span>{total} total changes</span>
          <span>{items.length} shown</span>
        </div>

        {error && <div className="la-error" role="alert">{error}</div>}

        {loading && <div className="la-empty">Loading audit log…</div>}

        {!loading && !error && items.length === 0 && (
          <div className="la-empty">No audit rows matched the current filters.</div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="la-list">
            {items.map((item) => {
              const Icon = entityIcon(item.entity_type, item.action)
              const expanded = expandedIds.has(item.id)
              const changes = changedFieldsFromItem(item)
              const metadata = metadataEntries(item)
              const link = relatedLink(item)

              return (
                <article key={item.id} className="la-row">
                  <button type="button" className="la-row__summary" onClick={() => toggleExpanded(item.id)}>
                    <span className="la-row__icon"><Icon size={15} aria-hidden="true" /></span>
                    <span className="la-row__text">
                      <span className="la-row__title">{item.summary || `${formatLabel(item.entity_type)} ${formatLabel(item.action)}`}</span>
                      <span className="la-row__meta">
                        <span>{item.actor_name || 'System'}</span>
                        <span>{formatLabel(item.entity_type)}</span>
                        {item.entity_id && <span>ID {item.entity_id}</span>}
                        <span>{formatDateTime(item.created_at)}</span>
                      </span>
                    </span>
                    <span className="la-row__expand">
                      {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                    </span>
                  </button>

                  {expanded && (
                    <div className="la-row__details">
                      <div className="la-detail-grid">
                        <section className="la-card">
                          <h2>Key Changes</h2>
                          {changes.length === 0 ? (
                            <p className="la-muted">No field-level diff available for this row.</p>
                          ) : (
                            <ul className="la-detail-list">
                              {changes.map((change) => (
                                <li key={change.key}>
                                  <strong>{change.label}:</strong> {change.before} <span className="la-arrow">→</span> {change.after}
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section className="la-card">
                          <h2>Metadata</h2>
                          {metadata.length === 0 ? (
                            <p className="la-muted">No extra metadata.</p>
                          ) : (
                            <ul className="la-detail-list">
                              {metadata.map((entry) => (
                                <li key={entry.key}>
                                  <strong>{entry.label}:</strong> {entry.value}
                                </li>
                              ))}
                            </ul>
                          )}
                          {link && (
                            <a className="la-link" href={link.href}>
                              <ExternalLink size={13} aria-hidden="true" />
                              {link.label}
                            </a>
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

        <div className="la-pagination">
          <button type="button" onClick={() => setOffset((value) => Math.max(value - limit, 0))} disabled={!canPageBack || loading}>
            Previous
          </button>
          <span>Offset {offset}</span>
          <button type="button" onClick={() => setOffset((value) => value + limit)} disabled={!canPageNext || loading}>
            Next
          </button>
        </div>
      </main>
    </div>
  )
}

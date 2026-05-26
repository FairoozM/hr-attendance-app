import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Copy, FilePlus2, Loader2, Pencil, Save, Trash2 } from 'lucide-react'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { useAuth } from '../../contexts/AuthContext'
import {
  createLinearDigestOutboxApi,
  deleteLinearDigestOutboxApi,
  listLinearDigestOutboxApi,
  updateLinearDigestOutboxApi,
} from '../../lib/linearWorkspaceApi'
import {
  LINEAR_DIGEST_OUTBOX_CHANNELS,
  LINEAR_DIGEST_OUTBOX_STATUSES,
  LINEAR_DIGEST_OUTBOX_TYPES,
  type LinearDigestOutboxChannel,
  type LinearDigestOutboxStatus,
  type LinearDigestOutboxType,
} from '../../lib/linearNotifications'
import { canEditDigestOutbox, canViewDigestOutbox } from '../../lib/linearPermissions'
import './LinearDigestOutboxPage.css'

type Draft = {
  id?: number
  digest_type: LinearDigestOutboxType
  title: string
  content: string
  status: LinearDigestOutboxStatus
  target_channel: LinearDigestOutboxChannel
  created_by?: number | string | null
  created_by_name?: string | null
  updated_by_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const EMPTY_DRAFT: Draft = {
  digest_type: 'custom',
  title: '',
  content: '',
  status: 'draft',
  target_channel: 'manual',
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
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
  }
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function snippet(text: string) {
  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

export default function LinearDigestOutboxPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [creatorFilter, setCreatorFilter] = useState('all')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorDraft, setEditorDraft] = useState<Draft>(EMPTY_DRAFT)

  const canOpen = canViewDigestOutbox(user)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listLinearDigestOutboxApi()
      setItems(Array.isArray(rows) ? rows : [])
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load digest outbox.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canOpen) return
    load()
  }, [canOpen, load])

  const creatorOptions = useMemo(() => {
    const map = new Map<string, string>()
    items.forEach((item) => {
      if (item.created_by == null) return
      map.set(String(item.created_by), item.created_by_name || `User #${item.created_by}`)
    })
    return Array.from(map.entries())
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.digest_type !== typeFilter) return false
      if (channelFilter !== 'all' && item.target_channel !== channelFilter) return false
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (creatorFilter !== 'all' && String(item.created_by || '') !== creatorFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const haystack = [
          item.title,
          item.content,
          item.created_by_name,
          item.digest_type,
          item.target_channel,
          item.status,
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [items, typeFilter, channelFilter, statusFilter, creatorFilter, search])

  const openEditor = (draft?: Draft) => {
    setEditorDraft(draft ? { ...draft } : { ...EMPTY_DRAFT })
    setEditorOpen(true)
  }

  const handleCopy = async (text: string) => {
    const ok = await copyText(text || '')
    if (ok) setSuccess('Digest copied to clipboard.')
  }

  const saveEditor = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (editorDraft.id) {
        const updated = await updateLinearDigestOutboxApi(editorDraft.id, {
          title: editorDraft.title,
          digest_type: editorDraft.digest_type,
          target_channel: editorDraft.target_channel,
          status: editorDraft.status,
          content: editorDraft.content,
        })
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        setSuccess('Draft updated.')
      } else {
        const created = await createLinearDigestOutboxApi({
          title: editorDraft.title,
          digest_type: editorDraft.digest_type,
          target_channel: editorDraft.target_channel,
          status: editorDraft.status,
          content: editorDraft.content,
        })
        setItems((current) => [created, ...current])
        setSuccess('Draft created.')
      }
      setEditorOpen(false)
    } catch (saveError: any) {
      setError(saveError?.message || 'Failed to save digest draft.')
    } finally {
      setSaving(false)
    }
  }

  const patchStatus = async (item: Draft, status: LinearDigestOutboxStatus) => {
    try {
      const updated = await updateLinearDigestOutboxApi(item.id, { status })
      setItems((current) => current.map((row) => (row.id === item.id ? updated : row)))
      setSuccess(status === 'copied' ? 'Draft marked copied.' : 'Draft archived.')
    } catch (patchError: any) {
      setError(patchError?.message || 'Failed to update digest draft.')
    }
  }

  const handleDelete = async (item: Draft) => {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    try {
      await deleteLinearDigestOutboxApi(item.id)
      setItems((current) => current.filter((row) => row.id !== item.id))
      setSuccess('Draft deleted.')
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Failed to delete digest draft.')
    }
  }

  if (!canOpen) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to view the digest outbox."
      />
    )
  }

  return (
    <div className="ldo-shell">
      <LinearSidebar />

      <main className="ldo-page">
        <header className="ldo-header">
          <div>
            <h1>Digest Outbox</h1>
            <p>Saved updates ready to copy into WhatsApp or email.</p>
          </div>
          <button type="button" className="ldo-btn ldo-btn--primary" onClick={() => openEditor()}>
            <FilePlus2 size={14} />
            New Custom Draft
          </button>
        </header>

        {(error || success) && (
          <div className={`ldo-banner ${error ? 'ldo-banner--error' : 'ldo-banner--success'}`}>
            {error || success}
          </div>
        )}

        <section className="ldo-filters">
          <input
            className="ldo-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search drafts"
          />
          <select className="ldo-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All digest types</option>
            {LINEAR_DIGEST_OUTBOX_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select className="ldo-select" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="all">All channels</option>
            {LINEAR_DIGEST_OUTBOX_CHANNELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select className="ldo-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {LINEAR_DIGEST_OUTBOX_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select className="ldo-select" value={creatorFilter} onChange={(event) => setCreatorFilter(event.target.value)}>
            <option value="all">All creators</option>
            {creatorOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </section>

        {loading && (
          <div className="ldo-empty">
            <Loader2 size={16} className="ldo-spin" />
            Loading outbox…
          </div>
        )}

        {!loading && filteredItems.length === 0 && (
          <div className="ldo-empty">No digest drafts match the current filters.</div>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="ldo-grid">
            {filteredItems.map((item) => (
              <article key={item.id} className="ldo-card">
                <div className="ldo-card__top">
                  <div>
                    <h2>{item.title}</h2>
                    <p>{snippet(item.content || '')}</p>
                  </div>
                  <div className="ldo-card__badges">
                    <span className="ldo-badge">{item.digest_type.replace(/_/g, ' ')}</span>
                    <span className="ldo-badge">{item.target_channel}</span>
                    <span className={`ldo-badge ldo-badge--status-${item.status}`}>{item.status}</span>
                  </div>
                </div>

                <div className="ldo-meta">
                  <span>Created by: {item.created_by_name || 'Unknown'}</span>
                  <span>Created: {fmtDate(item.created_at)}</span>
                  <span>Updated: {fmtDate(item.updated_at)}</span>
                </div>

                <div className="ldo-actions">
                  <button type="button" className="ldo-btn" onClick={() => openEditor(item)}>
                    <Pencil size={14} />
                    Open/Edit
                  </button>
                  <button type="button" className="ldo-btn" onClick={() => handleCopy(item.content || '')}>
                    <Copy size={14} />
                    Copy content
                  </button>
                  {canEditDigestOutbox(user, item) && (
                    <>
                      <button type="button" className="ldo-btn" onClick={() => patchStatus(item, 'copied')}>
                        <Copy size={14} />
                        Mark as Copied
                      </button>
                      <button type="button" className="ldo-btn" onClick={() => patchStatus(item, 'archived')}>
                        <Archive size={14} />
                        Archive
                      </button>
                      <button type="button" className="ldo-btn ldo-btn--danger" onClick={() => handleDelete(item)}>
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {editorOpen && (
          <div className="ldo-modal">
            <div className="ldo-modal__card">
              <div className="ldo-modal__header">
                <div>
                  <h2>{editorDraft.id ? 'Edit Draft' : 'New Draft'}</h2>
                  <p>Draft only. Nothing is sent automatically.</p>
                </div>
              </div>

              <label className="ldo-field">
                <span>Title</span>
                <input
                  className="ldo-input"
                  value={editorDraft.title}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, title: event.target.value }))}
                />
              </label>

              <div className="ldo-modal__grid">
                <label className="ldo-field">
                  <span>Digest type</span>
                  <select
                    className="ldo-select"
                    value={editorDraft.digest_type}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, digest_type: event.target.value as LinearDigestOutboxType }))}
                  >
                    {LINEAR_DIGEST_OUTBOX_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="ldo-field">
                  <span>Target channel</span>
                  <select
                    className="ldo-select"
                    value={editorDraft.target_channel}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, target_channel: event.target.value as LinearDigestOutboxChannel }))}
                  >
                    {LINEAR_DIGEST_OUTBOX_CHANNELS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="ldo-field">
                  <span>Status</span>
                  <select
                    className="ldo-select"
                    value={editorDraft.status}
                    onChange={(event) => setEditorDraft((current) => ({ ...current, status: event.target.value as LinearDigestOutboxStatus }))}
                  >
                    {LINEAR_DIGEST_OUTBOX_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="ldo-field">
                <span>Content</span>
                <textarea
                  className="ldo-textarea"
                  value={editorDraft.content}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, content: event.target.value }))}
                />
              </label>

              <div className="ldo-actions">
                <button type="button" className="ldo-btn ldo-btn--primary" onClick={saveEditor} disabled={saving}>
                  <Save size={14} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="ldo-btn" onClick={() => handleCopy(editorDraft.content || '')}>
                  <Copy size={14} />
                  Copy
                </button>
                {editorDraft.id && (
                  <button type="button" className="ldo-btn" onClick={() => patchStatus(editorDraft, 'copied')}>
                    <Copy size={14} />
                    Mark Copied
                  </button>
                )}
                <button type="button" className="ldo-btn" onClick={() => setEditorOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

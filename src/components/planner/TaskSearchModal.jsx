import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CheckCircle2, Circle, Clock, Trash2, ChevronRight, CheckCheck, AlertTriangle, FolderOpen } from 'lucide-react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'

const TABS = [
  { id: 'tasks',     label: 'Tasks' },
  { id: 'sections',  label: 'Sections' },
  { id: 'completed', label: 'Completed' },
]

const SAVED_SEARCHES = [
  { id: 'todo',      icon: <Circle size={14} />,       label: 'Tasks I still need to do',   filter: { status: 'todo' } },
  { id: 'assigned',  icon: <ChevronRight size={14} />, label: 'Overdue tasks',               filter: { overdue: true } },
  { id: 'completed', icon: <CheckCheck size={14} />,   label: 'Recently completed tasks',    filter: { status: 'done' } },
  { id: 'deleted',   icon: <Trash2 size={14} />,       label: 'Deleted tasks',               filter: { deleted: true } },
]

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDue(iso) {
  if (!iso) return null
  const parts = iso.split('-').map(Number)
  if (parts.length < 3) return null
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  const isOverdue = d < new Date(today.toDateString())
  const isToday = d.toDateString() === today.toDateString()
  const label = isToday ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { label, overdue: isOverdue && !isToday }
}

function TaskResultRow({ task, sectionTitle, onClick, active }) {
  const due = formatDue(task.dueDate)
  return (
    <button
      type="button"
      className={`tsm-result ${active ? 'tsm-result--active' : ''}`}
      onClick={onClick}
    >
      <span className={`tsm-result__check ${task.status === 'done' ? 'done' : ''}`}>
        {task.status === 'done'
          ? <CheckCircle2 size={15} />
          : <Circle size={15} />
        }
      </span>
      <span className="tsm-result__body">
        <span className={`tsm-result__title ${task.status === 'done' ? 'tsm-result__title--done' : ''}`}>
          {task.title || 'Untitled'}
        </span>
        {sectionTitle && (
          <span className="tsm-result__sub">
            <FolderOpen size={11} />
            {sectionTitle}
          </span>
        )}
      </span>
      {due && (
        <span className={`tsm-result__due ${due.overdue ? 'overdue' : ''}`}>
          {due.overdue && <AlertTriangle size={11} />}
          {due.label}
        </span>
      )}
    </button>
  )
}

export function TaskSearchModal({ onClose }) {
  const { rawTasks, sections, recentTaskIds, trashedTasks, setActiveTaskId } = useAIPlanner()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('tasks')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sectionMap = useMemo(() =>
    Object.fromEntries(sections.map((s) => [s.id, s.title]))
  , [sections])

  const recentTasks = useMemo(() =>
    recentTaskIds
      .map((id) => rawTasks.find((t) => t.id === id))
      .filter(Boolean)
      .slice(0, 6)
  , [recentTaskIds, rawTasks])

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const pool = tab === 'completed'
      ? rawTasks.filter((t) => t.status === 'done')
      : tab === 'sections'
        ? []
        : rawTasks

    return pool
      .filter((t) => {
        const text = `${t.title || ''} ${t.description || ''} ${t.notes || ''}`.toLowerCase()
        return text.includes(q)
      })
      .slice(0, 20)
  }, [query, tab, rawTasks])

  const sectionResults = useMemo(() => {
    if (tab !== 'sections') return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return sections.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 10)
  }, [query, tab, sections])

  const totalResults = tab === 'sections' ? sectionResults.length : searchResults.length

  useEffect(() => { setCursor(0) }, [query, tab])

  const openTask = useCallback((task) => {
    onClose()
    navigate('/projects')
    setTimeout(() => setActiveTaskId(task.id), 100)
  }, [onClose, navigate, setActiveTaskId])

  const handleSavedSearch = useCallback((filter) => {
    if (filter.deleted) {
      onClose()
      navigate('/projects/trash')
      return
    }
    if (filter.status === 'todo') setQuery('');  setTab('tasks')
    if (filter.status === 'done') { setTab('completed'); setQuery(' '); return }
    if (filter.overdue) { setTab('tasks'); setQuery('overdue ') }
  }, [onClose, navigate])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, totalResults - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (tab !== 'sections' && searchResults[cursor]) openTask(searchResults[cursor])
    }
  }, [onClose, cursor, totalResults, tab, searchResults, openTask])

  const showRecents = !query.trim() && tab === 'tasks'

  return (
    <>
      {/* Backdrop */}
      <div className="tsm-backdrop" onClick={onClose} aria-hidden />

      {/* Modal */}
      <div
        className="tsm-shell"
        role="dialog"
        aria-modal
        aria-label="Search tasks"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="tsm-input-row">
          <Search size={18} className="tsm-input-icon" />
          <input
            ref={inputRef}
            className="tsm-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, sections…"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="tsm-input-clear" onClick={() => setQuery('')}>×</button>
          )}
          <span className="tsm-esc-hint">esc</span>
        </div>

        {/* Tabs */}
        <div className="tsm-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tsm-tab ${tab === t.id ? 'tsm-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tsm-body">
          {/* Recents (no query) */}
          {showRecents && recentTasks.length > 0 && (
            <div className="tsm-group">
              <div className="tsm-group-label">
                <Clock size={12} />
                Recents
              </div>
              {recentTasks.map((task) => (
                <TaskResultRow
                  key={task.id}
                  task={task}
                  sectionTitle={sectionMap[task.sectionId] || null}
                  onClick={() => openTask(task)}
                  active={false}
                />
              ))}
            </div>
          )}

          {/* Search results */}
          {query.trim() && tab !== 'sections' && (
            <>
              {searchResults.length > 0 ? (
                <div className="tsm-group">
                  <div className="tsm-group-label">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </div>
                  {searchResults.map((task, i) => (
                    <TaskResultRow
                      key={task.id}
                      task={task}
                      sectionTitle={sectionMap[task.sectionId] || null}
                      onClick={() => openTask(task)}
                      active={i === cursor}
                    />
                  ))}
                </div>
              ) : (
                <div className="tsm-empty">No tasks match "{query.trim()}"</div>
              )}
            </>
          )}

          {/* Section search */}
          {query.trim() && tab === 'sections' && (
            <>
              {sectionResults.length > 0 ? (
                <div className="tsm-group">
                  <div className="tsm-group-label">{sectionResults.length} section{sectionResults.length !== 1 ? 's' : ''}</div>
                  {sectionResults.map((sec, i) => (
                    <button
                      key={sec.id}
                      type="button"
                      className={`tsm-result ${i === cursor ? 'tsm-result--active' : ''}`}
                      onClick={() => { onClose(); navigate('/projects') }}
                    >
                      <span className="tsm-result__check">
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: sec.color, display: 'inline-block' }} />
                      </span>
                      <span className="tsm-result__body">
                        <span className="tsm-result__title">{sec.title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="tsm-empty">No sections match "{query.trim()}"</div>
              )}
            </>
          )}

          {/* Saved searches (shown when no query) */}
          {!query.trim() && (
            <div className="tsm-group">
              <div className="tsm-group-label">Saved searches</div>
              <div className="tsm-saved-list">
                {SAVED_SEARCHES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="tsm-saved-item"
                    onClick={() => handleSavedSearch(s.filter)}
                  >
                    <span className="tsm-saved-icon">{s.icon}</span>
                    {s.label}
                    {s.id === 'deleted' && trashedTasks.length > 0 && (
                      <span className="tsm-trash-badge">{trashedTasks.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tsm-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open task</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </>
  )
}

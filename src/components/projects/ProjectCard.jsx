import { Calendar, CheckSquare, AlertCircle, MoreHorizontal, Archive, Trash2, Edit2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { STATUS_COLORS, PRIORITY_COLORS, formatDueDate } from '../../utils/projectUtils'

function StatusBadge({ status }) {
  const key = status?.toLowerCase().replace(/\s+/g, '-')
  return <span className={`pm-badge pm-badge-status-${key}`}>{status}</span>
}

function PriorityBadge({ priority }) {
  const key = priority?.toLowerCase()
  return <span className={`pm-badge pm-badge-priority-${key}`}>{priority}</span>
}

export function ProjectCard({ project, onOpen, onEdit, onDelete, onArchive }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const due = formatDueDate(project.due_date)
  const progress = project.progress ?? 0

  return (
    <div
      className="pm-project-card"
      style={{ '--project-color': project.color || '#8b5cf6' }}
      onClick={() => onOpen?.(project)}
    >
      <div className="pm-project-card-header">
        <div>
          <div className="pm-project-card-title">{project.name}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          <StatusBadge status={project.status} />
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              className="pm-btn-icon"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              title="Actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 50,
                background: 'var(--theme-panel-bg)', border: '1px solid var(--theme-border)',
                borderRadius: 10, minWidth: 150, boxShadow: 'var(--theme-shadow)',
                overflow: 'hidden',
              }}>
                {[
                  { icon: <Edit2 size={13} />, label: 'Edit', action: onEdit },
                  { icon: <Archive size={13} />, label: project.archived ? 'Unarchive' : 'Archive', action: onArchive },
                  { icon: <Trash2 size={13} />, label: 'Delete', action: onDelete, danger: true },
                ].map(({ icon, label, action, danger }) => (
                  <button
                    key={label}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); action?.(project) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.55rem',
                      width: '100%', padding: '0.55rem 0.85rem', background: 'none',
                      border: 'none', cursor: 'pointer', fontSize: '0.82rem',
                      color: danger ? '#f87171' : 'var(--theme-text-soft)',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--theme-surface-soft)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {project.description && (
        <div className="pm-project-card-desc">{project.description}</div>
      )}

      <div className="pm-project-card-meta">
        <PriorityBadge priority={project.priority} />
        {due && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={11} />
            <span style={{ color: due.overdue ? '#f87171' : 'inherit' }}>{due.label}</span>
          </span>
        )}
      </div>

      <div className="pm-project-card-stats">
        <div className="pm-stat-box">
          <div className="pm-stat-box-value">{project.task_count || 0}</div>
          <div className="pm-stat-box-label">Tasks</div>
        </div>
        <div className="pm-stat-box">
          <div className="pm-stat-box-value" style={{ color: '#4ade80' }}>{project.completed_count || 0}</div>
          <div className="pm-stat-box-label">Done</div>
        </div>
        <div className="pm-stat-box">
          <div className="pm-stat-box-value" style={{ color: project.overdue_count > 0 ? '#f87171' : 'inherit' }}>{project.overdue_count || 0}</div>
          <div className="pm-stat-box-label">Overdue</div>
        </div>
      </div>

      <div className="pm-progress-bar-wrap">
        <div className="pm-progress-bar-fill" style={{ width: `${progress}%`, background: project.color || undefined }} />
      </div>
      <div className="pm-progress-label">{progress}% complete</div>
    </div>
  )
}

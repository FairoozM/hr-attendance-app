import { useState } from 'react'
import { ChevronDown, Plus, MoreHorizontal, Pencil, Trash2, Check, X } from 'lucide-react'

export function SectionHeader({ section, taskCount, collapsed, onToggle, onAddTask, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(section.name)
  const [menuOpen, setMenuOpen] = useState(false)

  function handleRename() {
    if (name.trim() && name.trim() !== section.name) {
      onRename?.(section.id, name.trim())
    }
    setEditing(false)
  }

  return (
    <div className="pm-section-header" onClick={!editing ? onToggle : undefined}>
      <ChevronDown size={14} className={`pm-section-chevron${collapsed ? ' collapsed' : ''}`} />

      {editing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setName(section.name); setEditing(false) } }}
            style={{ flex: 1, background: 'var(--theme-input-bg)', border: '1px solid var(--theme-primary)', borderRadius: 6, padding: '0.2rem 0.5rem', fontSize: '0.82rem', color: 'var(--theme-text)', outline: 'none' }}
          />
          <button className="pm-btn-icon pm-btn-sm" onClick={handleRename}><Check size={12} /></button>
          <button className="pm-btn-icon pm-btn-sm" onClick={() => { setName(section.name); setEditing(false) }}><X size={12} /></button>
        </div>
      ) : (
        <span className="pm-section-name">{section.name}</span>
      )}

      <span className="pm-section-count">{taskCount}</span>

      {!editing && (
        <div className="pm-section-actions" onClick={(e) => e.stopPropagation()}>
          <button className="pm-btn-icon pm-btn-sm" onClick={() => onAddTask?.(section.id)} title="Add task">
            <Plus size={13} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="pm-btn-icon pm-btn-sm" onClick={() => setMenuOpen((v) => !v)} title="More">
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute', right: 0, top: '110%', zIndex: 50,
                  background: 'var(--theme-panel-bg)', border: '1px solid var(--theme-border)',
                  borderRadius: 10, minWidth: 140, boxShadow: 'var(--theme-shadow)', overflow: 'hidden',
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                {[
                  { icon: <Pencil size={12} />, label: 'Rename', action: () => { setEditing(true); setMenuOpen(false) } },
                  { icon: <Trash2 size={12} />, label: 'Delete', action: () => { setMenuOpen(false); onDelete?.(section.id) }, danger: true },
                ].map(({ icon, label, action, danger }) => (
                  <button
                    key={label}
                    onClick={action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      width: '100%', padding: '0.5rem 0.75rem', background: 'none',
                      border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                      color: danger ? '#f87171' : 'var(--theme-text-soft)',
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
      )}
    </div>
  )
}

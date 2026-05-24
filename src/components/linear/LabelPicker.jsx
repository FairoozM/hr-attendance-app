/**
 * LabelPicker.jsx
 * Inline multi-select for issue labels.
 * Shows selected labels as removable chips.
 * Opens a compact dropdown to add from DEFAULT_LABELS or type a custom one.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Tag, X, Plus, Check } from 'lucide-react'
import { DEFAULT_LABELS, labelColors } from './linearLabels'
import './LabelPicker.css'

function LabelChip({ label, onRemove, disabled }) {
  const c = labelColors(label)
  return (
    <span
      className="lpk__chip"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
    >
      {label}
      {!disabled && (
        <button
          type="button"
          className="lpk__chip-remove"
          onClick={() => onRemove(label)}
          aria-label={`Remove label ${label}`}
        >
          <X size={9} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

export function LabelPicker({ labels = [], onChange, disabled = false, maxVisible = 20 }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 200 })

  const selected = Array.isArray(labels) ? labels : []

  const filtered = DEFAULT_LABELS.filter(
    (l) =>
      !selected.includes(l) &&
      (search === '' || l.toLowerCase().includes(search.toLowerCase()))
  )

  const openMenu = useCallback(() => {
    if (disabled) return
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({
        top:   r.bottom + 4,
        left:  r.left,
        width: Math.max(r.width, 180),
      })
    }
    setOpen(true)
    setSearch('')
    setTimeout(() => inputRef.current?.focus(), 40)
  }, [disabled])

  const closeMenu = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) closeMenu()
    }
    function onKey(e) { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, closeMenu])

  function toggle(label) {
    if (selected.includes(label)) {
      onChange(selected.filter((l) => l !== label))
    } else {
      onChange([...selected, label])
    }
  }

  function addCustom() {
    const t = search.trim()
    if (!t || selected.includes(t)) { setSearch(''); return }
    onChange([...selected, t])
    setSearch('')
  }

  const showCustom = search.trim() && !DEFAULT_LABELS.some(
    (l) => l.toLowerCase() === search.trim().toLowerCase()
  )

  return (
    <div className="lpk">
      {/* Selected chips */}
      <div className="lpk__chips">
        {selected.slice(0, maxVisible).map((lbl) => (
          <LabelChip
            key={lbl}
            label={lbl}
            onRemove={(l) => onChange(selected.filter((x) => x !== l))}
            disabled={disabled}
          />
        ))}

        {/* Add button */}
        {!disabled && (
          <button
            ref={triggerRef}
            type="button"
            className="lpk__add-btn"
            onClick={open ? closeMenu : openMenu}
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
            {selected.length === 0 && <span>Add label</span>}
          </button>
        )}
      </div>

      {/* Dropdown portal */}
      {open && createPortal(
        <div
          ref={menuRef}
          className="lpk__menu"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          role="listbox"
          aria-multiselectable="true"
        >
          {/* Search / custom input */}
          <div className="lpk__search-wrap">
            <Tag size={11} strokeWidth={2} className="lpk__search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="lpk__search"
              placeholder="Filter or add label…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCustom() }
              }}
            />
          </div>

          <div className="lpk__options">
            {/* Custom label option */}
            {showCustom && (
              <button
                type="button"
                className="lpk__option lpk__option--custom"
                onMouseDown={(e) => { e.preventDefault(); addCustom() }}
              >
                <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
                Create "{search.trim()}"
              </button>
            )}

            {/* Existing labels already selected (shown with checkmark) */}
            {selected
              .filter((l) => search === '' || l.toLowerCase().includes(search.toLowerCase()))
              .map((lbl) => {
                const c = labelColors(lbl)
                return (
                  <button
                    key={lbl}
                    type="button"
                    role="option"
                    aria-selected="true"
                    className="lpk__option lpk__option--selected"
                    onMouseDown={(e) => { e.preventDefault(); toggle(lbl) }}
                  >
                    <span className="lpk__dot" style={{ background: c.text }} />
                    <span className="lpk__option-label">{lbl}</span>
                    <Check size={11} strokeWidth={2.5} className="lpk__check" aria-hidden="true" />
                  </button>
                )
              })
            }

            {/* Available labels (not yet selected) */}
            {filtered.map((lbl) => {
              const c = labelColors(lbl)
              return (
                <button
                  key={lbl}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="lpk__option"
                  onMouseDown={(e) => { e.preventDefault(); toggle(lbl) }}
                >
                  <span className="lpk__dot" style={{ background: c.text }} />
                  <span className="lpk__option-label">{lbl}</span>
                </button>
              )
            })}

            {filtered.length === 0 && !showCustom && selected.filter((l) => search === '' || l.toLowerCase().includes(search.toLowerCase())).length === 0 && (
              <p className="lpk__empty">No labels found</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default LabelPicker

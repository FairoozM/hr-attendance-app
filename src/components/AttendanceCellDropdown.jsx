/**
 * AttendanceCellDropdown
 *
 * Custom dropdown that replaces the native <select> in the attendance grid.
 * - Shows a compact colored pill (the status code) as the trigger.
 * - Opens a portal-based menu positioned with getBoundingClientRect so it never
 *   breaks table layout.
 * - Full keyboard navigation: ArrowUp/Down, Enter/Space, Escape.
 * - Closes on outside click, Escape, or option selection.
 *
 * Props mirror the old <select>:
 *   value        string  — current status key ('P' | 'A' | 'SL' | 'AL' | 'WH' | '')
 *   onChange     fn      — called with the new key string ('' = clear)
 *   ariaLabel    string  — accessible label for the trigger button
 *   dimmed       bool    — lower opacity when cell-highlight mode is active
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import './AttendanceCellDropdown.css'

const STATUS_CONFIG = [
  {
    code: '',
    label: '—',
    description: 'Clear status',
    colorVar: 'neutral',
  },
  {
    code: 'P',
    label: 'Present',
    description: 'Employee is present',
    colorVar: 'success',
  },
  {
    code: 'A',
    label: 'Absent',
    description: 'Employee is absent',
    colorVar: 'danger',
  },
  {
    code: 'SL',
    label: 'Sick Leave',
    description: 'Approved sick leave',
    colorVar: 'warning',
  },
  {
    code: 'AL',
    label: 'Annual Leave',
    description: 'Approved annual leave',
    colorVar: 'accent',
  },
  {
    code: 'WH',
    label: 'Weekly Holiday',
    description: 'Weekly day off',
    colorVar: 'weekly-holiday',
  },
]

export function AttendanceCellDropdown({ value = '', onChange, ariaLabel, dimmed }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState({})
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const currentConfig = STATUS_CONFIG.find((s) => s.code === (value || '')) ?? STATUS_CONFIG[0]

  /** Position the floating menu relative to the trigger */
  const positionMenu = useCallback(() => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const MENU_H = 260

    let top, transformOrigin
    if (spaceBelow >= MENU_H || spaceBelow >= 140) {
      top = rect.bottom + 4
      transformOrigin = 'top center'
    } else {
      top = rect.top - 4
      transformOrigin = 'bottom center'
    }

    // center the 240px menu on the trigger, clamped within viewport
    const menuW = 240
    let left = rect.left + rect.width / 2 - menuW / 2
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8))

    setMenuStyle({
      position: 'fixed',
      top: spaceBelow >= 140 ? `${top}px` : 'auto',
      bottom: spaceBelow < 140 ? `${window.innerHeight - rect.top + 4}px` : 'auto',
      left: `${left}px`,
      width: `${menuW}px`,
      transformOrigin,
      zIndex: 9999,
    })
  }, [])

  const openMenu = useCallback(() => {
    positionMenu()
    const idx = STATUS_CONFIG.findIndex((s) => s.code === (value || ''))
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [positionMenu, value])

  const closeMenu = useCallback(() => setOpen(false), [])

  const selectOption = useCallback(
    (code) => {
      onChange(code)
      closeMenu()
    },
    [onChange, closeMenu]
  )

  /* Close on outside click */
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e) {
      if (
        triggerRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      ) return
      closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, closeMenu])

  /* Reposition on scroll / resize while open */
  useEffect(() => {
    if (!open) return
    function handle() { positionMenu() }
    window.addEventListener('scroll', handle, { passive: true, capture: true })
    window.addEventListener('resize', handle, { passive: true })
    return () => {
      window.removeEventListener('scroll', handle, { capture: true })
      window.removeEventListener('resize', handle)
    }
  }, [open, positionMenu])

  /* Focus first item when menu opens */
  useEffect(() => {
    if (open) {
      const items = menuRef.current?.querySelectorAll('[role="option"]')
      items?.[activeIndex]?.focus()
    }
  }, [open, activeIndex])

  /* Keyboard navigation on trigger */
  function handleTriggerKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu()
    }
  }

  /* Keyboard navigation inside menu */
  function handleMenuKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (activeIndex + 1) % STATUS_CONFIG.length
      setActiveIndex(next)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (activeIndex - 1 + STATUS_CONFIG.length) % STATUS_CONFIG.length
      setActiveIndex(prev)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectOption(STATUS_CONFIG[activeIndex].code)
    }
    if (e.key === 'Tab') {
      closeMenu()
    }
  }

  return (
    <>
      {/* Trigger pill */}
      <button
        ref={triggerRef}
        type="button"
        className={`acd-trigger acd-trigger--${currentConfig.colorVar}${dimmed ? ' acd-trigger--dimmed' : ''}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={currentConfig.label}
      >
        <span className="acd-trigger__code">
          {currentConfig.code || '—'}
        </span>
      </button>

      {/* Floating menu via portal */}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Select attendance status"
            className="acd-menu"
            style={menuStyle}
            onKeyDown={handleMenuKey}
          >
            {STATUS_CONFIG.map((s, idx) => {
              const isSelected = s.code === (value || '')
              const isActive = idx === activeIndex
              return (
                <div
                  key={s.code}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`acd-option acd-option--${s.colorVar}${isSelected ? ' acd-option--selected' : ''}${isActive ? ' acd-option--active' : ''}`}
                  onClick={() => selectOption(s.code)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onFocus={() => setActiveIndex(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectOption(s.code)
                    }
                  }}
                >
                  {/* Colored dot */}
                  <span className={`acd-option__dot acd-option__dot--${s.colorVar}`} aria-hidden="true" />

                  {/* Label + description */}
                  <span className="acd-option__text">
                    <span className="acd-option__label">{s.label}</span>
                    {s.description && (
                      <span className="acd-option__desc">{s.description}</span>
                    )}
                  </span>

                  {/* Short code badge */}
                  {s.code && (
                    <span className={`acd-option__badge acd-option__badge--${s.colorVar}`}>
                      {s.code}
                    </span>
                  )}

                  {/* Selected checkmark */}
                  <span className="acd-option__check" aria-hidden="true">
                    {isSelected && <Check size={12} strokeWidth={2.8} />}
                  </span>
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

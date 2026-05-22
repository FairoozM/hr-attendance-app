/**
 * ModernSelect — a polished custom dropdown for filter toolbars.
 *
 * Works with any option shape:
 *   string[]  →  value and label are the string itself
 *   number[]  →  value and label are the number as string
 *   { value, label }[]
 *   { id, name }[]
 *   Custom shape via getLabel / getValue props
 *
 * Props:
 *   label        string   optional rendered label above the trigger
 *   value        any      current value (matched against option values via String coercion)
 *   options      any[]    list of options
 *   onChange     fn       called with the selected option's value (raw, not coerced)
 *   placeholder  string   shown when nothing is selected
 *   disabled     bool
 *   className    string
 *   getLabel     fn(opt)  → string
 *   getValue     fn(opt)  → string | number
 *   clearable    bool     show an X button to clear the current value
 *   size         'sm'|'md'|'lg'
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
import './ModernSelect.css'

function toSafeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value.label === 'string') return value.label
    if (typeof value.name === 'string') return value.name
    if (typeof value.short === 'string') return value.short
    if (value.value !== undefined) return String(value.value)
    if (value.id !== undefined) return String(value.id)
  }
  return fallback
}

export function ModernSelect({
  label,
  value,
  options = [],
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  getLabel,
  getValue,
  clearable = false,
  size = 'md',
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState({})
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const getOptionValue = useCallback(
    (opt) => {
      if (getValue) return getValue(opt)
      if (opt !== null && typeof opt === 'object') {
        if ('value' in opt) return opt.value
        if ('id' in opt) return opt.id
      }
      return opt
    },
    [getValue]
  )

  const getOptionLabel = useCallback(
    (opt) => {
      if (getLabel) return toSafeString(getLabel(opt))
      if (opt !== null && typeof opt === 'object') {
        return (
          toSafeString(opt.label) ||
          toSafeString(opt.name) ||
          toSafeString(opt.short) ||
          toSafeString(opt.value) ||
          toSafeString(opt.id)
        )
      }
      return toSafeString(opt)
    },
    [getLabel]
  )

  const selectedOption = options.find((opt) => {
    const v = getOptionValue(opt)
    return value !== undefined && value !== null && String(v) === String(value)
  })
  const displayLabel = selectedOption ? getOptionLabel(selectedOption) : ''

  const positionMenu = useCallback(() => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuW = Math.max(rect.width, 200)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8))

    setMenuStyle({
      position: 'fixed',
      top: spaceBelow >= 120 ? `${rect.bottom + 4}px` : 'auto',
      bottom: spaceBelow < 120 ? `${window.innerHeight - rect.top + 4}px` : 'auto',
      left: `${left}px`,
      minWidth: `${menuW}px`,
      maxWidth: `${Math.min(menuW + 100, 340)}px`,
      transformOrigin: spaceBelow >= 120 ? 'top center' : 'bottom center',
      zIndex: 9999,
    })
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    positionMenu()
    const idx = options.findIndex(
      (opt) => value !== undefined && value !== null && String(getOptionValue(opt)) === String(value)
    )
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [disabled, positionMenu, options, value, getOptionValue])

  const closeMenu = useCallback(() => setOpen(false), [])

  const selectOption = useCallback(
    (opt) => {
      onChange(getOptionValue(opt))
      closeMenu()
    },
    [onChange, getOptionValue, closeMenu]
  )

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      closeMenu()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open, closeMenu])

  useEffect(() => {
    if (!open) return
    function reposition() { positionMenu() }
    window.addEventListener('scroll', reposition, { passive: true, capture: true })
    window.addEventListener('resize', reposition, { passive: true })
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true })
      window.removeEventListener('resize', reposition)
    }
  }, [open, positionMenu])

  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll('[role="option"]')
    items?.[activeIndex]?.focus()
  }, [open, activeIndex])

  function handleTriggerKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openMenu()
    }
    if (e.key === 'Escape') closeMenu()
  }

  function handleMenuKey(e) {
    if (e.key === 'Escape') { closeMenu(); triggerRef.current?.focus(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % options.length); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + options.length) % options.length); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[activeIndex]) selectOption(options[activeIndex]) }
    if (e.key === 'Tab') closeMenu()
  }

  return (
    <div className={`ms-wrap ms-wrap--${size}${className ? ` ${className}` : ''}`}>
      {label && <span className="ms-label">{label}</span>}
      <button
        ref={triggerRef}
        type="button"
        className={`ms-trigger${open ? ' ms-trigger--open' : ''}${disabled ? ' ms-trigger--disabled' : ''}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={`ms-trigger__value${!displayLabel ? ' ms-trigger__value--placeholder' : ''}`}>
          {displayLabel || placeholder}
        </span>
        <span className="ms-trigger__icons">
          {clearable && displayLabel && (
            <span
              className="ms-trigger__clear"
              role="button"
              tabIndex={0}
              aria-label="Clear"
              onClick={(e) => { e.stopPropagation(); onChange(''); closeMenu() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange('') } }}
            >
              <X size={11} strokeWidth={2.5} />
            </span>
          )}
          <ChevronDown
            size={13}
            strokeWidth={2.2}
            className={`ms-trigger__chevron${open ? ' ms-trigger__chevron--open' : ''}`}
          />
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="ms-menu"
            style={menuStyle}
            onKeyDown={handleMenuKey}
          >
            {options.map((opt, idx) => {
              const optValue = getOptionValue(opt)
              const optLabel = getOptionLabel(opt)
              const isSelected = value !== undefined && value !== null && String(optValue) === String(value)
              const isActive = idx === activeIndex
              return (
                <div
                  key={String(optValue)}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`ms-option${isSelected ? ' ms-option--selected' : ''}${isActive ? ' ms-option--active' : ''}`}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onFocus={() => setActiveIndex(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(opt) }
                  }}
                >
                  <span className="ms-option__label">{optLabel}</span>
                  <span className="ms-option__check" aria-hidden="true">
                    {isSelected && <Check size={12} strokeWidth={2.8} />}
                  </span>
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

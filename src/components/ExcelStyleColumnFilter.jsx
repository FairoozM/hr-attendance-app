import { createPortal } from 'react-dom'
import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import './ExcelStyleColumnFilter.css'

/** True if the column filter is narrowed from “show all values”. */
export function excelFilterIsActive(included, allValues) {
  if (included === undefined || included === null) return false
  if (!allValues?.length) return false
  if (included.size === 0) return true
  if (included.size !== allValues.length) return true
  return !allValues.every((v) => included.has(v))
}

function IconFilter() {
  return (
    <svg className="excel-col-filter__funnel" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"
      />
    </svg>
  )
}

/**
 * Excel-like column filter: funnel opens a panel with (Select all) and per-value checkboxes.
 * `included`: `null`/`undefined` = all values pass; otherwise only checked values pass.
 */
export function ExcelStyleColumnFilter({
  filterId,
  openFilterId,
  onOpenFilterId,
  ariaLabel,
  options,
  included,
  onIncludedChange,
}) {
  const open = openFilterId === filterId
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const selectAllRef = useRef(null)
  const [panelStyle, setPanelStyle] = useState({})

  const allValues = useMemo(() => options.map((o) => o.value), [options])

  const effective = included == null ? new Set(allValues) : new Set(included)

  const allSelected = allValues.length > 0 && allValues.every((v) => effective.has(v))
  const noneSelected = effective.size === 0
  const someSelected = !allSelected && !noneSelected

  useLayoutEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const panelW = Math.max(rect.width, 220)
    let left = rect.left
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8
    if (left < 8) left = 8
    const maxH = 280
    let top = rect.bottom + 4
    if (top + maxH > window.innerHeight - 8) {
      top = Math.max(8, rect.top - 8 - maxH)
    }
    setPanelStyle({
      position: 'fixed',
      top,
      left,
      minWidth: panelW,
      maxHeight: maxH,
      zIndex: 5000,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onOpenFilterId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenFilterId])

  useEffect(() => {
    if (!open) return
    let active = true
    function onDocPointerDown(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      onOpenFilterId(null)
    }
    const id = requestAnimationFrame(() => {
      if (!active) return
      document.addEventListener('pointerdown', onDocPointerDown, true)
    })
    return () => {
      active = false
      cancelAnimationFrame(id)
      document.removeEventListener('pointerdown', onDocPointerDown, true)
    }
  }, [open, onOpenFilterId])

  useEffect(() => {
    if (!open) return
    function onScroll() {
      onOpenFilterId(null)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open, onOpenFilterId])

  const isActive = excelFilterIsActive(included, allValues)

  function handleSelectAll(checked) {
    if (checked) onIncludedChange(null)
    else onIncludedChange(new Set())
  }

  function handleToggleValue(value, checked) {
    const base = included == null ? new Set(allValues) : new Set(included)
    if (checked) base.add(value)
    else base.delete(value)
    if (allValues.length > 0 && allValues.every((v) => base.has(v))) onIncludedChange(null)
    else onIncludedChange(base)
  }

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="excel-col-filter__panel"
        style={panelStyle}
        role="dialog"
        aria-label={ariaLabel}
      >
        <label className="excel-col-filter__row excel-col-filter__row--all">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={(e) => handleSelectAll(e.target.checked)}
          />
          <span>(Select all)</span>
        </label>
        <div className="excel-col-filter__list">
          {options.length === 0 ? (
            <p className="excel-col-filter__empty">No values</p>
          ) : (
            options.map((o) => (
              <label key={String(o.value)} className="excel-col-filter__row">
                <input
                  type="checkbox"
                  checked={effective.has(o.value)}
                  onChange={(e) => handleToggleValue(o.value, e.target.checked)}
                />
                <span className="excel-col-filter__opt-label">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </div>,
      document.body
    )

  return (
    <div className="excel-col-filter">
      <button
        type="button"
        ref={triggerRef}
        className={`excel-col-filter__trigger${isActive ? ' excel-col-filter__trigger--active' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onOpenFilterId(open ? null : filterId)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
      >
        <IconFilter />
      </button>
      {panel}
    </div>
  )
}

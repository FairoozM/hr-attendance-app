import { ChevronDown, Download, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface Props {
  periodLabel: string
  employeeCount: number
  scopeLabel: string
  dayLabel: string
  monthLabel: string
  exportDisabled: boolean
  onExportDay: () => void
  onExportMonth: () => void
  onOpenSettings: () => void
}

export function AttendanceHeader({
  periodLabel,
  employeeCount,
  scopeLabel,
  dayLabel,
  monthLabel,
  exportDisabled,
  onExportDay,
  onExportMonth,
  onOpenSettings,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <header className="att-header">
      <div className="att-header__text">
        <h1 className="att-header__title">Attendance</h1>
        <p className="att-header__meta">
          {periodLabel} · {employeeCount} employee{employeeCount === 1 ? '' : 's'}
          {scopeLabel && <span className="att-header__scope"> · {scopeLabel}</span>}
        </p>
      </div>
      <div className="att-header__actions">
        <button type="button" className="att-btn att-btn--ghost" onClick={onOpenSettings}>
          <Settings2 size={15} aria-hidden /> Holiday settings
        </button>
        <div
          className="att-dropdown"
          ref={wrapRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              setOpen(false)
              wrapRef.current?.querySelector<HTMLElement>('button')?.focus()
            }
          }}
        >
          <button
            type="button"
            className="att-btn att-btn--primary"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={exportDisabled}
            onClick={() => setOpen((v) => !v)}
          >
            <Download size={15} aria-hidden /> Export <ChevronDown size={14} aria-hidden />
          </button>
          {open && (
            <div className="att-dropdown__menu" role="menu">
              <button type="button" role="menuitem" className="att-dropdown__item" autoFocus onClick={() => choose(onExportDay)}>
                <strong>Selected day</strong>
                <span>{dayLabel} · CSV</span>
              </button>
              <button type="button" role="menuitem" className="att-dropdown__item" onClick={() => choose(onExportMonth)}>
                <strong>Whole month</strong>
                <span>{monthLabel} · CSV</span>
              </button>
              <p className="att-dropdown__note">
                Includes the {employeeCount} employee{employeeCount === 1 ? '' : 's'} in the current department and search
                filter.
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

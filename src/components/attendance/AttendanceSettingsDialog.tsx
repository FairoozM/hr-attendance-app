import { X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WEEKDAY_NAMES } from '../../utils/attendance/attendanceCalendar'

interface Props {
  defaultWeeklyOff: number
  employeesWithOwnDay: number
  totalEmployees: number
  onSave: (day: number) => void
  onClose: () => void
}

export function AttendanceSettingsDialog({ defaultWeeklyOff, employeesWithOwnDay, totalEmployees, onSave, onClose }: Props) {
  const [day, setDay] = useState(defaultWeeklyOff)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('select')?.focus()
    return () => returnFocus.current?.focus()
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, select') ?? [])].filter(
      (el) => !el.hasAttribute('disabled')
    )
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const usingDefault = totalEmployees - employeesWithOwnDay

  return createPortal(
    <div className="att-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="att-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="att-settings-title"
        onKeyDown={onKeyDown}
      >
        <div className="att-modal__head">
          <h2 id="att-settings-title">Weekly holiday settings</h2>
          <button type="button" className="att-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="att-modal__body">
          <label className="att-field">
            <span className="att-field__label">Default weekly holiday</span>
            <select className="att-select" value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {WEEKDAY_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <ul className="att-modal__facts">
            <li>
              Applies to the {usingDefault} employee{usingDefault === 1 ? '' : 's'} without a weekly off day in their
              profile. {employeesWithOwnDay > 0 && `${employeesWithOwnDay} follow their own profile day.`}
            </li>
            <li>Only fills days with nothing recorded. Recorded attendance and approved leave are never changed.</li>
            <li>Saved to your account preferences and used for scheduled “WH” days and totals on this page.</li>
          </ul>
        </div>
        <div className="att-modal__foot">
          <button type="button" className="att-btn att-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="att-btn att-btn--primary"
            disabled={day === defaultWeeklyOff}
            onClick={() => {
              onSave(day)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

import { Check, Eye, Loader2, Lock, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CellAction, CellSaveState } from '../../hooks/attendance/useAttendanceMonth'
import { type CalendarDate, formatDate } from '../../utils/attendance/attendanceCalendar'
import {
  type AttendanceEmployee,
  type CellInfo,
  cellSourceLabel,
  STATUS_CODES,
  STATUS_LABELS,
  type StatusCode,
} from '../../utils/attendance/attendanceModel'

const SHORTCUTS: Record<string, StatusCode> = { p: 'P', a: 'A', s: 'SL', l: 'AL', w: 'WH' }
const SHORTCUT_HINT: Record<StatusCode, string> = { P: 'P', A: 'A', SL: 'S', AL: 'L', WH: 'W' }
const MENU_WIDTH = 288

interface Props {
  anchor: HTMLElement
  employee: AttendanceEmployee
  date: CalendarDate
  cell: CellInfo
  canManage: boolean
  saveState: CellSaveState | undefined
  onAction: (action: CellAction) => void
  onUpload: (file: File) => void
  onRemoveDocument: () => void
  onDismissError: () => void
  onClose: () => void
}

export function AttendanceCellMenu({
  anchor,
  employee,
  date,
  cell,
  canManage,
  saveState,
  onAction,
  onUpload,
  onRemoveDocument,
  onDismissError,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [overrideLeave, setOverrideLeave] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const saving = saveState?.state === 'saving'
  const locked = cell.approvedLeave && !overrideLeave
  const editable = canManage && !saving && !locked

  const place = useCallback(() => {
    const rect = anchor.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 320
    const spaceBelow = window.innerHeight - rect.bottom
    const top =
      spaceBelow >= menuHeight + 12 || spaceBelow > rect.top
        ? Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8)
        : Math.max(8, rect.top - menuHeight - 6)
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - MENU_WIDTH / 2, window.innerWidth - MENU_WIDTH - 8))
    setPosition({ top: Math.max(8, top), left })
  }, [anchor])

  useLayoutEffect(() => {
    place()
  }, [place, cell, saveState, overrideLeave])

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? menuRef.current
    first?.focus()
  }, [])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    function onScroll(event: Event) {
      if (menuRef.current?.contains(event.target as Node)) return
      place()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, onClose, place])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not(:disabled)') ?? [])]
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1
      items[(next + items.length) % items.length].focus()
      return
    }
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || event.metaKey || event.ctrlKey || event.altKey) return
    const code = SHORTCUTS[event.key.toLowerCase()]
    if (code && editable) {
      event.preventDefault()
      onAction({ kind: 'status', status: code })
    }
  }

  const status = cell.status
  const canClearToSchedule = cell.weeklyOffDay && cell.record != null
  const canMarkNotHoliday = cell.weeklyOffDay && !cell.explicitBlank
  const canClear = !cell.weeklyOffDay && cell.record != null && !cell.explicitBlank
  const showCertificate = cell.kind === 'recorded' && status === 'SL'

  return createPortal(
    <div
      ref={menuRef}
      className="att-menu"
      role="dialog"
      aria-modal="false"
      aria-label={`Attendance for ${employee.name}, ${formatDate(date, { weekday: true })}`}
      tabIndex={-1}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: MENU_WIDTH }}
      onKeyDown={onKeyDown}
    >
      <div className="att-menu__head">
        <div className="att-menu__title">
          <strong title={employee.name}>{employee.name}</strong>
          <span>{formatDate(date, { weekday: true })}</span>
        </div>
        <button type="button" className="att-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>

      <p className="att-menu__current">
        {status ? (
          <span className={`att-badge att-badge--${cell.kind === 'scheduled' ? 'scheduled' : status}`}>{status}</span>
        ) : (
          <span className={`att-badge att-badge--${cell.kind === 'future' ? 'future' : 'unmarked'}`}>
            {cell.kind === 'future' ? '' : '–'}
          </span>
        )}
        <span>
          {status ? STATUS_LABELS[status] : cell.kind === 'future' ? 'Upcoming day' : 'Unmarked'}
          <small>{status ? cellSourceLabel(cell) : cell.explicitBlank ? 'Marked as not a holiday' : 'No record saved'}</small>
        </span>
        {saving && (
          <span className="att-menu__saving" role="status">
            <Loader2 size={14} className="att-spin" aria-hidden /> Saving…
          </span>
        )}
        {saveState?.state === 'saved' && (
          <span className="att-menu__saved" role="status">
            <Check size={14} aria-hidden /> Saved
          </span>
        )}
      </p>

      {saveState?.state === 'error' && (
        <div className="att-menu__error" role="alert">
          <span>{saveState.message}</span>
          <span className="att-menu__error-actions">
            {saveState.retry && (
              <button type="button" className="att-btn att-btn--sm" onClick={saveState.retry}>
                Retry
              </button>
            )}
            <button type="button" className="att-btn att-btn--sm att-btn--ghost" onClick={onDismissError}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      {!canManage && <p className="att-menu__note">You have view-only access to attendance.</p>}

      {canManage && cell.approvedLeave && !overrideLeave && (
        <div className="att-menu__note att-menu__note--lock">
          <Lock size={14} aria-hidden />
          <span>
            Set by an approved annual-leave request. Changing it here does not update the request.
            <button type="button" className="att-link" data-autofocus onClick={() => setOverrideLeave(true)}>
              Change anyway
            </button>
          </span>
        </div>
      )}

      {canManage && (
        <div className="att-menu__options" role="group" aria-label="Set status">
          {STATUS_CODES.map((code, index) => {
            const selected = cell.kind === 'recorded' && status === code
            return (
              <button
                key={code}
                type="button"
                data-menu-item
                data-autofocus={!locked && (selected || (index === 0 && !status)) ? true : undefined}
                className={`att-menu__option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                disabled={!editable}
                onClick={() => onAction({ kind: 'status', status: code })}
              >
                <span className={`att-badge att-badge--${code}`} aria-hidden>
                  {code}
                </span>
                <span className="att-menu__option-label">{STATUS_LABELS[code]}</span>
                <kbd aria-hidden>{SHORTCUT_HINT[code]}</kbd>
              </button>
            )
          })}
        </div>
      )}

      {canManage && (canClear || canClearToSchedule || canMarkNotHoliday) && (
        <div className="att-menu__options att-menu__options--secondary">
          {canClear && (
            <button type="button" data-menu-item className="att-menu__option" disabled={!editable} onClick={() => onAction({ kind: 'clear' })}>
              <span className="att-badge att-badge--unmarked" aria-hidden>
                –
              </span>
              <span className="att-menu__option-label">Clear status</span>
            </button>
          )}
          {canClearToSchedule && (
            <button type="button" data-menu-item className="att-menu__option" disabled={!editable} onClick={() => onAction({ kind: 'clear' })}>
              <span className="att-badge att-badge--scheduled" aria-hidden>
                WH
              </span>
              <span className="att-menu__option-label">Clear — use weekly holiday schedule</span>
            </button>
          )}
          {canMarkNotHoliday && (
            <button type="button" data-menu-item className="att-menu__option" disabled={!editable} onClick={() => onAction({ kind: 'not-holiday' })}>
              <span className="att-badge att-badge--unmarked" aria-hidden>
                –
              </span>
              <span className="att-menu__option-label">Not a holiday — leave unmarked</span>
            </button>
          )}
        </div>
      )}

      {showCertificate && (
        <div className="att-menu__section">
          <span className="att-menu__section-title">Medical certificate</span>
          <div className="att-menu__doc">
            {cell.documentUrl ? (
              <a className="att-btn att-btn--sm" href={cell.documentUrl} target="_blank" rel="noopener noreferrer" data-menu-item>
                <Eye size={14} aria-hidden /> View
              </a>
            ) : (
              <span className="att-menu__muted">No certificate uploaded</span>
            )}
            {canManage && (
              <>
                <button type="button" className="att-btn att-btn--sm" data-menu-item disabled={saving} onClick={() => fileRef.current?.click()}>
                  {cell.documentUrl ? <RefreshCw size={14} aria-hidden /> : <Upload size={14} aria-hidden />}
                  {cell.documentUrl ? 'Replace' : 'Upload'}
                </button>
                {cell.documentUrl && (
                  <button
                    type="button"
                    className="att-btn att-btn--sm att-btn--danger"
                    data-menu-item
                    disabled={saving}
                    onClick={() => {
                      if (confirmRemove) {
                        setConfirmRemove(false)
                        onRemoveDocument()
                      } else {
                        setConfirmRemove(true)
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden /> {confirmRemove ? 'Confirm remove' : 'Remove'}
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="application/pdf,image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) onUpload(file)
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

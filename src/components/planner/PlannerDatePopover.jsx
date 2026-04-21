import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, ChevronLeft, ChevronRight, X, Clock, RefreshCw } from 'lucide-react'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

function parseISODate(s) {
  if (!s || typeof s !== 'string') return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function toISO(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatUsShort(iso) {
  if (!iso) return ''
  const d = parseISODate(iso)
  if (!d) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const y = String(d.getFullYear()).slice(-2)
  return `${m}/${day}/${y}`
}

function parseUsInput(str) {
  const t = str.trim()
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!mdy) return null
  let month = parseInt(mdy[1], 10)
  let day = parseInt(mdy[2], 10)
  let year = parseInt(mdy[3], 10)
  if (year < 100) year += year >= 70 ? 1900 : 2000
  const dt = new Date(year, month - 1, day)
  if (dt.getMonth() !== month - 1 || dt.getDate() !== day) return null
  return toISO(dt)
}

/** Build 6 rows × 7 cols of { date: Date | null, inMonth: boolean } */
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startPad = first.getDay()
  const dim = new Date(year, month + 1, 0).getDate()
  const cells = []
  let day = 1 - startPad
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const cur = new Date(year, month, day)
      const inMonth = day >= 1 && day <= dim
      cells.push({ date: cur, inMonth, dayNum: cur.getDate() })
      day++
    }
  }
  return cells
}

function compareIso(a, b) {
  if (!a || !b) return 0
  return a.localeCompare(b)
}

/**
 * Asana-like date popover: range selection, US date input, recurrence, clear.
 * Persists dueDate (end), optional dueDateStart, recurrence on task.
 */
const POPOVER_MAX_HEIGHT = 520
const POPOVER_WIDTH = 300
const POPOVER_GAP = 8

export function PlannerDatePopover({ task, anchorRect, openScrollY, onClose, onApply }) {
  const wrapRef = useRef(null)

  useLayoutEffect(() => {
    if (typeof openScrollY === 'number') {
      window.scrollTo(0, openScrollY)
    }
  }, [openScrollY, task?.id])

  const initial = useMemo(() => {
    const end = task?.dueDate || null
    const start = task?.dueDateStart || end
    return {
      start: start || null,
      end: end || start || null,
      recurrence: task?.recurrence || 'none',
    }
  }, [task?.id, task?.dueDate, task?.dueDateStart, task?.recurrence])

  const [viewYear, setViewYear] = useState(() => {
    const d = parseISODate(initial.end || initial.start) || new Date()
    return d.getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseISODate(initial.end || initial.start) || new Date()
    return d.getMonth()
  })

  const [rangeStart, setRangeStart] = useState(initial.start)
  const [rangeEnd, setRangeEnd] = useState(initial.end)
  const [inputVal, setInputVal] = useState(() => formatUsShort(initial.end || initial.start))
  const [recurrence, setRecurrence] = useState(initial.recurrence)
  const [selecting, setSelecting] = useState(null)

  useEffect(() => {
    setRangeStart(initial.start)
    setRangeEnd(initial.end)
    setInputVal(formatUsShort(initial.end || initial.start))
    setRecurrence(initial.recurrence)
    setSelecting(null)
    const d = parseISODate(initial.end || initial.start) || new Date()
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }, [task?.id, initial.start, initial.end, initial.recurrence])

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else setViewMonth((m) => m - 1)
  }

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else setViewMonth((m) => m + 1)
  }

  const onDayClick = useCallback(
    (iso) => {
      if (!selecting || selecting === 'first') {
        setRangeStart(iso)
        setRangeEnd(iso)
        setInputVal(formatUsShort(iso))
        setSelecting('second')
      } else {
        setRangeStart((prevStart) => {
          const a = prevStart
          const b = iso
          let lo = a
          let hi = b
          if (compareIso(a, b) > 0) {
            lo = b
            hi = a
          }
          setRangeEnd(hi)
          setInputVal(formatUsShort(hi))
          return lo
        })
        setSelecting('first')
      }
    },
    [selecting]
  )

  const handleInputChange = (e) => {
    setInputVal(e.target.value)
    const iso = parseUsInput(e.target.value)
    if (iso) {
      setRangeStart(iso)
      setRangeEnd(iso)
      const d = parseISODate(iso)
      if (d) {
        setViewYear(d.getFullYear())
        setViewMonth(d.getMonth())
      }
    }
  }

  const handleClear = () => {
    setRangeStart(null)
    setRangeEnd(null)
    setInputVal('')
    setRecurrence('none')
    onApply({ dueDate: null, dueDateStart: null, recurrence: 'none' })
    onClose()
  }

  const handleApply = () => {
    if (!rangeEnd && !rangeStart) {
      onApply({ dueDate: null, dueDateStart: null, recurrence: recurrence || 'none' })
    } else {
      const end = rangeEnd || rangeStart
      const start = rangeStart || end
      let a = start
      let b = end
      if (compareIso(a, b) > 0) [a, b] = [b, a]
      onApply({
        dueDate: b,
        dueDateStart: a,
        recurrence: recurrence || 'none',
      })
    }
    onClose()
  }

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose()
    }
    function onEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const pos = useMemo(() => {
    if (!anchorRect) return { top: 80, left: 80 }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const maxH = Math.min(POPOVER_MAX_HEIGHT, vh * 0.9)
    const w = Math.min(POPOVER_WIDTH, vw - 16)
    const left = Math.max(8, Math.min(anchorRect.left, vw - w - 8))
    const pad = 8
    let top
    if (anchorRect.bottom + POPOVER_GAP + maxH <= vh - pad) {
      top = anchorRect.bottom + POPOVER_GAP
    } else if (anchorRect.top - POPOVER_GAP - maxH >= pad) {
      top = anchorRect.top - POPOVER_GAP - maxH
    } else {
      top = Math.max(pad, Math.min(anchorRect.bottom + POPOVER_GAP, vh - maxH - pad))
    }
    return { top, left }
  }, [anchorRect])

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  let minIso = null
  let maxIso = null
  if (rangeStart || rangeEnd) {
    const a = rangeStart || rangeEnd
    const b = rangeEnd || rangeStart
    minIso = compareIso(a, b) <= 0 ? a : b
    maxIso = compareIso(a, b) <= 0 ? b : a
  }

  const portal = (
    <div
      ref={wrapRef}
      className="aip-date-popover"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 300 }}
      role="dialog"
      aria-label="Choose dates"
    >
      <div className="aip-date-popover__head">
        <span className="aip-date-popover__head-label">
          <Bookmark size={14} className="aip-date-popover__bookmark" aria-hidden />
          Start date
        </span>
        <div className="aip-date-popover__input-wrap">
          <input
            type="text"
            className="aip-date-popover__input"
            value={inputVal}
            onChange={handleInputChange}
            placeholder="MM/DD/YY"
            aria-label="Date"
          />
          {inputVal ? (
            <button
              type="button"
              className="aip-date-popover__input-clear"
              onClick={() => {
                setInputVal('')
                setRangeStart(null)
                setRangeEnd(null)
              }}
              aria-label="Clear input"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="aip-date-popover__nav">
        <button type="button" className="aip-date-popover__nav-btn" onClick={goPrev} aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <span className="aip-date-popover__month">{monthLabel}</span>
        <button type="button" className="aip-date-popover__nav-btn" onClick={goNext} aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="aip-date-popover__weekdays">
        {WEEKDAYS.map((d, i) => (
          <span key={`wd-${i}`} className="aip-date-popover__weekday">
            {d}
          </span>
        ))}
      </div>

      <div className="aip-date-popover__grid">
        {grid.map((cell, i) => {
          const iso = toISO(cell.date)
          const isSingle = minIso && maxIso && minIso === maxIso
          const multi = minIso && maxIso && minIso !== maxIso
          const inMiddle = multi && compareIso(iso, minIso) > 0 && compareIso(iso, maxIso) < 0
          const isRStart = multi && iso === minIso
          const isREnd = multi && iso === maxIso

          let cellCls = 'aip-date-popover__cell'
          if (!cell.inMonth) cellCls += ' aip-date-popover__cell--muted'
          if (isSingle && iso === minIso) cellCls += ' aip-date-popover__cell--single'
          else {
            if (inMiddle) cellCls += ' aip-date-popover__cell--in-range'
            if (isRStart) cellCls += ' aip-date-popover__cell--range-start'
            if (isREnd) cellCls += ' aip-date-popover__cell--range-end'
          }

          return (
            <button
              key={i}
              type="button"
              className={cellCls}
              onClick={() => onDayClick(iso)}
            >
              <span className="aip-date-popover__cell-num">{cell.dayNum}</span>
            </button>
          )
        })}
      </div>

      <div className="aip-date-popover__repeat">
        <span className="aip-date-popover__repeat-label">Repeats</span>
        <select
          className="aip-date-popover__repeat-select"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
        >
          {RECURRENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="aip-date-popover__footer">
        <div className="aip-date-popover__footer-left">
          <span className="aip-date-popover__icon-btn" title="Time (coming soon)" aria-hidden>
            <Clock size={16} />
          </span>
          <button type="button" className="aip-date-popover__sync-btn" title="Reset to today" onClick={() => {
            const t = new Date()
            const iso = toISO(t)
            setRangeStart(iso)
            setRangeEnd(iso)
            setInputVal(formatUsShort(iso))
            setViewYear(t.getFullYear())
            setViewMonth(t.getMonth())
          }}>
            <RefreshCw size={14} />
          </button>
        </div>
        <button type="button" className="aip-date-popover__clear" onClick={handleClear}>
          Clear
        </button>
        <button type="button" className="aip-date-popover__done" onClick={handleApply}>
          Done
        </button>
      </div>
    </div>
  )

  return createPortal(portal, document.body)
}

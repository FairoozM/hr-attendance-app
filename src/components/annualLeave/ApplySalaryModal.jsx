import { useState, useMemo, useCallback, useEffect } from 'react'
import { api } from '../../api/client'
import { fmtDMY } from '../../utils/dateFormat'
import { alDaysBetween } from '../../utils/annualLeaveUtils'
import { shopWorkflowLabel } from './annualLeaveLabels'
import './ApplySalaryModal.css'

function toNum(v) {
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Tries apply-calculator; on 409, collect minimal salary and POST /api/annual-leave-salary then re-try apply.
 * Uses existing API only; no backend changes.
 */
export function ApplySalaryModal({ row, onClose, onApply, defaultMonthly = '' }) {
  const [err, setErr] = useState('')
  const [applying, setApplying] = useState(false)
  const [needRecord, setNeedRecord] = useState(false)
  const [monthly, setMonthly] = useState(
    defaultMonthly && String(toNum(defaultMonthly) || '') ? String(toNum(defaultMonthly)) : ''
  )
  const [days, setDays] = useState(
    String((row?.leave_days ?? alDaysBetween(row.from_date, row.to_date)) || 0)
  )

  useEffect(() => {
    setErr('')
    setNeedRecord(false)
    setMonthly(defaultMonthly && toNum(defaultMonthly) > 0 ? String(toNum(defaultMonthly)) : '')
    setDays(String((row?.leave_days ?? alDaysBetween(row?.from_date, row?.to_date)) || 0))
  }, [row?.id, row?.from_date, row?.to_date, row?.leave_days, defaultMonthly])

  const derived = useMemo(() => {
    const m = toNum(monthly)
    const per = m > 0 ? m / 30 : 0
    const d = toNum(days)
    const lAmt = per * d
    const g = lAmt
    return { m, per, d, lAmt, g }
  }, [monthly, days])

  const tryApply = useCallback(async () => {
    if (!row?.id) return
    setErr('')
    setApplying(true)
    try {
      await onApply(row.id)
      onClose()
    } catch (e) {
      if (e?.status === 409) {
        setNeedRecord(true)
        setErr('')
      } else {
        setErr(e?.message || 'Could not apply.')
      }
    } finally {
      setApplying(false)
    }
  }, [row, onApply, onClose])

  const saveAndApply = useCallback(async () => {
    if (!row?.id || !row.employee_id) return
    const m = toNum(monthly)
    if (m <= 0) {
      setErr('Enter a valid monthly salary.')
      return
    }
    if (toNum(days) < 0) {
      setErr('Enter valid leave days.')
      return
    }
    setErr('')
    setApplying(true)
    try {
      const d = toNum(days)
      const lAmt = derived.per * d
      const g = lAmt
      const payload = {
        employee_id: Number(row.employee_id),
        calculation_date: new Date().toISOString().slice(0, 10),
        monthly_salary: m,
        per_day_rate: derived.per,
        running_month_days: 0,
        running_month_amount: 0,
        annual_leave_days_eligible: d,
        leave_days_to_pay: d,
        leave_salary_amount: lAmt,
        other_additions: 0,
        other_deductions: 0,
        grand_total: g,
        remarks: `From Annual Leave handover (request #${row.id})`,
      }
      await api.post('/api/annual-leave-salary', payload)
      await onApply(row.id)
      onClose()
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setApplying(false)
    }
  }, [row, monthly, days, derived, onApply, onClose])

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-asm" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Apply salary to this handover</h3>
            <p className="al-modal__kicker">
              {row?.full_name} · {row ? fmtDMY(row.from_date) : ''} – {row ? fmtDMY(row.to_date) : ''} ·{' '}
              {row ? shopWorkflowLabel(row) : ''}
            </p>
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!needRecord && (
          <div className="al-asm__body al-modal__body-scroll">
            <p className="al-asm__lede">Applies the latest leave salary for this person to this handover.</p>
            {err && <p className="al-modal__err">{err}</p>}
            <div className="al-modal__actions al-modal__actions--sticky">
              <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={applying}>
                Cancel
              </button>
              <button
                type="button"
                className="al-btn al-btn--primary"
                onClick={tryApply}
                disabled={applying}
              >
                {applying ? 'Please wait…' : 'Apply'}
              </button>
            </div>
          </div>
        )}

        {needRecord && (
          <div className="al-asm__body al-modal__body-scroll">
            <p className="al-asm__alert" role="alert">
              No salary record found. Create one here, then it will be applied to this handover.
            </p>
            <div className="al-asm__fields">
              <label className="al-asm__field">
                Monthly salary (AED)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                  disabled={applying}
                />
              </label>
              <label className="al-asm__field">
                Days to pay (this leave)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  disabled={applying}
                />
              </label>
            </div>
            <p className="al-asm__result">
              Leave salary: <strong>AED {derived.lAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{' '}
              (rate AED {derived.per.toFixed(2)} / day)
            </p>
            {err && <p className="al-modal__err">{err}</p>}
            <div className="al-modal__actions al-modal__actions--sticky">
              <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={applying}>
                Cancel
              </button>
              <button
                type="button"
                className="al-btn al-btn--primary"
                onClick={saveAndApply}
                disabled={applying}
              >
                {applying ? 'Saving…' : 'Save & apply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

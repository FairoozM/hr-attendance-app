import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api/client'
import { useEmployees } from '../hooks/useEmployees'
import { useCompanyPayments } from '../hooks/useCompanyPayments'
import { buildAnnualLeavePaymentPayload } from '../utils/paymentUtils'
import { fmtDMY } from '../utils/dateFormat'
import './AnnualLeaveSalaryPage.css'

const DIVISION_DAYS_OPTIONS = [26, 30, 31]

const EMPTY_CALC = {
  calculationDate: new Date().toISOString().slice(0, 10),
  monthlySalary: '',
  perDayRate: '',
  runningMonthDays: '',
  runningMonthAmount: '',
  annualLeaveDaysEligible: '',
  leaveDaysToPay: '',
  leaveSalaryAmount: '',
  otherAdditions: '',
  otherDeductions: '',
  grandTotal: '',
  remarks: '',
}

function fmt(n) {
  const num = parseFloat(n)
  if (!Number.isFinite(num)) return '0.00'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toNum(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function dateLabel(d) {
  return fmtDMY(d)
}

function NumInput({ label, value, onChange, hint, readOnly, highlight }) {
  return (
    <div className={`als-field ${highlight ? 'als-field--highlight' : ''}`}>
      <label className="als-field__label">{label}</label>
      <input
        type="number"
        className={`als-field__input ${readOnly ? 'als-field__input--auto' : ''}`}
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        min="0"
        step="any"
        placeholder="0.00"
      />
      {hint && <span className="als-field__hint">{hint}</span>}
    </div>
  )
}

function HistoryTable({ rows, editingId, onEdit, onDelete, showEmployee = false }) {
  return (
    <div className="als-table-wrap">
      <table className="als-table">
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>Date</th>
            <th>Monthly Salary</th>
            <th>Running Days</th>
            <th>Running Amt</th>
            <th>Leave Days</th>
            <th>Leave Salary</th>
            <th>Additions</th>
            <th>Deductions</th>
            <th>Grand Total</th>
            <th>Remarks</th>
            <th style={{ width: 72 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className={editingId === row.id ? 'als-table__row--editing' : ''}>
              {showEmployee && (
                <td>
                  <div className="als-table__emp-cell">
                    <strong>{row.full_name}</strong>
                    <span>{row.department}</span>
                  </div>
                </td>
              )}
              <td>{dateLabel(row.calculation_date)}</td>
              <td>AED {fmt(row.monthly_salary)}</td>
              <td>{row.running_month_days}</td>
              <td>AED {fmt(row.running_month_amount)}</td>
              <td>{row.leave_days_to_pay}</td>
              <td>AED {fmt(row.leave_salary_amount)}</td>
              <td>{toNum(row.other_additions) > 0 ? `AED ${fmt(row.other_additions)}` : '—'}</td>
              <td>{toNum(row.other_deductions) > 0 ? `AED ${fmt(row.other_deductions)}` : '—'}</td>
              <td className="als-table__total">AED {fmt(row.grand_total)}</td>
              <td className="als-table__remarks">{row.remarks || '—'}</td>
              <td>
                <div className="als-row-acts">
                  <button className="als-icon-btn als-icon-btn--edit" title="Edit" onClick={() => onEdit(row)}>
                    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17l-4 1 1-4L14.5 2.5z"/>
                    </svg>
                  </button>
                  {onDelete && (
                    <button className="als-icon-btn als-icon-btn--del" title="Delete" onClick={() => onDelete(row.id)}>
                      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 5h14M8 5V3h4v2M6 5l1 12h6l1-12"/>
                      </svg>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AnnualLeaveSalaryPage({ embedded = false, employees: propEmployees }) {
  const { employees: fetchedEmployees } = useEmployees()
  const { payments, addPayment } = useCompanyPayments()
  const employees = (propEmployees && propEmployees.length > 0) ? propEmployees : fetchedEmployees
  const [empSearch, setEmpSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [calc, setCalc] = useState(EMPTY_CALC)
  const [divisionDays, setDivisionDays] = useState(30)
  const [customDivDays, setCustomDivDays] = useState('')
  const [overrides, setOverrides] = useState({})  // tracks which auto fields were manually overridden
  const [history, setHistory] = useState([])           // per-selected-employee history
  const [histLoading, setHistLoading] = useState(false)
  const [allHistory, setAllHistory] = useState([])      // all employees history (always visible)
  const [allHistLoading, setAllHistLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [pipelineMsg, setPipelineMsg] = useState(null)
  const [pipelineSending, setPipelineSending] = useState(false)
  const [lastSavedRecord, setLastSavedRecord] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const summaryInitials = useMemo(() => {
    const name = String(selectedEmp?.name || '').trim()
    if (!name) return '?'
    const parts = name.split(/\s+/).filter(Boolean)
    const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('')
    return initials || name[0].toUpperCase()
  }, [selectedEmp])

  const isLastSavedInPipeline = useMemo(() => {
    if (!lastSavedRecord?.id) return false
    const sourceReferenceId = String(lastSavedRecord.id)
    return payments.some(
      (p) => p.sourceModule === 'Annual Leave' && String(p.sourceReferenceId || '') === sourceReferenceId
    )
  }, [lastSavedRecord, payments])

  // ── Filtered employee list (always visible when there's a search query) ──
  const filteredEmps = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    if (!q) return employees.filter(e => e.isActive !== false).slice(0, 20)
    return employees.filter(e =>
      e.isActive !== false &&
      (
        (e.name || '').toLowerCase().includes(q) ||
        (e.employeeId || '').toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q)
      )
    ).slice(0, 20)
  }, [employees, empSearch])

  // ── Auto calculations ──
  const derived = useMemo(() => {
    const monthly   = toNum(calc.monthlySalary)
    const divisor   = divisionDays > 0 ? divisionDays : 30
    const perDay    = overrides.perDayRate    ? toNum(calc.perDayRate)    : (monthly > 0 ? monthly / divisor : 0)
    const rmDays    = toNum(calc.runningMonthDays)
    const rmAmt     = overrides.runningMonthAmount ? toNum(calc.runningMonthAmount) : perDay * rmDays
    const lDays     = toNum(calc.leaveDaysToPay)
    const lAmt      = overrides.leaveSalaryAmount  ? toNum(calc.leaveSalaryAmount)  : perDay * lDays
    const additions = toNum(calc.otherAdditions)
    const deductions= toNum(calc.otherDeductions)
    const total     = overrides.grandTotal ? toNum(calc.grandTotal) : rmAmt + lAmt + additions - deductions
    return { perDay, rmAmt, lAmt, total, divisor }
  }, [calc, overrides, divisionDays])

  // ── Field change helper ──
  const set = useCallback((field, value, isAutoField = false) => {
    setCalc(prev => ({ ...prev, [field]: value }))
    if (isAutoField) {
      setOverrides(prev => ({ ...prev, [field]: true }))
    }
    setSaveMsg(null)
  }, [])

  const resetOverride = useCallback((field) => {
    setOverrides(prev => { const n = { ...prev }; delete n[field]; return n })
  }, [])

  // ── Select employee ──
  const selectEmployee = useCallback((emp) => {
    setSelectedEmp(emp)
    setEmpSearch(emp.name)
    setCalc(prev => ({
      ...EMPTY_CALC,
      calculationDate: prev.calculationDate,
      monthlySalary: '',
    }))
    setOverrides({})
    setEditingId(null)
    setLastSavedRecord(null)
    setPipelineMsg(null)
    setSaveMsg(null)
  }, [])

  // ── Load per-employee history ──
  const loadHistory = useCallback(async (empId) => {
    if (!empId) return
    setHistLoading(true)
    try {
      const data = await api.get(`/api/annual-leave-salary?employee_id=${empId}`)
      setHistory(Array.isArray(data) ? data : [])
    } catch { setHistory([]) }
    finally { setHistLoading(false) }
  }, [])

  useEffect(() => {
    if (selectedEmp) loadHistory(selectedEmp.id)
    else setHistory([])
  }, [selectedEmp, loadHistory])

  // ── Load all-employees history ──
  const loadAllHistory = useCallback(async () => {
    setAllHistLoading(true)
    try {
      const data = await api.get('/api/annual-leave-salary')
      setAllHistory(Array.isArray(data) ? data : [])
    } catch { setAllHistory([]) }
    finally { setAllHistLoading(false) }
  }, [])

  useEffect(() => { loadAllHistory() }, [loadAllHistory])

  // ── Save ──
  const sendToPipelineForRecord = useCallback((record) => {
    if (!selectedEmp || !record?.id) {
      setPipelineMsg({ type: 'error', text: 'Save a calculation first.' })
      return false
    }
    const sourceReferenceId = String(record.id)
    const duplicate = payments.find(
      (p) => p.sourceModule === 'Annual Leave' && String(p.sourceReferenceId || '') === sourceReferenceId
    )
    if (duplicate) {
      setPipelineMsg({ type: 'info', text: 'This calculation is already in the payment pipeline.' })
      return true
    }
    const payload = buildAnnualLeavePaymentPayload({
      sourceReferenceId,
      employeeName: selectedEmp.name || 'Employee',
      dueDate: record.calculationDate || calc.calculationDate,
      amount: toNum(record.grandTotal),
      currency: 'AED',
      notes: `Generated from annual leave salary record #${sourceReferenceId}`,
    })
    addPayment(payload)
    setPipelineMsg({ type: 'success', text: 'Added to payment pipeline.' })
    return true
  }, [addPayment, calc.calculationDate, payments, selectedEmp])

  const handleSave = useCallback(async (sendToPipelineAfterSave = false) => {
    if (!selectedEmp) return setSaveMsg({ type: 'error', text: 'Please select an employee first.' })
    const monthly = toNum(calc.monthlySalary)
    if (monthly <= 0) return setSaveMsg({ type: 'error', text: 'Monthly salary must be greater than 0.' })

    setSaving(true)
    setSaveMsg(null)
    setPipelineMsg(null)
    try {
      const payload = {
        employee_id: selectedEmp.id,
        calculation_date: calc.calculationDate,
        monthly_salary: monthly,
        per_day_rate: derived.perDay,
        running_month_days: toNum(calc.runningMonthDays),
        running_month_amount: derived.rmAmt,
        annual_leave_days_eligible: toNum(calc.annualLeaveDaysEligible),
        leave_days_to_pay: toNum(calc.leaveDaysToPay),
        leave_salary_amount: derived.lAmt,
        other_additions: toNum(calc.otherAdditions),
        other_deductions: toNum(calc.otherDeductions),
        grand_total: derived.total,
        remarks: calc.remarks,
      }
      let savedRecord = null
      if (editingId) {
        const updated = await api.put(`/api/annual-leave-salary/${editingId}`, payload)
        if (updated?.id != null) {
          savedRecord = {
            id: updated.id,
            calculationDate: updated.calculation_date?.slice(0, 10) || calc.calculationDate,
            grandTotal: updated.grand_total ?? derived.total,
          }
          setLastSavedRecord(savedRecord)
        }
        setSaveMsg({ type: 'success', text: 'Record updated successfully.' })
      } else {
        const created = await api.post('/api/annual-leave-salary', payload)
        if (created?.id != null) {
          savedRecord = {
            id: created.id,
            calculationDate: created.calculation_date?.slice(0, 10) || calc.calculationDate,
            grandTotal: created.grand_total ?? derived.total,
          }
          setLastSavedRecord(savedRecord)
        }
        setSaveMsg({ type: 'success', text: 'Calculation saved successfully.' })
        setEditingId(null)
      }
      await loadHistory(selectedEmp.id)
      await loadAllHistory()
      if (sendToPipelineAfterSave && savedRecord) {
        sendToPipelineForRecord(savedRecord)
      }
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message || 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }, [selectedEmp, calc, derived, editingId, loadHistory, loadAllHistory, sendToPipelineForRecord])

  // ── Delete a history record ──
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this calculation record? This cannot be undone.')) return
    try {
      await api.delete(`/api/annual-leave-salary/${id}`)
      setAllHistory(prev => prev.filter(r => r.id !== id))
      setHistory(prev => prev.filter(r => r.id !== id))
      if (editingId === id) setEditingId(null)
    } catch (err) {
      window.alert(err.message || 'Failed to delete record')
    }
  }, [editingId])

  // ── Edit from history ──
  const handleEdit = useCallback((row) => {
    // If editing from global history, auto-select that employee
    const emp = employees.find(e => String(e.id) === String(row.employee_id))
    if (emp) {
      setSelectedEmp(emp)
      setEmpSearch(emp.name)
    }
    setEditingId(row.id)
    setCalc({
      calculationDate: row.calculation_date?.slice(0, 10) || '',
      monthlySalary: row.monthly_salary ?? '',
      perDayRate: row.per_day_rate ?? '',
      runningMonthDays: row.running_month_days ?? '',
      runningMonthAmount: row.running_month_amount ?? '',
      annualLeaveDaysEligible: row.annual_leave_days_eligible ?? '',
      leaveDaysToPay: row.leave_days_to_pay ?? '',
      leaveSalaryAmount: row.leave_salary_amount ?? '',
      otherAdditions: row.other_additions ?? '',
      otherDeductions: row.other_deductions ?? '',
      grandTotal: row.grand_total ?? '',
      remarks: row.remarks ?? '',
    })
    setOverrides({ perDayRate: true, runningMonthAmount: true, leaveSalaryAmount: true, grandTotal: true })
    setLastSavedRecord({
      id: row.id,
      calculationDate: row.calculation_date?.slice(0, 10) || '',
      grandTotal: row.grand_total ?? 0,
    })
    setPipelineMsg(null)
    setSaveMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [employees])

  // ── New calculation ──
  const handleNew = useCallback(() => {
    setEditingId(null)
    setCalc(EMPTY_CALC)
    setOverrides({})
    setDivisionDays(30)
    setCustomDivDays('')
    setLastSavedRecord(null)
    setPipelineMsg(null)
    setSaveMsg(null)
  }, [])

  const handleSendToPipeline = useCallback(() => {
    if (!lastSavedRecord?.id) return
    setPipelineSending(true)
    try {
      sendToPipelineForRecord(lastSavedRecord)
    } catch (err) {
      setPipelineMsg({ type: 'error', text: err?.message || 'Failed to add to payment pipeline.' })
    } finally {
      setPipelineSending(false)
    }
  }, [lastSavedRecord, sendToPipelineForRecord])

  // ── Print ──
  const handlePrint = useCallback(() => { window.print() }, [])

  return (
    <div className="als-page">
      {/* ── Page header ── */}
      {!embedded && (
        <div className="als-page-header">
          <div>
            <h1 className="als-page-title">Annual Leave Salary</h1>
            <p className="als-page-sub">Calculate and record employee annual leave salary payments</p>
          </div>
        </div>
      )}
      <div className="als-page-header__actions als-page-header__actions--bar">
        {selectedEmp && editingId && (
          <button className="als-btn als-btn--outline" onClick={handleNew}>
            + New Calculation
          </button>
        )}
        {selectedEmp && (
          <button className="als-btn als-btn--outline als-btn--print" onClick={handlePrint}>
            🖨 Print / PDF
          </button>
        )}
      </div>

      {/* ── Employee selector ── */}
      <div className="als-card als-emp-selector">
        <div className="als-card__head">
          <span className="als-card__icon">👤</span>
          <h2 className="als-card__title">Select Employee</h2>
          {selectedEmp && (
            <button className="als-btn als-btn--sm als-btn--outline" onClick={() => {
              setSelectedEmp(null)
              setEmpSearch('')
              setCalc(EMPTY_CALC)
              setOverrides({})
              setHistory([])
              setSaveMsg(null)
              setEditingId(null)
            }}>Change</button>
          )}
        </div>
        <div className="als-card__body">
          {!selectedEmp ? (
            <div className="als-emp-picker">
              <input
                className="als-emp-search"
                type="text"
                placeholder="Type name, employee ID, or department to search…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <div className="als-emp-list">
                {employees.length === 0 && (
                  <div className="als-emp-list__empty">Loading employees…</div>
                )}
                {employees.length > 0 && filteredEmps.length === 0 && (
                  <div className="als-emp-list__empty">No employees match "{empSearch}"</div>
                )}
                {filteredEmps.map(e => (
                  <button
                    key={e.id}
                    type="button"
                    className="als-emp-list__item"
                    onClick={() => selectEmployee(e)}
                  >
                    <div className="als-emp-list__avatar">
                      {e.photoUrl
                        ? <img src={e.photoUrl} alt="" />
                        : (e.name?.[0] || '?').toUpperCase()
                      }
                    </div>
                    <div className="als-emp-list__info">
                      <span className="als-emp-list__name">{e.name}</span>
                      <span className="als-emp-list__meta">{e.employeeId} · {e.department}</span>
                    </div>
                    <span className="als-emp-list__dept">{e.designation}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="als-emp-selected-row">
              <div className="als-emp-list__avatar als-emp-list__avatar--lg">
                {selectedEmp.photoUrl
                  ? <img src={selectedEmp.photoUrl} alt="" />
                  : (selectedEmp.name?.[0] || '?').toUpperCase()
                }
              </div>
              <div>
                <strong>{selectedEmp.name}</strong>
                <span className="als-emp-list__meta"> · {selectedEmp.employeeId} · {selectedEmp.department}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Employee detail strip (shown after selection) ── */}
      {selectedEmp && (
        <div className="als-emp-detail-strip">
          <div className="als-emp-detail-strip__item"><span>ID</span><strong>{selectedEmp.employeeId || '—'}</strong></div>
          <div className="als-emp-detail-strip__item"><span>Department</span><strong>{selectedEmp.department || '—'}</strong></div>
          <div className="als-emp-detail-strip__item"><span>Position</span><strong>{selectedEmp.designation || '—'}</strong></div>
          <div className="als-emp-detail-strip__item"><span>Joining Date</span><strong>{dateLabel(selectedEmp.joiningDate)}</strong></div>
          <div className="als-emp-detail-strip__item">
            <span>Status</span>
            <span className={`als-badge ${selectedEmp.isActive ? 'als-badge--active' : 'als-badge--inactive'}`}>
              {selectedEmp.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      )}

      {/* ── Calculator ── */}
      {selectedEmp && (
        <>
          <div className="als-section-label">
            {editingId ? `✏️ Editing Record #${editingId}` : '🧮 New Calculation'}
          </div>

          <div className="als-calc-layout">
            {/* Left: input form */}
            <div className="als-calc-form">

              {/* Calculation date & monthly salary */}
              <div className="als-card">
                <div className="als-card__head">
                  <span className="als-card__icon">📅</span>
                  <h3 className="als-card__title">Basic Information</h3>
                </div>
                <div className="als-card__body als-grid-2">
                  <div className="als-field">
                    <label className="als-field__label">Calculation Date</label>
                    <input
                      type="date"
                      className="als-field__input"
                      value={calc.calculationDate}
                      onChange={e => set('calculationDate', e.target.value)}
                    />
                  </div>
                  <NumInput
                    label="Monthly Salary (AED)"
                    value={calc.monthlySalary}
                    onChange={v => {
                      set('monthlySalary', v)
                      setOverrides({})   // reset all overrides when base salary changes
                    }}
                    hint="Base monthly salary"
                    highlight
                  />
                </div>
              </div>

              {/* Running month salary */}
              <div className="als-card">
                <div className="als-card__head">
                  <span className="als-card__icon">📆</span>
                  <h3 className="als-card__title">Running Month Salary</h3>
                </div>
                <div className="als-card__body" style={{ paddingBottom: 0 }}>
                  <div className="als-divdays-row">
                    <span className="als-divdays-row__label">Days divisor for per-day rate:</span>
                    <div className="als-divdays-row__options">
                      {DIVISION_DAYS_OPTIONS.map(d => (
                        <button
                          key={d}
                          type="button"
                          className={`als-divdays-btn${divisionDays === d && !customDivDays ? ' als-divdays-btn--active' : ''}`}
                          onClick={() => { setDivisionDays(d); setCustomDivDays(''); setOverrides(o => { const n = { ...o }; delete n.perDayRate; return n }) }}
                        >
                          {d}
                        </button>
                      ))}
                      <div className="als-divdays-custom">
                        <input
                          type="number"
                          className={`als-divdays-custom__input${customDivDays ? ' als-divdays-btn--active' : ''}`}
                          placeholder="Custom"
                          min="1"
                          max="366"
                          value={customDivDays}
                          onChange={e => {
                            const v = e.target.value
                            setCustomDivDays(v)
                            const n = parseInt(v, 10)
                            if (n > 0) {
                              setDivisionDays(n)
                              setOverrides(o => { const next = { ...o }; delete next.perDayRate; return next })
                            }
                          }}
                        />
                      </div>
                    </div>
                    <span className="als-divdays-row__formula">
                      = AED {fmt(toNum(calc.monthlySalary) > 0 ? toNum(calc.monthlySalary) / (divisionDays || 30) : 0)} / day
                    </span>
                  </div>
                </div>
                <div className="als-card__body als-grid-3">
                  <div className="als-field">
                    <label className="als-field__label">
                      Per Day Rate (AED)
                      {overrides.perDayRate && (
                        <button className="als-override-reset" onClick={() => resetOverride('perDayRate')} title="Reset to auto">↺</button>
                      )}
                    </label>
                    <input
                      type="number"
                      className={`als-field__input ${!overrides.perDayRate ? 'als-field__input--auto' : ''}`}
                      value={overrides.perDayRate ? calc.perDayRate : fmt(derived.perDay)}
                      onChange={e => set('perDayRate', e.target.value, true)}
                      min="0" step="any" placeholder="Auto"
                    />
                    <span className="als-field__hint">Monthly ÷ {derived.divisor}</span>
                  </div>
                  <NumInput
                    label="Salary Days (Running Month)"
                    value={calc.runningMonthDays}
                    onChange={v => set('runningMonthDays', v)}
                    hint="Days payable this month"
                  />
                  <div className="als-field">
                    <label className="als-field__label">
                      Running Month Amount (AED)
                      {overrides.runningMonthAmount && (
                        <button className="als-override-reset" onClick={() => resetOverride('runningMonthAmount')} title="Reset to auto">↺</button>
                      )}
                    </label>
                    <input
                      type="number"
                      className={`als-field__input ${!overrides.runningMonthAmount ? 'als-field__input--auto' : ''}`}
                      value={overrides.runningMonthAmount ? calc.runningMonthAmount : fmt(derived.rmAmt)}
                      onChange={e => set('runningMonthAmount', e.target.value, true)}
                      min="0" step="any" placeholder="Auto"
                    />
                    <span className="als-field__hint">Per day rate × days</span>
                  </div>
                </div>
              </div>

              {/* Leave salary */}
              <div className="als-card">
                <div className="als-card__head">
                  <span className="als-card__icon">🏖️</span>
                  <h3 className="als-card__title">Annual Leave Salary</h3>
                </div>
                <div className="als-card__body als-grid-3">
                  <NumInput
                    label="Leave Days Eligible"
                    value={calc.annualLeaveDaysEligible}
                    onChange={v => set('annualLeaveDaysEligible', v)}
                    hint="Total eligible leave days"
                  />
                  <NumInput
                    label="Leave Days to Be Paid"
                    value={calc.leaveDaysToPay}
                    onChange={v => set('leaveDaysToPay', v)}
                    hint="Days actually to pay"
                  />
                  <div className="als-field">
                    <label className="als-field__label">
                      Leave Salary Amount (AED)
                      {overrides.leaveSalaryAmount && (
                        <button className="als-override-reset" onClick={() => resetOverride('leaveSalaryAmount')} title="Reset to auto">↺</button>
                      )}
                    </label>
                    <input
                      type="number"
                      className={`als-field__input ${!overrides.leaveSalaryAmount ? 'als-field__input--auto' : ''}`}
                      value={overrides.leaveSalaryAmount ? calc.leaveSalaryAmount : fmt(derived.lAmt)}
                      onChange={e => set('leaveSalaryAmount', e.target.value, true)}
                      min="0" step="any" placeholder="Auto"
                    />
                    <span className="als-field__hint">Per day rate × leave days</span>
                  </div>
                </div>
              </div>

              {/* Additions, deductions, remarks */}
              <div className="als-card">
                <div className="als-card__head">
                  <span className="als-card__icon">➕</span>
                  <h3 className="als-card__title">Adjustments &amp; Notes</h3>
                </div>
                <div className="als-card__body als-grid-2">
                  <NumInput
                    label="Other Additions (AED)"
                    value={calc.otherAdditions}
                    onChange={v => set('otherAdditions', v)}
                    hint="Allowances, bonuses, etc."
                  />
                  <NumInput
                    label="Other Deductions (AED)"
                    value={calc.otherDeductions}
                    onChange={v => set('otherDeductions', v)}
                    hint="Loans, penalties, etc."
                  />
                </div>
                <div className="als-card__body" style={{ paddingTop: 0 }}>
                  <div className="als-field als-field--full">
                    <label className="als-field__label">Remarks / Notes</label>
                    <textarea
                      className="als-field__textarea"
                      value={calc.remarks}
                      onChange={e => set('remarks', e.target.value)}
                      placeholder="Any additional notes or remarks…"
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* Save actions */}
              {saveMsg && (
                <div className={`als-alert als-alert--${saveMsg.type}`}>{saveMsg.text}</div>
              )}
              {pipelineMsg && (
                <div className={`als-alert als-alert--${pipelineMsg.type === 'error' ? 'error' : pipelineMsg.type === 'info' ? 'info' : 'success'}`}>
                  {pipelineMsg.text}
                </div>
              )}
              <div className="als-save-row">
                <button
                  className="als-btn als-btn--primary als-btn--lg"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : (editingId ? '💾 Update Record' : '💾 Save Calculation')}
                </button>
                <button
                  className="als-btn als-btn--primary"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : (editingId ? 'Update + Send to Pipeline' : 'Save + Send to Pipeline')}
                </button>
                {editingId && (
                  <button className="als-btn als-btn--outline" onClick={handleNew}>
                    Cancel Edit
                  </button>
                )}
                <button
                  className="als-btn als-btn--outline"
                  onClick={handleSendToPipeline}
                  disabled={pipelineSending || !selectedEmp || !lastSavedRecord?.id || isLastSavedInPipeline}
                  title={
                    !lastSavedRecord?.id
                      ? 'Save first'
                      : isLastSavedInPipeline
                        ? 'This record is already in the payment pipeline'
                        : 'Send saved calculation to company payments pipeline'
                  }
                >
                  {pipelineSending ? 'Sending…' : isLastSavedInPipeline ? 'Already in Pipeline' : 'Send to Payment Pipeline'}
                </button>
              </div>
            </div>

            {/* Right: summary */}
            <div className="als-summary-panel">
              <div className="als-summary-card">
                <div className="als-summary-top">
                  <div className="als-summary-card__head">
                    <span>Calculation Summary</span>
                  </div>
                  <div className="als-summary-date-pill">{dateLabel(calc.calculationDate)}</div>
                </div>

                <div className="als-summary-identity">
                  <div className="als-summary-avatar">{summaryInitials}</div>
                  <div className="als-summary-card__emp">
                    {selectedEmp.name}
                    <span>{selectedEmp.employeeId} · {selectedEmp.department}</span>
                  </div>
                </div>

                <div className="als-summary-kpis">
                  <div className="als-summary-kpi">
                    <span>Monthly Salary</span>
                    <strong>AED {fmt(calc.monthlySalary)}</strong>
                  </div>
                  <div className="als-summary-kpi">
                    <span>Per Day (÷{derived.divisor})</span>
                    <strong>AED {fmt(derived.perDay)}</strong>
                  </div>
                </div>

                <div className="als-summary-breakdown">
                  <div className="als-summary-breakdown__row">
                    <div>
                      <span className="als-summary-breakdown__label">Running month</span>
                      <span className="als-summary-breakdown__meta">{toNum(calc.runningMonthDays)} days worked</span>
                    </div>
                    <strong>AED {fmt(derived.rmAmt)}</strong>
                  </div>
                  <div className="als-summary-breakdown__row">
                    <div>
                      <span className="als-summary-breakdown__label">Leave salary</span>
                      <span className="als-summary-breakdown__meta">{toNum(calc.leaveDaysToPay)} days</span>
                    </div>
                    <strong>AED {fmt(derived.lAmt)}</strong>
                  </div>
                  {toNum(calc.otherAdditions) > 0 && (
                    <div className="als-summary-breakdown__row als-summary-breakdown__row--add">
                      <div>
                        <span className="als-summary-breakdown__label">Other additions</span>
                      </div>
                      <strong>+ AED {fmt(calc.otherAdditions)}</strong>
                    </div>
                  )}
                  {toNum(calc.otherDeductions) > 0 && (
                    <div className="als-summary-breakdown__row als-summary-breakdown__row--ded">
                      <div>
                        <span className="als-summary-breakdown__label">Other deductions</span>
                      </div>
                      <strong>− AED {fmt(calc.otherDeductions)}</strong>
                    </div>
                  )}
                </div>

                <div className="als-summary-total">
                  <span>Grand Total</span>
                  <span>AED {fmt(derived.total)}</span>
                </div>

                {calc.remarks && (
                  <div className="als-summary-remarks">
                    <strong>Remarks:</strong> {calc.remarks}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Per-employee history ── */}
          <div className="als-card als-history">
            <div className="als-card__head">
              <span className="als-card__icon">📋</span>
              <h2 className="als-card__title">History — {selectedEmp.name}</h2>
              <button className="als-btn als-btn--sm als-btn--outline" onClick={() => loadHistory(selectedEmp.id)}>↺ Refresh</button>
            </div>
            {histLoading ? (
              <div className="als-loading">Loading…</div>
            ) : history.length === 0 ? (
              <div className="als-empty">No calculations saved yet for this employee.</div>
            ) : (
              <HistoryTable rows={history} editingId={editingId} onEdit={handleEdit} onDelete={handleDelete} />
            )}
          </div>
        </>
      )}

      {/* ── All-employees history (always visible) ── */}
      <div className="als-card als-history als-all-history">
        <div className="als-card__head">
          <span className="als-card__icon">📋</span>
          <h2 className="als-card__title">All Calculations History</h2>
          <button className="als-btn als-btn--sm als-btn--outline" onClick={loadAllHistory}>↺ Refresh</button>
        </div>
        {allHistLoading ? (
          <div className="als-loading">Loading…</div>
        ) : allHistory.length === 0 ? (
          <div className="als-empty">No calculations saved yet.</div>
        ) : (
          <HistoryTable rows={allHistory} editingId={editingId} onEdit={handleEdit} onDelete={handleDelete} showEmployee />
        )}
      </div>
    </div>
  )
}

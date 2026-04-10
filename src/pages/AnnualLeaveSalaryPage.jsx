import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { useEmployees } from '../hooks/useEmployees'
import './AnnualLeaveSalaryPage.css'

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
  if (!d) return '—'
  try {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return d }
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

export function AnnualLeaveSalaryPage({ embedded = false }) {
  const { employees } = useEmployees()
  const [empSearch, setEmpSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [calc, setCalc] = useState(EMPTY_CALC)
  const [overrides, setOverrides] = useState({})  // tracks which auto fields were manually overridden
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const printRef = useRef()

  // ── Filtered employee list ──
  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase()
    return employees.filter(e =>
      e.isActive !== false &&
      (e.name?.toLowerCase().includes(q) ||
       e.employeeId?.toLowerCase().includes(q) ||
       e.department?.toLowerCase().includes(q))
    ).slice(0, 12)
  }, [employees, empSearch])

  // ── Auto calculations ──
  const derived = useMemo(() => {
    const monthly   = toNum(calc.monthlySalary)
    const perDay    = overrides.perDayRate    ? toNum(calc.perDayRate)    : (monthly > 0 ? monthly / 30 : 0)
    const rmDays    = toNum(calc.runningMonthDays)
    const rmAmt     = overrides.runningMonthAmount ? toNum(calc.runningMonthAmount) : perDay * rmDays
    const lDays     = toNum(calc.leaveDaysToPay)
    const lAmt      = overrides.leaveSalaryAmount  ? toNum(calc.leaveSalaryAmount)  : perDay * lDays
    const additions = toNum(calc.otherAdditions)
    const deductions= toNum(calc.otherDeductions)
    const total     = overrides.grandTotal ? toNum(calc.grandTotal) : rmAmt + lAmt + additions - deductions
    return { perDay, rmAmt, lAmt, total }
  }, [calc, overrides])

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
    setShowDropdown(false)
    setCalc(prev => ({
      ...EMPTY_CALC,
      calculationDate: prev.calculationDate,
      monthlySalary: '',
    }))
    setOverrides({})
    setEditingId(null)
    setSaveMsg(null)
  }, [])

  // ── Load history ──
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

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!selectedEmp) return setSaveMsg({ type: 'error', text: 'Please select an employee first.' })
    const monthly = toNum(calc.monthlySalary)
    if (monthly <= 0) return setSaveMsg({ type: 'error', text: 'Monthly salary must be greater than 0.' })

    setSaving(true)
    setSaveMsg(null)
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
      if (editingId) {
        await api.put(`/api/annual-leave-salary/${editingId}`, payload)
        setSaveMsg({ type: 'success', text: 'Record updated successfully.' })
      } else {
        await api.post('/api/annual-leave-salary', payload)
        setSaveMsg({ type: 'success', text: 'Calculation saved successfully.' })
        setEditingId(null)
      }
      await loadHistory(selectedEmp.id)
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message || 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }, [selectedEmp, calc, derived, editingId, loadHistory])

  // ── Edit from history ──
  const handleEdit = useCallback((row) => {
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
    setSaveMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // ── Delete ──
  const handleDelete = useCallback(async (id) => {
    setDeletingId(id)
    try {
      await api.delete(`/api/annual-leave-salary/${id}`)
      if (editingId === id) {
        setEditingId(null)
        setCalc(EMPTY_CALC)
        setOverrides({})
      }
      await loadHistory(selectedEmp?.id)
    } catch (err) {
      alert(err.message || 'Failed to delete.')
    } finally {
      setDeletingId(null)
    }
  }, [editingId, loadHistory, selectedEmp])

  // ── New calculation ──
  const handleNew = useCallback(() => {
    setEditingId(null)
    setCalc(EMPTY_CALC)
    setOverrides({})
    setSaveMsg(null)
  }, [])

  // ── Print ──
  const handlePrint = useCallback(() => { window.print() }, [])

  return (
    <div className="als-page" ref={printRef}>
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
        </div>
        <div className="als-emp-selector__body">
          <div className="als-emp-search-wrap">
            <input
              className="als-emp-search"
              type="text"
              placeholder="Search by name, ID, or department…"
              value={empSearch}
              onChange={e => { setEmpSearch(e.target.value); setShowDropdown(true) }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 180)}
              autoComplete="off"
            />
            {showDropdown && filteredEmps.length > 0 && (
              <ul className="als-emp-dropdown">
                {filteredEmps.map(e => (
                  <li key={e.id}>
                    <button type="button" onMouseDown={() => selectEmployee(e)}>
                      <span className="als-emp-dropdown__name">{e.name}</span>
                      <span className="als-emp-dropdown__meta">{e.employeeId} · {e.department}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Employee info card ── */}
      {selectedEmp && (
        <div className="als-card als-emp-info">
          <div className="als-emp-info__avatar">
            {selectedEmp.photoUrl
              ? <img src={selectedEmp.photoUrl} alt="" />
              : <span>{(selectedEmp.name?.[0] || '?').toUpperCase()}</span>
            }
          </div>
          <div className="als-emp-info__grid">
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Employee Name</span>
              <span className="als-emp-info__value als-emp-info__value--name">{selectedEmp.name}</span>
            </div>
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Employee ID</span>
              <span className="als-emp-info__value">{selectedEmp.employeeId}</span>
            </div>
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Department</span>
              <span className="als-emp-info__value">{selectedEmp.department || '—'}</span>
            </div>
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Position</span>
              <span className="als-emp-info__value">{selectedEmp.designation || '—'}</span>
            </div>
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Joining Date</span>
              <span className="als-emp-info__value">{dateLabel(selectedEmp.joiningDate)}</span>
            </div>
            <div className="als-emp-info__item">
              <span className="als-emp-info__label">Status</span>
              <span className={`als-badge ${selectedEmp.isActive ? 'als-badge--active' : 'als-badge--inactive'}`}>
                {selectedEmp.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
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
                    <span className="als-field__hint">Monthly ÷ 30</span>
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
              <div className="als-save-row">
                <button
                  className="als-btn als-btn--primary als-btn--lg"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : (editingId ? '💾 Update Record' : '💾 Save Calculation')}
                </button>
                {editingId && (
                  <button className="als-btn als-btn--outline" onClick={handleNew}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>

            {/* Right: summary */}
            <div className="als-summary-panel">
              <div className="als-summary-card">
                <div className="als-summary-card__head">
                  <span>📊</span>
                  <span>Calculation Summary</span>
                </div>
                <div className="als-summary-card__emp">
                  {selectedEmp.name}
                  <span>{selectedEmp.employeeId} · {selectedEmp.department}</span>
                </div>
                <div className="als-summary-card__date">
                  Date: {dateLabel(calc.calculationDate)}
                </div>

                <div className="als-summary-rows">
                  <div className="als-summary-row">
                    <span>Monthly Salary</span>
                    <span>AED {fmt(calc.monthlySalary)}</span>
                  </div>
                  <div className="als-summary-row">
                    <span>Per Day Rate</span>
                    <span>AED {fmt(derived.perDay)}</span>
                  </div>
                  <div className="als-summary-divider" />
                  <div className="als-summary-row">
                    <span>Running Month ({toNum(calc.runningMonthDays)} days)</span>
                    <span>AED {fmt(derived.rmAmt)}</span>
                  </div>
                  <div className="als-summary-row">
                    <span>Leave Salary ({toNum(calc.leaveDaysToPay)} days)</span>
                    <span>AED {fmt(derived.lAmt)}</span>
                  </div>
                  {toNum(calc.otherAdditions) > 0 && (
                    <div className="als-summary-row als-summary-row--add">
                      <span>+ Other Additions</span>
                      <span>AED {fmt(calc.otherAdditions)}</span>
                    </div>
                  )}
                  {toNum(calc.otherDeductions) > 0 && (
                    <div className="als-summary-row als-summary-row--ded">
                      <span>− Other Deductions</span>
                      <span>AED {fmt(calc.otherDeductions)}</span>
                    </div>
                  )}
                  <div className="als-summary-divider" />
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

          {/* ── History ── */}
          <div className="als-card als-history" id="als-history">
            <div className="als-card__head">
              <span className="als-card__icon">📋</span>
              <h2 className="als-card__title">Calculation History — {selectedEmp.name}</h2>
              <button className="als-btn als-btn--sm als-btn--outline" onClick={() => loadHistory(selectedEmp.id)}>
                ↺ Refresh
              </button>
            </div>
            {histLoading ? (
              <div className="als-loading">Loading history…</div>
            ) : history.length === 0 ? (
              <div className="als-empty">No calculations saved yet for this employee.</div>
            ) : (
              <div className="als-table-wrap">
                <table className="als-table">
                  <thead>
                    <tr>
                      <th>#</th>
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
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id} className={editingId === row.id ? 'als-table__row--editing' : ''}>
                        <td>{row.id}</td>
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
                          <div className="als-table__acts">
                            <button
                              className="als-btn als-btn--sm als-btn--outline"
                              onClick={() => handleEdit(row)}
                            >Edit</button>
                            <button
                              className="als-btn als-btn--sm als-btn--danger"
                              onClick={() => handleDelete(row.id)}
                              disabled={deletingId === row.id}
                            >{deletingId === row.id ? '…' : 'Del'}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!selectedEmp && (
        <div className="als-empty-state">
          <div className="als-empty-state__icon">🏖️</div>
          <h3>Select an employee to get started</h3>
          <p>Search for an employee above to calculate their annual leave salary.</p>
        </div>
      )}
    </div>
  )
}

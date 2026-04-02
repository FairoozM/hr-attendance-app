import { useState, useEffect, useMemo } from 'react'
import { DEFAULT_DEPARTMENTS } from '../constants/employees'
import { useSettings } from '../contexts/SettingsContext'
import './EmployeeForm.css'

export function EmployeeForm({
  initial,
  onSave,
  onCancel,
  submitLabel = 'Save',
  existingEmployeeIds = [],
  excludeEmployeeId = null,
}) {
  const { departments: settingsDepartments } = useSettings()
  const baseDepartments =
    settingsDepartments?.length > 0 ? settingsDepartments : DEFAULT_DEPARTMENTS

  // Stable list so useEffect does not run every render and reset the department dropdown.
  const departments = useMemo(() => {
    if (initial?.department && baseDepartments.indexOf(initial.department) === -1) {
      return [initial.department, ...baseDepartments]
    }
    return baseDepartments
  }, [initial?.department, baseDepartments])

  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [department, setDepartment] = useState(
    () => initial?.department ?? departments[0]
  )

  // Only sync form when opening the modal or switching the employee being edited — not on every render.
  useEffect(() => {
    if (!initial) return
    setEmployeeId(initial.employeeId ?? '')
    setName(initial.name ?? '')
    setDepartment(initial.department ?? departments[0])
  }, [initial?.employeeId, initial?.name, initial?.department, departments])

  const trimmedIdLower = employeeId.trim().toLowerCase()
  const isDuplicate =
    trimmedIdLower &&
    existingEmployeeIds.some((id) => id === trimmedIdLower) &&
    (excludeEmployeeId == null || excludeEmployeeId !== trimmedIdLower)

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmedId = employeeId.trim()
    const trimmedName = name.trim()
    if (!trimmedId || !trimmedName) return
    if (isDuplicate) return
    onSave({
      employeeId: trimmedId,
      name: trimmedName,
      department: department.trim() || departments[0],
    })
  }

  return (
    <form className="employee-form" onSubmit={handleSubmit}>
      <label className="employee-form__label">
        Employee ID
        <input
          type="text"
          className={`employee-form__input ${isDuplicate ? 'employee-form__input--error' : ''}`}
          placeholder="e.g. EMP001"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          autoFocus
          required
        />
        {isDuplicate && (
          <span className="employee-form__error">This ID is already in use.</span>
        )}
      </label>
      <label className="employee-form__label">
        Full name
        <input
          type="text"
          className="employee-form__input"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="employee-form__label">
        Department
        <select
          className="employee-form__select"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <div className="employee-form__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary btn--sm"
          disabled={isDuplicate}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { DEFAULT_DEPARTMENTS } from '../constants/employees'
import { NATIONALITY_SUGGESTIONS } from '../constants/nationalities'
import { useSettings } from '../contexts/SettingsContext'
import './EmployeeForm.css'

function emptyToNull(s) {
  const t = String(s ?? '').trim()
  return t === '' ? null : t
}

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

  const departments = useMemo(() => {
    if (initial?.department && baseDepartments.indexOf(initial.department) === -1) {
      return [initial.department, ...baseDepartments]
    }
    return baseDepartments
  }, [initial?.department, baseDepartments])

  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [department, setDepartment] = useState(() => initial?.department ?? departments[0])
  const [joiningDate, setJoiningDate] = useState(initial?.joiningDate ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [emiratesId, setEmiratesId] = useState(initial?.emiratesId ?? '')
  const [passportNumber, setPassportNumber] = useState(initial?.passportNumber ?? '')
  const [nationality, setNationality] = useState(initial?.nationality ?? '')

  useEffect(() => {
    if (!initial) return
    setEmployeeId(initial.employeeId ?? '')
    setName(initial.name ?? '')
    setDepartment(initial.department ?? departments[0])
    setJoiningDate(initial.joiningDate ?? '')
    setPhotoUrl(initial.photoUrl ?? '')
    setPhone(initial.phone ?? '')
    setEmiratesId(initial.emiratesId ?? '')
    setPassportNumber(initial.passportNumber ?? '')
    setNationality(initial.nationality ?? '')
  }, [
    initial?.employeeId,
    initial?.name,
    initial?.department,
    initial?.joiningDate,
    initial?.photoUrl,
    initial?.phone,
    initial?.emiratesId,
    initial?.passportNumber,
    initial?.nationality,
    departments,
  ])

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
      joiningDate: emptyToNull(joiningDate),
      photoUrl: emptyToNull(photoUrl),
      phone: emptyToNull(phone),
      emiratesId: emptyToNull(emiratesId),
      passportNumber: emptyToNull(passportNumber),
      nationality: emptyToNull(nationality),
    })
  }

  return (
    <form className="employee-form" onSubmit={handleSubmit}>
      <div className="employee-form__section">
        <span className="employee-form__section-title">Core</span>
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
      </div>

      <div className="employee-form__section">
        <span className="employee-form__section-title">HR &amp; contact</span>
        <label className="employee-form__label">
          Joining date
          <input
            type="date"
            className="employee-form__input"
            value={joiningDate || ''}
            onChange={(e) => setJoiningDate(e.target.value)}
          />
        </label>
        <label className="employee-form__label">
          Profile picture
          <input
            type="url"
            className="employee-form__input"
            placeholder="https://…"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            inputMode="url"
            autoComplete="off"
          />
          <span className="employee-form__hint">Paste an image URL (HTTPS). Optional.</span>
        </label>
        <label className="employee-form__label">
          Contact number
          <input
            type="tel"
            className="employee-form__input"
            placeholder="e.g. +971 50 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </label>
      </div>

      <div className="employee-form__section">
        <span className="employee-form__section-title">Identity</span>
        <label className="employee-form__label">
          Passport number
          <input
            type="text"
            className="employee-form__input"
            placeholder="Passport number"
            value={passportNumber}
            onChange={(e) => setPassportNumber(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="employee-form__label">
          Nationality
          <input
            type="text"
            className="employee-form__input"
            placeholder="e.g. United Arab Emirates"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            list="employee-nationality-options"
            autoComplete="off"
          />
          <datalist id="employee-nationality-options">
            {NATIONALITY_SUGGESTIONS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span className="employee-form__hint">Choose a suggestion or type any country.</span>
        </label>
        <label className="employee-form__label">
          Emirates ID
          <input
            type="text"
            className="employee-form__input"
            placeholder="Emirates ID number"
            value={emiratesId}
            onChange={(e) => setEmiratesId(e.target.value)}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="employee-form__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={isDuplicate}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

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
  const [employmentStatus, setEmploymentStatus] = useState(initial?.employmentStatus ?? 'active')
  const [joiningDate, setJoiningDate] = useState(initial?.joiningDate ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [emiratesId, setEmiratesId] = useState(initial?.emiratesId ?? '')
  const [passportNumber, setPassportNumber] = useState(initial?.passportNumber ?? '')
  const [nationality, setNationality] = useState(initial?.nationality ?? '')
  const [includeInAttendance, setIncludeInAttendance] = useState(
    initial?.includeInAttendance !== false
  )
  const [weeklyOffDay, setWeeklyOffDay] = useState(initial?.weeklyOffDay ?? '')
  const [dutyLocation, setDutyLocation] = useState(initial?.dutyLocation ?? '')
  const [portalEmail, setPortalEmail] = useState(initial?.portalEmail ?? initial?.portalUsername ?? '')
  const [portalPassword, setPortalPassword] = useState('')

  useEffect(() => {
    if (!initial) return
    setEmployeeId(initial.employeeId ?? '')
    setName(initial.name ?? '')
    setDepartment(initial.department ?? departments[0])
    setEmploymentStatus(initial.employmentStatus ?? 'active')
    setJoiningDate(initial.joiningDate ?? '')
    setPhotoUrl(initial.photoUrl ?? '')
    setPhone(initial.phone ?? '')
    setEmiratesId(initial.emiratesId ?? '')
    setPassportNumber(initial.passportNumber ?? '')
    setNationality(initial.nationality ?? '')
    setIncludeInAttendance(initial.includeInAttendance !== false)
    setWeeklyOffDay(initial.weeklyOffDay ?? '')
    setDutyLocation(initial.dutyLocation ?? '')
    setPortalEmail(initial.portalEmail ?? initial.portalUsername ?? '')
    setPortalPassword('')
  }, [
    initial?.employeeId,
    initial?.name,
    initial?.department,
    initial?.employmentStatus,
    initial?.joiningDate,
    initial?.photoUrl,
    initial?.phone,
    initial?.emiratesId,
    initial?.passportNumber,
    initial?.nationality,
    initial?.includeInAttendance,
    initial?.weeklyOffDay,
    initial?.dutyLocation,
    initial?.portalEmail,
    initial?.portalUsername,
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
      employmentStatus,
      includeInAttendance,
      joiningDate: emptyToNull(joiningDate),
      photoUrl: emptyToNull(photoUrl),
      phone: emptyToNull(phone),
      emiratesId: emptyToNull(emiratesId),
      passportNumber: emptyToNull(passportNumber),
      nationality: emptyToNull(nationality),
      weeklyOffDay: weeklyOffDay || undefined,
      dutyLocation: dutyLocation || undefined,
      portalEmail: portalEmail.trim() || undefined,
      portalPassword: portalPassword ? portalPassword : undefined,
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
        <label className="employee-form__label">
          Employment status
          <select
            className="employee-form__select"
            value={employmentStatus}
            onChange={(e) => setEmploymentStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On leave</option>
            <option value="resigned">Resigned</option>
          </select>
        </label>
        <label className="employee-form__label employee-form__label--checkbox">
          <span className="employee-form__checkbox-wrap">
            <input
              type="checkbox"
              checked={includeInAttendance}
              onChange={(e) => setIncludeInAttendance(e.target.checked)}
            />
            <span>Include in attendance</span>
          </span>
          <span className="employee-form__hint">
            When unchecked, this person is hidden from the attendance grid and dashboard counts, regardless of employment status.
          </span>
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

      <div className="employee-form__section">
        <span className="employee-form__section-title">Schedule &amp; location</span>
        <label className="employee-form__label">
          Weekly off day
          <select
            className="employee-form__select"
            value={weeklyOffDay}
            onChange={(e) => setWeeklyOffDay(e.target.value)}
          >
            <option value="">Not set</option>
            <option value="sunday">Sunday</option>
            <option value="monday">Monday</option>
            <option value="tuesday">Tuesday</option>
            <option value="wednesday">Wednesday</option>
            <option value="thursday">Thursday</option>
            <option value="friday">Friday</option>
            <option value="saturday">Saturday</option>
          </select>
          <span className="employee-form__hint">The employee's regular weekly day off.</span>
        </label>
        <label className="employee-form__label">
          Primary work location
          <select
            className="employee-form__select"
            value={dutyLocation}
            onChange={(e) => setDutyLocation(e.target.value)}
          >
            <option value="">Not set</option>
            <option value="office">Office</option>
            <option value="warehouse">Warehouse</option>
            <option value="remote">Remote</option>
          </select>
        </label>
      </div>

      <div className="employee-form__section">
        <span className="employee-form__section-title">Employee portal</span>
        <p className="employee-form__hint employee-form__hint--block">
          Optional. Lets this employee sign in with their own email address and password (minimum 8 characters).
          When adding an employee, provide both fields to create portal access. When editing, leave the
          password blank to keep the current password.
        </p>
        <label className="employee-form__label">
          Portal login email
          <input
            type="email"
            className="employee-form__input"
            placeholder="employee@example.com"
            value={portalEmail}
            onChange={(e) => setPortalEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="employee-form__label">
          Portal password
          <input
            type="password"
            className="employee-form__input"
            placeholder={initial ? 'Leave blank to keep unchanged' : 'Minimum 8 characters'}
            value={portalPassword}
            onChange={(e) => setPortalPassword(e.target.value)}
            autoComplete="new-password"
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

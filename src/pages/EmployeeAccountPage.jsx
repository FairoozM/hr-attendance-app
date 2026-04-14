import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  useProfile,
  uploadProfileDoc,
  deleteProfileDoc,
  fetchAlternateEmployeeOptions,
} from '../hooks/useProfile'
import { PasswordSection } from '../components/PasswordSection'
import { fmtDMY } from '../utils/dateFormat'
import './Page.css'
import './EmployeeAccountPage.css'

// ── Completion ────────────────────────────────────────────────────────────────

const COMPLETION_FIELDS = [
  'phone', 'personal_email', 'date_of_birth', 'gender', 'nationality',
  'marital_status', 'current_address', 'city', 'country',
  'designation', 'employment_status',
  'emergency_contact_name', 'emergency_contact_phone',
  'passport_number', 'passport_doc_key',
  'visa_number', 'visa_doc_key',
  'emirates_id', 'emirates_id_doc_key',
]

function calcCompletion(p) {
  if (!p) return 0
  const filled = COMPLETION_FIELDS.filter((f) => p[f] != null && String(p[f]).trim() !== '').length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function val(v) {
  if (v == null || String(v).trim() === '') return '—'
  return String(v)
}

const fmtDate = fmtDMY

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function StatusBadge({ isActive, status }) {
  const effectiveStatus = status || (isActive ? 'Active' : 'Inactive')
  const cls = effectiveStatus.toLowerCase().includes('active') && !effectiveStatus.toLowerCase().includes('in')
    ? 'badge badge--success' : 'badge badge--muted'
  return <span className={cls}>{effectiveStatus}</span>
}

function CompletionBar({ pct }) {
  const cls = pct >= 80 ? 'completion--high' : pct >= 40 ? 'completion--mid' : 'completion--low'
  return (
    <div className={`completion-bar ${cls}`}>
      <div className="completion-bar__fill" style={{ width: `${pct}%` }} />
      <span className="completion-bar__label">{pct}% complete</span>
    </div>
  )
}

// ── Profile Header ─────────────────────────────────────────────────────────────

function ProfileHeader({ profile, onPhotoUploaded }) {
  const pct = calcCompletion(profile)
  const photoUrl = profile.photo_doc_url_signed || profile.photo_url
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPhotoError(null)
    setPhotoUploading(true)
    try {
      const result = await uploadProfileDoc('photo', file)
      onPhotoUploaded(result)
    } catch (err) {
      setPhotoError(err.message || 'Photo upload failed')
    } finally {
      setPhotoUploading(false)
    }
  }

  return (
    <div className="profile-header">
      <div className="profile-header__avatar-wrap">
        {photoUrl ? (
          <img src={photoUrl} alt="Profile" className="profile-header__avatar-img" />
        ) : (
          <div className="profile-header__avatar-placeholder">
            {initials(profile.full_name)}
          </div>
        )}
        <label className="profile-header__photo-upload" title="Change photo">
          {photoUploading ? '…' : '📷'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handlePhotoChange}
            disabled={photoUploading}
            style={{ display: 'none' }}
          />
        </label>
        {photoError && <p className="profile-header__photo-error">{photoError}</p>}
      </div>
      <div className="profile-header__info">
        <h2 className="profile-header__name">{profile.full_name}</h2>
        <p className="profile-header__meta">
          {profile.designation ? <span>{profile.designation}</span> : null}
          {profile.designation && profile.department ? <span className="sep">·</span> : null}
          {profile.department ? <span>{profile.department}</span> : null}
        </p>
        <div className="profile-header__badges">
          <StatusBadge isActive={profile.is_active} status={profile.employment_status} />
          <span className="profile-header__code">ID: {profile.employee_code}</span>
        </div>
        <CompletionBar pct={pct} />
      </div>
    </div>
  )
}

// ── Section: Personal Information ─────────────────────────────────────────────

function PersonalView({ p }) {
  return (
    <div className="profile-section-grid">
      <InfoRow label="Full Name" value={val(p.full_name)} />
      <InfoRow label="Date of Birth" value={fmtDate(p.date_of_birth)} />
      <InfoRow label="Gender" value={val(p.gender)} />
      <InfoRow label="Nationality" value={val(p.nationality)} />
      <InfoRow label="Marital Status" value={val(p.marital_status)} />
    </div>
  )
}

// ── Section: Contact Information ──────────────────────────────────────────────

function ContactView({ p }) {
  return (
    <div className="profile-section-grid profile-section-grid--contact">
      <InfoRow label="Mobile" value={val(p.phone)} />
      <InfoRow label="Personal Email" value={val(p.personal_email)} valueClassName="info-row__value--email" />
      <InfoRow label="Work Email" value={val(p.work_email)} valueClassName="info-row__value--email" />
      <InfoRow label="Address" value={val(p.current_address)} wide />
      <InfoRow label="City" value={val(p.city)} />
      <InfoRow label="Country" value={val(p.country)} />
    </div>
  )
}

// ── Section: Employment ───────────────────────────────────────────────────────

function EmploymentView({ p }) {
  return (
    <div className="profile-section-grid">
      <InfoRow label="Employee ID" value={val(p.employee_code)} />
      <InfoRow label="Department" value={val(p.department)} />
      <InfoRow label="Designation" value={val(p.designation)} />
      <InfoRow label="Joining Date" value={fmtDate(p.joining_date)} />
      <InfoRow label="Work Location" value={val(p.work_location)} />
      <InfoRow label="Reporting Manager" value={val(p.manager_name)} />
      <InfoRow label="Employment Status" value={val(p.employment_status)} />
      <InfoRow label="Alternate Employee" value={val(p.alternate_employee_name)} />
    </div>
  )
}

// ── Section: Emergency Contact ────────────────────────────────────────────────

function EmergencyView({ p }) {
  return (
    <div className="profile-section-grid">
      <InfoRow label="Contact Name" value={val(p.emergency_contact_name)} />
      <InfoRow label="Relationship" value={val(p.emergency_contact_relationship)} />
      <InfoRow label="Phone" value={val(p.emergency_contact_phone)} />
      <InfoRow label="Alternate Phone" value={val(p.emergency_contact_alt_phone)} />
    </div>
  )
}

// ── Section: Bank / Payroll ───────────────────────────────────────────────────

function BankView({ p }) {
  return (
    <div className="profile-section-grid">
      <InfoRow label="Bank Name" value={val(p.bank_name)} />
      <InfoRow label="Account Holder" value={val(p.account_holder_name)} />
      <InfoRow label="IBAN / Account No." value={val(p.iban)} />
    </div>
  )
}

// ── Shared InfoRow ────────────────────────────────────────────────────────────

function InfoRow({ label, value, wide, noWrap = false, valueClassName = '' }) {
  return (
    <div className={`info-row ${wide ? 'info-row--wide' : ''}`}>
      <span className="info-row__label">{label}</span>
      <span
        className={`info-row__value ${noWrap ? 'info-row__value--nowrap' : ''} ${valueClassName}`.trim()}
        title={String(value)}
      >
        {value}
      </span>
    </div>
  )
}

function ProfileSection({ title, children }) {
  return (
    <section className="profile-unified-section">
      <h3 className="profile-unified-section__title">{title}</h3>
      {children}
    </section>
  )
}

function EditableProfileSection({
  title,
  sectionId,
  editingSection,
  onEditSection,
  onCancelSection,
  children,
  editContent,
}) {
  const isEditing = editingSection === sectionId
  return (
    <section className="profile-unified-section">
      <div className="profile-unified-section__head">
        <h3 className="profile-unified-section__title">{title}</h3>
        {!isEditing ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEditSection(sectionId)}>
            Edit
          </button>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancelSection}>
            Cancel
          </button>
        )}
      </div>
      {isEditing ? editContent : children}
    </section>
  )
}

// ── Edit Form ─────────────────────────────────────────────────────────────────

function EditForm({ profile, activeTab, onSave, onCancel, alternateOptions = [] }) {
  const [form, setForm] = useState(() => ({
    full_name: profile.full_name || '',
    date_of_birth: profile.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : '',
    gender: profile.gender || '',
    nationality: profile.nationality || '',
    marital_status: profile.marital_status || '',
    phone: profile.phone || '',
    personal_email: profile.personal_email || '',
    work_email: profile.work_email || '',
    current_address: profile.current_address || '',
    city: profile.city || '',
    country: profile.country || '',
    joining_date: profile.joining_date ? String(profile.joining_date).slice(0, 10) : '',
    designation: profile.designation || '',
    alternate_employee_id:
      profile.alternate_employee_id != null ? String(profile.alternate_employee_id) : '',
    work_location: profile.work_location || '',
    manager_name: profile.manager_name || '',
    employment_status: profile.employment_status || '',
    emergency_contact_name: profile.emergency_contact_name || '',
    emergency_contact_relationship: profile.emergency_contact_relationship || '',
    emergency_contact_phone: profile.emergency_contact_phone || '',
    emergency_contact_alt_phone: profile.emergency_contact_alt_phone || '',
    bank_name: profile.bank_name || '',
    account_holder_name: profile.account_holder_name || '',
    iban: profile.iban || '',
    passport_number: profile.passport_number || '',
    passport_issue_date: profile.passport_issue_date ? String(profile.passport_issue_date).slice(0, 10) : '',
    passport_expiry_date: profile.passport_expiry_date ? String(profile.passport_expiry_date).slice(0, 10) : '',
    visa_number: profile.visa_number || '',
    visa_issue_date: profile.visa_issue_date ? String(profile.visa_issue_date).slice(0, 10) : '',
    visa_expiry_date: profile.visa_expiry_date ? String(profile.visa_expiry_date).slice(0, 10) : '',
    emirates_id: profile.emirates_id || '',
    emirates_id_issue_date: profile.emirates_id_issue_date ? String(profile.emirates_id_issue_date).slice(0, 10) : '',
    emirates_id_expiry_date: profile.emirates_id_expiry_date ? String(profile.emirates_id_expiry_date).slice(0, 10) : '',
  }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const showAll = activeTab === 'all'

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(form)
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      {saveError && <p className="edit-form__error" role="alert">{saveError}</p>}

      {(activeTab === 'personal' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Personal Information</legend>
          <div className="edit-grid">
            <Field label="Full Name" value={form.full_name} onChange={set('full_name')} />
            <Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
            <Field label="Gender" as="select" value={form.gender} onChange={set('gender')}>
              <option value="">Select</option>
              <option>Male</option>
              <option>Female</option>
              <option>Prefer not to say</option>
            </Field>
            <Field label="Nationality" value={form.nationality} onChange={set('nationality')} />
            <Field label="Marital Status" as="select" value={form.marital_status} onChange={set('marital_status')}>
              <option value="">Select</option>
              <option>Single</option>
              <option>Married</option>
              <option>Divorced</option>
              <option>Widowed</option>
            </Field>
          </div>
        </fieldset>
      )}

      {(activeTab === 'contact' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Contact &amp; Address</legend>
          <div className="edit-grid">
            <Field label="Mobile Number" value={form.phone} onChange={set('phone')} />
            <Field label="Personal Email" type="email" value={form.personal_email} onChange={set('personal_email')} />
            <Field label="Work Email" type="email" value={form.work_email} onChange={set('work_email')} />
            <Field label="Current Address" as="textarea" value={form.current_address} onChange={set('current_address')} wide />
            <Field label="City" value={form.city} onChange={set('city')} />
            <Field label="Country" value={form.country} onChange={set('country')} />
          </div>
        </fieldset>
      )}

      {(activeTab === 'employment' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Employment Details</legend>
          <div className="edit-grid">
            <Field label="Joining Date" type="date" value={form.joining_date} onChange={set('joining_date')} />
            <Field label="Designation / Job Title" value={form.designation} onChange={set('designation')} />
            <Field
              label="Alternate Employee"
              as="select"
              value={form.alternate_employee_id}
              onChange={set('alternate_employee_id')}
            >
              <option value="">Not selected</option>
              {alternateOptions.map((opt) => (
                <option key={opt.id} value={String(opt.id)}>
                  {opt.full_name} ({opt.employee_code})
                </option>
              ))}
            </Field>
            <Field label="Work Location" value={form.work_location} onChange={set('work_location')} />
            <Field label="Reporting Manager" value={form.manager_name} onChange={set('manager_name')} />
            <Field label="Employment Status" as="select" value={form.employment_status} onChange={set('employment_status')}>
              <option value="">Select</option>
              <option>Active</option>
              <option>On Leave</option>
              <option>Inactive</option>
              <option>Resigned</option>
            </Field>
          </div>
        </fieldset>
      )}

      {(activeTab === 'emergency' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Emergency Contact</legend>
          <div className="edit-grid">
            <Field label="Full Name" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
            <Field label="Relationship" value={form.emergency_contact_relationship} onChange={set('emergency_contact_relationship')} />
            <Field label="Phone Number" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
            <Field label="Alternate Phone" value={form.emergency_contact_alt_phone} onChange={set('emergency_contact_alt_phone')} />
          </div>
        </fieldset>
      )}

      {(activeTab === 'bank' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Bank / Payroll</legend>
          <div className="edit-grid">
            <Field label="Bank Name" value={form.bank_name} onChange={set('bank_name')} />
            <Field label="Account Holder Name" value={form.account_holder_name} onChange={set('account_holder_name')} />
            <Field label="IBAN / Account Number" value={form.iban} onChange={set('iban')} />
          </div>
        </fieldset>
      )}

      {(activeTab === 'documents' || showAll) && (
        <fieldset className="edit-fieldset">
          <legend>Document Metadata</legend>
          <p className="edit-fieldset__hint">Update document numbers and dates here. Upload files using the cards below.</p>
          <div className="edit-grid">
            <Field label="Passport Number" value={form.passport_number} onChange={set('passport_number')} />
            <Field label="Passport Issue Date" type="date" value={form.passport_issue_date} onChange={set('passport_issue_date')} />
            <Field label="Passport Expiry Date" type="date" value={form.passport_expiry_date} onChange={set('passport_expiry_date')} />
            <div className="edit-grid__divider" />
            <Field label="Visa Number" value={form.visa_number} onChange={set('visa_number')} />
            <Field label="Visa Issue Date" type="date" value={form.visa_issue_date} onChange={set('visa_issue_date')} />
            <Field label="Visa Expiry Date" type="date" value={form.visa_expiry_date} onChange={set('visa_expiry_date')} />
            <div className="edit-grid__divider" />
            <Field label="Emirates ID Number" value={form.emirates_id} onChange={set('emirates_id')} />
            <Field label="Emirates ID Issue Date" type="date" value={form.emirates_id_issue_date} onChange={set('emirates_id_issue_date')} />
            <Field label="Emirates ID Expiry Date" type="date" value={form.emirates_id_expiry_date} onChange={set('emirates_id_expiry_date')} />
          </div>
        </fieldset>
      )}

      <div className="edit-form__actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, as, type = 'text', value, onChange, wide, children }) {
  const cls = `edit-field ${wide ? 'edit-field--wide' : ''}`
  return (
    <div className={cls}>
      <label className="edit-field__label">{label}</label>
      {as === 'select' ? (
        <select className="edit-field__input" value={value} onChange={onChange}>{children}</select>
      ) : as === 'textarea' ? (
        <textarea className="edit-field__input edit-field__textarea" value={value} onChange={onChange} rows={3} />
      ) : (
        <input className="edit-field__input" type={type} value={value} onChange={onChange} />
      )}
    </div>
  )
}

// ── Documents Section ─────────────────────────────────────────────────────────

function DocumentCard({ icon, title, docKey, docUrl, fields, onUpload, onDelete, fileAccept, uploadHint }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [localUrl, setLocalUrl] = useState(null)

  const effectiveUrl = localUrl || docUrl
  const hasDoc = !!(docKey || effectiveUrl)

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadErr(null)
    setUploading(true)
    try {
      const result = await onUpload(file)
      setLocalUrl(result.docUrl)
    } catch (err) {
      setUploadErr(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Remove this document?')) return
    try {
      await onDelete()
      setLocalUrl(null)
    } catch (err) {
      setUploadErr(err.message || 'Delete failed')
    }
  }

  return (
    <div className={`doc-card ${hasDoc ? 'doc-card--has-doc' : ''}`}>
      <div className="doc-card__header">
        <span className="doc-card__icon">{icon}</span>
        <h4 className="doc-card__title">{title}</h4>
        {hasDoc && <span className="badge badge--success doc-card__badge">Uploaded</span>}
      </div>

      <dl className="doc-card__fields">
        {fields.map(({ label, value }) => (
          <div key={label} className="doc-card__field">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {uploadErr && <p className="doc-card__error">{uploadErr}</p>}

      <div className="doc-card__actions">
        {effectiveUrl && (
          <a href={effectiveUrl} target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--sm">
            View / Download
          </a>
        )}
        <label className={`btn btn--accent btn--sm ${uploading ? 'btn--disabled' : ''}`}>
          {uploading ? 'Uploading…' : hasDoc ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept={fileAccept || 'image/jpeg,image/png,image/webp,application/pdf'}
            onChange={handleFileChange}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
        {hasDoc && (
          <button type="button" className="btn btn--danger btn--sm" onClick={handleDelete}>
            Remove
          </button>
        )}
      </div>
      {uploadHint && <p className="doc-card__hint">{uploadHint}</p>}
    </div>
  )
}

function DocumentsSection({ profile, onDocUploaded, onDocDeleted }) {
  const handleUpload = (docType) => async (file) => {
    const result = await uploadProfileDoc(docType, file)
    onDocUploaded(docType, result)
    return result
  }

  const handleDelete = (docType) => async () => {
    await deleteProfileDoc(docType)
    onDocDeleted(docType)
  }

  return (
    <div className="docs-grid">
      <DocumentCard
        icon="🛂"
        title="Passport"
        docKey={profile.passport_doc_key}
        docUrl={profile.passport_doc_url}
        fields={[
          { label: 'Number', value: val(profile.passport_number) },
          { label: 'Issue Date', value: fmtDate(profile.passport_issue_date) },
          { label: 'Expiry Date', value: fmtDate(profile.passport_expiry_date) },
        ]}
        onUpload={handleUpload('passport')}
        onDelete={handleDelete('passport')}
      />
      <DocumentCard
        icon="📄"
        title="Visa"
        docKey={profile.visa_doc_key}
        docUrl={profile.visa_doc_url}
        fields={[
          { label: 'Number', value: val(profile.visa_number) },
          { label: 'Issue Date', value: fmtDate(profile.visa_issue_date) },
          { label: 'Expiry Date', value: fmtDate(profile.visa_expiry_date) },
        ]}
        onUpload={handleUpload('visa')}
        onDelete={handleDelete('visa')}
      />
      <DocumentCard
        icon="🪪"
        title="Emirates ID"
        docKey={profile.emirates_id_doc_key}
        docUrl={profile.emirates_id_doc_url}
        fields={[
          { label: 'Number', value: val(profile.emirates_id) },
          { label: 'Issue Date', value: fmtDate(profile.emirates_id_issue_date) },
          { label: 'Expiry Date', value: fmtDate(profile.emirates_id_expiry_date) },
        ]}
        onUpload={handleUpload('emirates-id')}
        onDelete={handleDelete('emirates-id')}
      />
      <DocumentCard
        icon="✍️"
        title="Signature"
        docKey={profile.signature_doc_key}
        docUrl={profile.signature_doc_url}
        fields={[{ label: 'Use', value: 'Document signing' }]}
        onUpload={handleUpload('signature')}
        onDelete={handleDelete('signature')}
        fileAccept="image/png"
        uploadHint="PNG only (.png). This signature will be used on generated documents."
      />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function EmployeeAccountPage() {
  const { user } = useAuth()
  const isEmployee = user?.role === 'employee'
  const { profile, loading, error, update, setProfile } = useProfile(isEmployee)
  const [editingSection, setEditingSection] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [alternateOptions, setAlternateOptions] = useState([])

  const handleSave = useCallback(async (formData) => {
    await update(formData)
    setEditingSection(null)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }, [update])

  const docKeyFieldByType = (docType) => {
    if (docType === 'emirates-id') return 'emirates_id_doc_key'
    if (docType === 'signature') return 'signature_doc_key'
    return `${docType}_doc_key`
  }
  const docUrlFieldByType = (docType) => {
    if (docType === 'emirates-id') return 'emirates_id_doc_url'
    if (docType === 'signature') return 'signature_doc_url'
    return `${docType}_doc_url`
  }

  const handleDocUploaded = useCallback((docType, result) => {
    setProfile((prev) => {
      if (!prev) return prev
      const keyField = docKeyFieldByType(docType)
      const urlField = docUrlFieldByType(docType)
      return { ...prev, [keyField]: result.key, [urlField]: result.docUrl }
    })
  }, [setProfile])

  const handleDocDeleted = useCallback((docType) => {
    setProfile((prev) => {
      if (!prev) return prev
      const keyField = docKeyFieldByType(docType)
      const urlField = docUrlFieldByType(docType)
      return { ...prev, [keyField]: null, [urlField]: null }
    })
  }, [setProfile])

  const handlePhotoUploaded = useCallback((result) => {
    setProfile((prev) => prev ? {
      ...prev,
      photo_doc_key: result.key,
      photo_doc_url_signed: result.docUrl,
    } : prev)
  }, [setProfile])

  useEffect(() => {
    if (!isEmployee) return
    fetchAlternateEmployeeOptions()
      .then((rows) => setAlternateOptions(Array.isArray(rows) ? rows : []))
      .catch(() => setAlternateOptions([]))
  }, [isEmployee])

  // Non-employee users (admin, warehouse) see only the account header + security tab
  if (!isEmployee) {
    return (
      <div className="page profile-page">
        <div className="profile-header">
          <div className="profile-header__avatar-placeholder" style={{ flexShrink: 0 }}>
            {(user?.displayName || user?.username || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div className="profile-header__info">
            <h2 className="profile-header__name">{user?.displayName || user?.username}</h2>
            <div className="profile-header__badges">
              <span className="badge badge--success">{user?.role}</span>
              <span className="profile-header__code">{user?.username}</span>
            </div>
          </div>
        </div>

        <div className="profile-tab-bar">
          <button type="button" className="profile-tab profile-tab--active">🔒 Security</button>
        </div>

        <div className="profile-tab-content">
          <PasswordSection />
        </div>
      </div>
    )
  }

  return (
    <div className="page profile-page">
      {loading && !profile && (
        <div className="profile-loading">
          <span className="profile-loading__spinner" />
          Loading profile…
        </div>
      )}
      {error && !profile && (
        <p className="page-error">{error}</p>
      )}
      {profile && (
        <>
          <ProfileHeader
            profile={profile}
            onPhotoUploaded={handlePhotoUploaded}
          />

          {saveSuccess && (
            <div className="profile-success-banner" role="status">
              ✓ Profile saved successfully
            </div>
          )}

          <div className="profile-tab-content">
            <>
              <EditableProfileSection
                title="Personal Information"
                sectionId="personal"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <EditForm
                    profile={profile}
                    activeTab="personal"
                    onSave={handleSave}
                    onCancel={() => setEditingSection(null)}
                  />
                }
              >
                <PersonalView p={profile} />
              </EditableProfileSection>

              <EditableProfileSection
                title="Contact Information"
                sectionId="contact"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <EditForm
                    profile={profile}
                    activeTab="contact"
                    onSave={handleSave}
                    onCancel={() => setEditingSection(null)}
                  />
                }
              >
                <ContactView p={profile} />
              </EditableProfileSection>

              <EditableProfileSection
                title="Employment Details"
                sectionId="employment"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <EditForm
                    profile={profile}
                    activeTab="employment"
                    onSave={handleSave}
                    onCancel={() => setEditingSection(null)}
                    alternateOptions={alternateOptions}
                  />
                }
              >
                <EmploymentView p={profile} />
              </EditableProfileSection>

              <EditableProfileSection
                title="Emergency Contact"
                sectionId="emergency"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <EditForm
                    profile={profile}
                    activeTab="emergency"
                    onSave={handleSave}
                    onCancel={() => setEditingSection(null)}
                  />
                }
              >
                <EmergencyView p={profile} />
              </EditableProfileSection>

              <EditableProfileSection
                title="Bank / Payroll"
                sectionId="bank"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <EditForm
                    profile={profile}
                    activeTab="bank"
                    onSave={handleSave}
                    onCancel={() => setEditingSection(null)}
                  />
                }
              >
                <BankView p={profile} />
              </EditableProfileSection>

              <EditableProfileSection
                title="Documents"
                sectionId="documents"
                editingSection={editingSection}
                onEditSection={(sectionId) => { setEditingSection(sectionId); setSaveSuccess(false) }}
                onCancelSection={() => setEditingSection(null)}
                editContent={
                  <>
                    <EditForm
                      profile={profile}
                      activeTab="documents"
                      onSave={handleSave}
                      onCancel={() => setEditingSection(null)}
                      alternateOptions={alternateOptions}
                    />
                    <DocumentsSection
                      profile={profile}
                      onDocUploaded={handleDocUploaded}
                      onDocDeleted={handleDocDeleted}
                    />
                  </>
                }
              >
                <DocumentsSection
                  profile={profile}
                  onDocUploaded={handleDocUploaded}
                  onDocDeleted={handleDocDeleted}
                />
              </EditableProfileSection>

              <ProfileSection title="Security">
                <PasswordSection />
              </ProfileSection>
            </>
          </div>
        </>
      )}
    </div>
  )
}

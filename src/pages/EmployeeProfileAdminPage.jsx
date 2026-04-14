import { useState, useEffect } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchEmployeeProfile } from '../hooks/useProfile'
import { api } from '../api/client'
import { AdminResetPasswordPanel } from '../components/PasswordSection'
import { fmtDMY } from '../utils/dateFormat'
import './Page.css'
import './EmployeeAccountPage.css'
import './EmployeeProfileAdminPage.css'

function val(v) {
  if (v == null || String(v).trim() === '') return '—'
  return String(v)
}

const fmtDate = fmtDMY

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

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

function InfoRow({ label, value, wide }) {
  return (
    <div className={`info-row ${wide ? 'info-row--wide' : ''}`}>
      <span className="info-row__label">{label}</span>
      <span className="info-row__value">{value}</span>
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="admin-profile-section">
      <h3 className="admin-profile-section__title">{title}</h3>
      <div className="profile-section-grid">{children}</div>
    </div>
  )
}

function AdminDocCard({ icon, title, docKey, docUrl, fields }) {
  const hasDoc = !!(docKey || docUrl)
  return (
    <div className={`doc-card ${hasDoc ? 'doc-card--has-doc' : ''}`}>
      <div className="doc-card__header">
        <span className="doc-card__icon">{icon}</span>
        <h4 className="doc-card__title">{title}</h4>
        {hasDoc ? (
          <span className="badge badge--success doc-card__badge">Uploaded</span>
        ) : (
          <span className="badge badge--muted doc-card__badge">Not uploaded</span>
        )}
      </div>
      <dl className="doc-card__fields">
        {fields.map(({ label, value }) => (
          <div key={label} className="doc-card__field">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {docUrl && (
        <div className="doc-card__actions">
          <a href={docUrl} target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--sm">
            View / Download
          </a>
        </div>
      )}
    </div>
  )
}

export function EmployeeProfileAdminPage() {
  const { user } = useAuth()
  const { id } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [portalUser, setPortalUser] = useState(null)
  const [showResetPwd, setShowResetPwd] = useState(false)

  if (user?.role !== 'admin') return <Navigate to="/attendance" replace />

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchEmployeeProfile(id)
      .then(setProfile)
      .catch((err) => setError(err.message || 'Failed to load profile'))
      .finally(() => setLoading(false))

    // Fetch portal user linked to this employee (for password reset)
    api.get('/api/admin/users')
      .then((users) => {
        const linked = users.find((u) => String(u.employee_id) === String(id))
        setPortalUser(linked || null)
      })
      .catch(() => setPortalUser(null))
  }, [id])

  const pct = calcCompletion(profile)
  const photoUrl = profile?.photo_doc_url_signed || profile?.photo_url

  return (
    <div className="page profile-page">
      <div className="admin-profile-nav">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/employees')}>
          ← Back to Employees
        </button>
        <span className="admin-profile-nav__label">Employee Profile</span>
      </div>

      {loading && (
        <div className="profile-loading">
          <span className="profile-loading__spinner" />
          Loading profile…
        </div>
      )}
      {error && <p className="page-error">{error}</p>}

      {profile && (
        <>
          {/* Header */}
          <div className="profile-header">
            <div className="profile-header__avatar-wrap">
              {photoUrl ? (
                <img src={photoUrl} alt="Profile" className="profile-header__avatar-img" />
              ) : (
                <div className="profile-header__avatar-placeholder">
                  {initials(profile.full_name)}
                </div>
              )}
            </div>
            <div className="profile-header__info">
              <h2 className="profile-header__name">{profile.full_name}</h2>
              <p className="profile-header__meta">
                {profile.designation && <span>{profile.designation}</span>}
                {profile.designation && profile.department && <span className="sep">·</span>}
                {profile.department && <span>{profile.department}</span>}
              </p>
              <div className="profile-header__badges">
                <span className={`badge ${profile.is_active ? 'badge--success' : 'badge--muted'}`}>
                  {profile.employment_status || (profile.is_active ? 'Active' : 'Inactive')}
                </span>
                <span className="profile-header__code">ID: {profile.employee_code}</span>
              </div>
              <div className="admin-profile-completion">
                <div className={`completion-bar ${pct >= 80 ? 'completion--high' : pct >= 40 ? 'completion--mid' : 'completion--low'}`}>
                  <div className="completion-bar__fill" style={{ width: `${pct}%` }} />
                  <span className="completion-bar__label">{pct}% complete</span>
                </div>
              </div>
            </div>
          </div>

          {/* All sections */}
          <div className="admin-profile-body">
            <SectionCard title="Personal Information">
              <InfoRow label="Full Name" value={val(profile.full_name)} />
              <InfoRow label="Date of Birth" value={fmtDate(profile.date_of_birth)} />
              <InfoRow label="Gender" value={val(profile.gender)} />
              <InfoRow label="Nationality" value={val(profile.nationality)} />
              <InfoRow label="Marital Status" value={val(profile.marital_status)} />
            </SectionCard>

            <SectionCard title="Contact Information">
              <InfoRow label="Mobile" value={val(profile.phone)} />
              <InfoRow label="Personal Email" value={val(profile.personal_email)} />
              <InfoRow label="Work Email" value={val(profile.work_email)} />
              <InfoRow label="Address" value={val(profile.current_address)} wide />
              <InfoRow label="City" value={val(profile.city)} />
              <InfoRow label="Country" value={val(profile.country)} />
            </SectionCard>

            <SectionCard title="Employment Details">
              <InfoRow label="Employee ID" value={val(profile.employee_code)} />
              <InfoRow label="Department" value={val(profile.department)} />
              <InfoRow label="Designation" value={val(profile.designation)} />
              <InfoRow label="Joining Date" value={fmtDate(profile.joining_date)} />
              <InfoRow label="Work Location" value={val(profile.work_location)} />
              <InfoRow label="Reporting Manager" value={val(profile.manager_name)} />
              <InfoRow label="Employment Status" value={val(profile.employment_status)} />
            </SectionCard>

            <SectionCard title="Emergency Contact">
              <InfoRow label="Contact Name" value={val(profile.emergency_contact_name)} />
              <InfoRow label="Relationship" value={val(profile.emergency_contact_relationship)} />
              <InfoRow label="Phone" value={val(profile.emergency_contact_phone)} />
              <InfoRow label="Alternate Phone" value={val(profile.emergency_contact_alt_phone)} />
            </SectionCard>

            <SectionCard title="Bank / Payroll">
              <InfoRow label="Bank Name" value={val(profile.bank_name)} />
              <InfoRow label="Account Holder" value={val(profile.account_holder_name)} />
              <InfoRow label="IBAN / Account No." value={val(profile.iban)} />
            </SectionCard>

            <div className="admin-profile-section">
              <h3 className="admin-profile-section__title">Documents</h3>
              <div className="docs-grid">
                <AdminDocCard
                  icon="🛂"
                  title="Passport"
                  docKey={profile.passport_doc_key}
                  docUrl={profile.passport_doc_url}
                  fields={[
                    { label: 'Number', value: val(profile.passport_number) },
                    { label: 'Issue Date', value: fmtDate(profile.passport_issue_date) },
                    { label: 'Expiry Date', value: fmtDate(profile.passport_expiry_date) },
                  ]}
                />
                <AdminDocCard
                  icon="📄"
                  title="Visa"
                  docKey={profile.visa_doc_key}
                  docUrl={profile.visa_doc_url}
                  fields={[
                    { label: 'Number', value: val(profile.visa_number) },
                    { label: 'Issue Date', value: fmtDate(profile.visa_issue_date) },
                    { label: 'Expiry Date', value: fmtDate(profile.visa_expiry_date) },
                  ]}
                />
                <AdminDocCard
                  icon="✍️"
                  title="Signature"
                  docKey={profile.signature_doc_key}
                  docUrl={profile.signature_doc_url}
                  fields={[{ label: 'Use', value: 'Document signing (PNG)' }]}
                />
                <AdminDocCard
                  icon="🪪"
                  title="Emirates ID"
                  docKey={profile.emirates_id_doc_key}
                  docUrl={profile.emirates_id_doc_url}
                  fields={[
                    { label: 'Number', value: val(profile.emirates_id) },
                    { label: 'Issue Date', value: fmtDate(profile.emirates_id_issue_date) },
                    { label: 'Expiry Date', value: fmtDate(profile.emirates_id_expiry_date) },
                  ]}
                />
              </div>
            </div>

            {/* Portal / Password Reset */}
            <div className="admin-profile-section">
              <h3 className="admin-profile-section__title">Portal Account</h3>
              {portalUser ? (
                <div className="admin-profile-portal">
                  <div className="admin-profile-portal__info">
                    <span className="info-row__label">Login Email</span>
                    <span className="info-row__value" style={{ fontFamily: 'monospace' }}>{portalUser.username}</span>
                  </div>
                  <div className="admin-profile-portal__info">
                    <span className="info-row__label">Role</span>
                    <span className="info-row__value">{portalUser.role}</span>
                  </div>
                  {!showResetPwd ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: '0.75rem' }}
                      onClick={() => setShowResetPwd(true)}
                    >
                      Reset Portal Password
                    </button>
                  ) : (
                    <div style={{ marginTop: '1rem' }}>
                      <AdminResetPasswordPanel
                        userId={portalUser.id}
                        username={portalUser.username}
                        onClose={() => setShowResetPwd(false)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  This employee does not have a portal login account.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

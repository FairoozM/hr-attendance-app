import { useEffect, useState } from 'react'
import {
  createAuditorAccount,
  createAuditorAssignment,
  fetchAuditorAssignments,
  fetchIsoSettings,
  revokeAuditorAssignment,
  updateIsoSettings,
} from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import type { IsoAuditorAssignment, IsoSettings } from './types'
import { formatIsoDateTime } from './utils/isoFormat'
import './isoQms.css'

export function IsoSettingsPage() {
  const { user } = useAuth()
  const canSettings = hasPermission(user, 'iso_qms', 'settings') || user?.role === 'admin'
  const [settings, setSettings] = useState<IsoSettings>({})
  const [assignments, setAssignments] = useState<IsoAuditorAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [assignUserId, setAssignUserId] = useState('')
  const [auditorEmail, setAuditorEmail] = useState('')
  const [auditorPassword, setAuditorPassword] = useState('')
  const [auditorExpiry, setAuditorExpiry] = useState('')
  const [creatingAuditor, setCreatingAuditor] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [s, a] = await Promise.all([fetchIsoSettings(), fetchAuditorAssignments()])
      setSettings(s || {})
      setAssignments(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  if (!canSettings) {
    return (
      <div className="page">
        <div className="iso-page">
          <IsoPageHeader title="ISO Settings" subtitle="Restricted to Quality Managers and administrators." />
          <div className="iso-error">You do not have permission to manage ISO settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="ISO Settings"
          subtitle="Certification profile and named auditor assignments. Auditors are portal users with role = auditor (create/assign from Roles & Permissions or Employees)."
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : (
          <>
            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Certification profile</h2>
              <div className="iso-filters__fields">
                {([
                  ['companyName', 'Company name'],
                  ['certificationScope', 'Certification scope'],
                  ['certificationBody', 'Certification body'],
                  ['certificateNumber', 'Certificate number'],
                  ['standard', 'Standard'],
                  ['qualityManager', 'Quality manager'],
                ] as const).map(([key, label]) => (
                  <input
                    key={key}
                    className="iso-filters__input"
                    placeholder={label}
                    value={String(settings[key] ?? '')}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                  />
                ))}
              </div>
              <div className="iso-inline-actions" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true)
                    setError('')
                    try {
                      const saved = await updateIsoSettings(settings)
                      setSettings(saved || settings)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Save failed')
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Save settings
                </button>
              </div>
            </section>

            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Create named auditor account</h2>
              <p className="iso-section-card__meta">
                Creates a portal user with role <strong>auditor</strong> (ISO &amp; QMS only). No public
                links — the auditor signs in with email and password.
              </p>
              <div className="iso-filters__fields">
                <input
                  className="iso-filters__input"
                  type="email"
                  placeholder="Auditor email"
                  value={auditorEmail}
                  onChange={(e) => setAuditorEmail(e.target.value)}
                />
                <input
                  className="iso-filters__input"
                  type="password"
                  placeholder="Temporary password (min 8)"
                  value={auditorPassword}
                  onChange={(e) => setAuditorPassword(e.target.value)}
                />
                <input
                  className="iso-filters__input"
                  type="date"
                  title="Access expiry"
                  value={auditorExpiry}
                  onChange={(e) => setAuditorExpiry(e.target.value)}
                />
              </div>
              <div className="iso-inline-actions" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={creatingAuditor || !auditorEmail.trim() || auditorPassword.length < 8}
                  onClick={async () => {
                    setCreatingAuditor(true)
                    setError('')
                    try {
                      await createAuditorAccount({
                        email: auditorEmail.trim(),
                        password: auditorPassword,
                        accessEndAt: auditorExpiry || null,
                        canCreateFindings: false,
                        canAddComments: true,
                      })
                      setAuditorEmail('')
                      setAuditorPassword('')
                      setAuditorExpiry('')
                      await refresh()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to create auditor')
                    } finally {
                      setCreatingAuditor(false)
                    }
                  }}
                >
                  {creatingAuditor ? 'Creating…' : 'Create auditor account'}
                </button>
              </div>
            </section>

            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Auditor assignments</h2>
              <p className="iso-section-card__meta">
                Named auditor accounts receive access only to ISO &amp; QMS. Assign an existing auditor
                user ID, or create one above. Access can be time-bounded and revoked immediately.
              </p>
              <div className="iso-inline-actions">
                <input
                  className="iso-filters__input"
                  style={{ maxWidth: 200 }}
                  placeholder="User ID"
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={async () => {
                    if (!assignUserId.trim()) return
                    try {
                      await createAuditorAssignment({
                        userId: Number(assignUserId),
                        accessStartAt: new Date().toISOString(),
                        canCreateFindings: false,
                        canAddComments: true,
                      })
                      setAssignUserId('')
                      refresh()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Assignment failed')
                    }
                  }}
                >
                  Assign auditor
                </button>
              </div>
              {assignments.length === 0 ? (
                <IsoEmptyState message="No auditor assignments yet." />
              ) : (
                <div className="iso-table-wrap" style={{ marginTop: '0.75rem' }}>
                  <table className="iso-table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>User</th><th>Audit</th><th>Access start</th><th>Access end</th>
                        <th>Last activity</th><th>Status</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => (
                        <tr key={a.id}>
                          <td>{a.userName || a.userId}</td>
                          <td>{a.auditReference || '—'}</td>
                          <td>{formatIsoDateTime(a.accessStartAt)}</td>
                          <td>{formatIsoDateTime(a.accessEndAt)}</td>
                          <td>{formatIsoDateTime(a.lastActivityAt || a.lastLoginAt)}</td>
                          <td>
                            <IsoStatusBadge
                              status={a.revokedAt ? 'Revoked' : a.active === false ? 'Inactive' : 'Active'}
                            />
                          </td>
                          <td>
                            {!a.revokedAt ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                onClick={async () => {
                                  try {
                                    await revokeAuditorAssignment(a.id)
                                    refresh()
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Revoke failed')
                                  }
                                }}
                              >
                                Revoke
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

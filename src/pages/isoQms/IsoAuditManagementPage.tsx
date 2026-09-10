import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createIsoAudit, updateIsoChecklistItem } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { useIsoAudit, useIsoAudits } from './hooks/useIsoAudits'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

const OUTCOMES = [
  'Conforming',
  'Opportunity for Improvement',
  'Observation',
  'Minor Nonconformity',
  'Major Nonconformity',
  'Not Applicable',
  'Not Reviewed',
]

export function IsoAuditManagementPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canManage = hasPermission(user, 'iso_qms', 'manage_audits')
  const filters = useMemo(() => ({}), [])
  const { items, loading, error, refresh } = useIsoAudits(filters)
  const { audit, loading: auditLoading, error: auditError, refresh: refreshAudit } = useIsoAudit(id)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    auditReference: '',
    auditType: 'Internal',
    auditYear: String(new Date().getFullYear()),
    scope: '',
  })
  const [actionError, setActionError] = useState('')

  if (id) {
    return (
      <div className="page">
        <div className="iso-page">
          <IsoPageHeader
            title={audit?.auditReference || 'Audit workspace'}
            subtitle="Checklist, evidence links, opening and closing meetings."
            actions={
              <Link className="btn btn--secondary" to="/iso-qms/audits">
                Back to audits
              </Link>
            }
          />
          {(auditError || actionError) && <div className="iso-error">{auditError || actionError}</div>}
          {auditLoading ? <IsoLoadingState /> : null}
          {audit ? (
            <>
              <div className="iso-grid-3">
                <div className="iso-section-card">
                  <h2 className="iso-section-card__title">Summary</h2>
                  <p className="iso-section-card__meta">
                    {audit.auditType} · {audit.auditYear || '—'} · <IsoStatusBadge status={audit.status} />
                  </p>
                  <p className="iso-muted">Scope: {audit.scope || '—'}</p>
                  <p className="iso-muted">Lead auditor: {audit.leadAuditor || '—'}</p>
                  <p className="iso-muted">
                    Planned {formatIsoDate(audit.plannedDate)} · Actual {formatIsoDate(audit.actualDate)}
                  </p>
                </div>
                <div className="iso-section-card">
                  <h2 className="iso-section-card__title">Opening meeting</h2>
                  <p className="iso-muted">{formatIsoDate(audit.openingMeetingAt) || 'Not recorded'}</p>
                  <p className="iso-muted">{audit.objective || '—'}</p>
                </div>
                <div className="iso-section-card">
                  <h2 className="iso-section-card__title">Closing meeting</h2>
                  <p className="iso-muted">{formatIsoDate(audit.closingMeetingAt) || 'Not recorded'}</p>
                  <p className="iso-muted">{audit.notes || '—'}</p>
                </div>
              </div>

              <section className="iso-section-card">
                <h2 className="iso-section-card__title">Checklist</h2>
                {(audit.checklistItems || []).length === 0 ? (
                  <IsoEmptyState message="No checklist items for this audit yet." />
                ) : (
                  <div className="iso-table-wrap">
                    <table className="iso-table">
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Clause</th>
                          <th>Process</th>
                          <th>Outcome</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(audit.checklistItems || []).map((item) => (
                          <tr key={item.id}>
                            <td>{item.question}</td>
                            <td>{item.clauseNumber || '—'}</td>
                            <td>{item.processDepartment || '—'}</td>
                            <td>
                              {canManage ? (
                                <select
                                  className="iso-filters__select"
                                  value={item.outcome || ''}
                                  onChange={async (e) => {
                                    setActionError('')
                                    try {
                                      await updateIsoChecklistItem(audit.id, item.id, {
                                        outcome: e.target.value,
                                      })
                                      refreshAudit()
                                    } catch (err) {
                                      setActionError(
                                        err instanceof Error ? err.message : 'Update failed'
                                      )
                                    }
                                  }}
                                >
                                  <option value="">Select</option>
                                  {OUTCOMES.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <IsoStatusBadge status={item.outcome} />
                              )}
                            </td>
                            <td>{item.auditorNote || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Audit Management"
          subtitle="Plan and run internal, surveillance, recertification and supplier audits."
          actions={
            canManage ? (
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                New audit
              </button>
            ) : null
          }
        />
        {(error || actionError) && <div className="iso-error">{error || actionError}</div>}
        {creating ? (
          <div className="iso-section-card">
            <h2 className="iso-section-card__title">Create audit</h2>
            <div className="iso-filters__fields">
              <input
                className="iso-filters__input"
                placeholder="Audit reference"
                value={form.auditReference}
                onChange={(e) => setForm({ ...form, auditReference: e.target.value })}
              />
              <select
                className="iso-filters__select"
                value={form.auditType}
                onChange={(e) => setForm({ ...form, auditType: e.target.value })}
              >
                {['Internal', 'Surveillance', 'Recertification', 'Supplier', 'Other External'].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  )
                )}
              </select>
              <input
                className="iso-filters__input"
                placeholder="Year"
                value={form.auditYear}
                onChange={(e) => setForm({ ...form, auditYear: e.target.value })}
              />
              <input
                className="iso-filters__input"
                placeholder="Scope"
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
              />
            </div>
            <div className="iso-inline-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  setActionError('')
                  try {
                    const created = await createIsoAudit({
                      ...form,
                      auditYear: Number(form.auditYear) || null,
                    })
                    setCreating(false)
                    await refresh()
                    navigate(`/iso-qms/audits/${created.id}`)
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Create failed')
                  }
                }}
              >
                Create
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <IsoLoadingState />
        ) : items.length === 0 ? (
          <IsoEmptyState message="No audits recorded yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th>Planned</th>
                  <th>Lead auditor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="iso-code">{a.auditReference}</td>
                    <td>{a.auditType}</td>
                    <td>{a.auditYear || '—'}</td>
                    <td>
                      <IsoStatusBadge status={a.status} />
                    </td>
                    <td>{formatIsoDate(a.plannedDate)}</td>
                    <td>{a.leadAuditor || '—'}</td>
                    <td>
                      <Link className="btn btn--secondary" to={`/iso-qms/audits/${a.id}`}>
                        Open workspace
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

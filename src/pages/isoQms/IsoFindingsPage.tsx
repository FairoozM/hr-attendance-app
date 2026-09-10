import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createIsoCorrectiveAction,
  createIsoFinding,
  fetchIsoCorrectiveActions,
  fetchIsoFindings,
  updateIsoCorrectiveAction,
} from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import type { IsoCorrectiveAction, IsoFinding } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoFindingsPage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'iso_qms', 'manage_audits')
  const canEdit = hasPermission(user, 'iso_qms', 'edit')
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState({
    search: '',
    status: searchParams.get('status') || '',
    overdue: searchParams.get('overdue') || '',
  })
  const [findings, setFindings] = useState<IsoFinding[]>([])
  const [cas, setCas] = useState<IsoCorrectiveAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [caFormId, setCaFormId] = useState<number | null>(null)
  const [caDraft, setCaDraft] = useState({
    caNumber: '',
    rootCause: '',
    correctiveActionDetails: '',
    responsiblePerson: '',
    targetDate: '',
  })

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [f, c] = await Promise.all([
        fetchIsoFindings({ status: filters.status || undefined, search: filters.search || undefined }),
        fetchIsoCorrectiveActions({
          overdue: filters.overdue || undefined,
          search: filters.search || undefined,
        }),
      ])
      setFindings(f)
      setCas(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load findings')
      setFindings([])
      setCas([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Findings & Corrective Actions"
          subtitle="Nonconformity register (FO-05A) linked to corrective-action workflow (FO-05B / FO-05C). Closure requires root cause, action, evidence, effectiveness and verification."
          actions={
            canManage ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  setError('')
                  try {
                    await createIsoFinding({
                      ncNumber: `NC-${Date.now().toString().slice(-6)}`,
                      findingDate: new Date().toISOString().slice(0, 10),
                      source: 'Internal audit',
                      status: 'Open',
                      description: '',
                    })
                    refresh()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Create finding failed')
                  }
                }}
              >
                New finding
              </button>
            ) : null
          }
        />
        {error ? <div className="iso-error">{error}</div> : null}
        <IsoFiltersBar
          fields={[
            { key: 'search', placeholder: 'Search NC / CA / description' },
            { key: 'status', placeholder: 'Finding status' },
            {
              key: 'overdue',
              type: 'select',
              placeholder: 'CA due',
              options: [{ value: 'true', label: 'Overdue CA only' }],
            },
          ]}
          values={filters}
          onChange={(next) => setFilters(next)}
        />

        {loading ? <IsoLoadingState /> : null}

        {!loading ? (
          <div className="iso-grid-2">
            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Findings</h2>
              {findings.length === 0 ? (
                <IsoEmptyState message="No findings recorded." />
              ) : (
                <div className="iso-table-wrap">
                  <table className="iso-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th>NC</th>
                        <th>Date</th>
                        <th>Classification</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {findings.map((f) => (
                        <tr key={f.id}>
                          <td className="iso-code">{f.ncNumber}</td>
                          <td>{formatIsoDate(f.findingDate)}</td>
                          <td>{f.classification || '—'}</td>
                          <td>
                            <IsoStatusBadge status={f.status} />
                          </td>
                          <td>
                            {canEdit || canManage ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                onClick={() => {
                                  setCaFormId(f.id)
                                  setCaDraft({
                                    caNumber: `CA-${Date.now().toString().slice(-6)}`,
                                    rootCause: '',
                                    correctiveActionDetails: '',
                                    responsiblePerson: '',
                                    targetDate: '',
                                  })
                                }}
                              >
                                Add CA
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {caFormId != null ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <div className="iso-filters__fields">
                    <input
                      className="iso-filters__input"
                      placeholder="CA number"
                      value={caDraft.caNumber}
                      onChange={(e) => setCaDraft({ ...caDraft, caNumber: e.target.value })}
                    />
                    <input
                      className="iso-filters__input"
                      placeholder="Root cause"
                      value={caDraft.rootCause}
                      onChange={(e) => setCaDraft({ ...caDraft, rootCause: e.target.value })}
                    />
                    <input
                      className="iso-filters__input"
                      placeholder="Corrective action"
                      value={caDraft.correctiveActionDetails}
                      onChange={(e) =>
                        setCaDraft({ ...caDraft, correctiveActionDetails: e.target.value })
                      }
                    />
                    <input
                      className="iso-filters__input"
                      placeholder="Responsible"
                      value={caDraft.responsiblePerson}
                      onChange={(e) => setCaDraft({ ...caDraft, responsiblePerson: e.target.value })}
                    />
                    <input
                      className="iso-filters__input"
                      type="date"
                      value={caDraft.targetDate}
                      onChange={(e) => setCaDraft({ ...caDraft, targetDate: e.target.value })}
                    />
                  </div>
                  <div className="iso-inline-actions" style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={async () => {
                        try {
                          await createIsoCorrectiveAction({ ...caDraft, findingId: caFormId })
                          setCaFormId(null)
                          refresh()
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Create CA failed')
                        }
                      }}
                    >
                      Save CA
                    </button>
                    <button type="button" className="btn btn--secondary" onClick={() => setCaFormId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Corrective actions</h2>
              {cas.length === 0 ? (
                <IsoEmptyState message="No corrective actions recorded." />
              ) : (
                <div className="iso-table-wrap">
                  <table className="iso-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th>CA</th>
                        <th>NC</th>
                        <th>Target</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cas.map((ca) => (
                        <tr key={ca.id}>
                          <td className="iso-code">{ca.caNumber}</td>
                          <td>{ca.ncNumber || '—'}</td>
                          <td>{formatIsoDate(ca.targetDate)}</td>
                          <td>
                            <IsoStatusBadge status={ca.status} />
                          </td>
                          <td>
                            {canEdit || canManage ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                onClick={async () => {
                                  try {
                                    await updateIsoCorrectiveAction(ca.id, {
                                      status: 'Effectiveness Review',
                                    })
                                    refresh()
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Update failed')
                                  }
                                }}
                              >
                                Advance
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
          </div>
        ) : null}
      </div>
    </div>
  )
}

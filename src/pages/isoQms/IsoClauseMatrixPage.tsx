import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchIsoClauseEvidence, fetchIsoClauses } from '../../api/isoQms'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import type { IsoClause, IsoDocument } from './types'
import './isoQms.css'

export function IsoClauseMatrixPage() {
  const [clauses, setClauses] = useState<IsoClause[]>([])
  const [selected, setSelected] = useState<IsoClause | null>(null)
  const [evidence, setEvidence] = useState<IsoDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await fetchIsoClauses()
        if (!cancelled) setClauses(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clauses')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const openClause = async (clause: IsoClause) => {
    setSelected(clause)
    setEvidenceLoading(true)
    try {
      setEvidence(await fetchIsoClauseEvidence(clause.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clause evidence')
      setEvidence([])
    } finally {
      setEvidenceLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="ISO 9001:2015 Clause Matrix"
          subtitle="Internal clause titles only (no copyrighted standard text). Drill from clause to supporting evidence."
          actions={
            <Link className="btn btn--secondary" to="/iso-qms/auditor-room">
              Auditor Room
            </Link>
          }
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : clauses.length === 0 ? (
          <IsoEmptyState message="Clause catalogue not seeded yet." />
        ) : (
          <div className="iso-grid-2">
            <div className="iso-table-wrap">
              <table className="iso-table" style={{ minWidth: 420 }}>
                <thead>
                  <tr><th>Clause</th><th>Title</th><th /></tr>
                </thead>
                <tbody>
                  {clauses.map((c) => (
                    <tr key={c.id}>
                      <td className="iso-code">{c.clauseNumber}</td>
                      <td>{c.title}</td>
                      <td>
                        <button type="button" className="btn btn--secondary" onClick={() => openClause(c)}>
                          Evidence
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="iso-section-card">
              <h2 className="iso-section-card__title">
                {selected ? `Clause ${selected.clauseNumber} — ${selected.title}` : 'Select a clause'}
              </h2>
              {evidenceLoading ? <IsoLoadingState /> : null}
              {!evidenceLoading && selected && evidence.length === 0 ? (
                <IsoEmptyState message="No linked documents for this clause yet." />
              ) : null}
              {!evidenceLoading && evidence.length > 0 ? (
                <ul className="iso-checklist">
                  {evidence.map((d) => (
                    <li key={d.id} className="iso-checklist__item">
                      <span>
                        {d.documentCode || d.title}
                        <div className="iso-muted">{d.status} · Rev {d.revision || '—'}</div>
                      </span>
                      <Link to={`/iso-qms/documents?search=${encodeURIComponent(d.documentCode || d.title)}`}>
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

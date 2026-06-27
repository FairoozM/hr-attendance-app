import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  completePublicKsaRtoBatch,
  getPublicKsaRtoBatch,
  updatePublicKsaRtoRowStatus,
  type AgentRowStatus,
  type PublicKsaRtoBatch,
  type PublicKsaRtoRow,
} from '../api/amazonKsaRtoAgentPublic'
import './AmazonKsaRtoAgentViewPage.css'

type FilterKey = 'all' | 'ready' | 'missing_pdf' | 'missing_fnsku' | 'checked' | 'issues'

const issueExamples = [
  'Missing physical item',
  'Wrong item/image mismatch',
  'FNSKU label not opening',
  'Quantity mismatch',
  'Damaged item',
  'Other',
]

function statusLabel(status: AgentRowStatus) {
  if (status === 'checked') return 'Checked'
  if (status === 'issue') return 'Issue'
  return 'Not checked'
}

function rowMatchesFilter(row: PublicKsaRtoRow, filter: FilterKey) {
  if (filter === 'all') return true
  if (filter === 'ready') return row.status === 'Ready'
  if (filter === 'missing_pdf') return !row.labelPdf || row.status === 'Missing PDF'
  if (filter === 'missing_fnsku') return !row.fnskuNo || row.status === 'Missing FNSKU'
  if (filter === 'checked') return row.agentRowStatus === 'checked'
  if (filter === 'issues') return row.agentRowStatus === 'issue'
  return true
}

function InvalidLinkScreen({ message }: { message: string }) {
  return (
    <main className="rto-agent-page rto-agent-page--center">
      <section className="rto-agent-invalid">
        <p className="rto-agent-eyebrow">Amazon KSA RTO</p>
        <h1>Shared link unavailable</h1>
        <p>{message || 'This link is invalid, expired, or disabled. Please ask Life Smile for a new link.'}</p>
      </section>
    </main>
  )
}

export function AmazonKsaRtoAgentViewPage() {
  const { shareToken = '' } = useParams()
  const [batch, setBatch] = useState<PublicKsaRtoBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [completeNotes, setCompleteNotes] = useState('')
  const [completedByName, setCompletedByName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await getPublicKsaRtoBatch(shareToken)
        if (!cancelled) {
          setBatch(result.batch)
          setCompleteNotes(result.batch.agentNotes || '')
          setCompletedByName(result.batch.agentCompletedByName || '')
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load shared batch.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [shareToken])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (batch?.rows || []).filter((row) => {
      const matchesSearch = !q || row.productCode.toLowerCase().includes(q) || row.fnskuNo.toLowerCase().includes(q)
      return matchesSearch && rowMatchesFilter(row, filter)
    })
  }, [batch?.rows, filter, search])

  const progressPercent = batch?.summary.totalLines
    ? Math.round(((batch.summary.checked + batch.summary.issues) / batch.summary.totalLines) * 100)
    : 0
  const isCompleted = batch?.agentStatus === 'completed'

  async function setRowStatus(row: PublicKsaRtoRow, agentRowStatus: AgentRowStatus, note = row.agentRowNote || '') {
    if (isCompleted) {
      setError('This batch is completed and locked.')
      return
    }
    setBusy(`row-${row.id}`)
    setError('')
    try {
      const result = await updatePublicKsaRtoRowStatus(shareToken, row.id, { agentRowStatus, agentRowNote: note })
      setBatch(result.batch)
      setMessage(`Row ${row.productCode} marked ${statusLabel(agentRowStatus).toLowerCase()}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update row.')
    } finally {
      setBusy('')
    }
  }

  async function completeBatch() {
    if (!batch || isCompleted) return
    if (!window.confirm('Complete this RTO labeling batch? You will not be able to change row statuses after completion.')) return
    setBusy('complete')
    setError('')
    try {
      const result = await completePublicKsaRtoBatch(shareToken, {
        agentNotes: completeNotes,
        completedByName,
      })
      setBatch(result.batch)
      setMessage('Batch completed. Thank you.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete batch.')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <main className="rto-agent-page rto-agent-page--center">
        <section className="rto-agent-invalid"><h1>Loading shared batch...</h1></section>
      </main>
    )
  }
  if (!batch) return <InvalidLinkScreen message={error} />

  return (
    <main className="rto-agent-page">
      <header className="rto-agent-hero">
        <div>
          <p className="rto-agent-eyebrow">Amazon KSA RTO - LIFESMILE</p>
          <h1>{batch.batchTitle || 'Amazon KSA RTO Labeling'}</h1>
          <p>{batch.referenceNo || 'No reference'} · {batch.destination || 'Wanasa-Lifesmile'}</p>
        </div>
        <div className={`rto-agent-status rto-agent-status--${batch.agentStatus}`}>
          {batch.agentStatus.replace('_', ' ')}
        </div>
      </header>

      <section className="rto-agent-summary">
        <div><span>Total SKUs</span><strong>{batch.summary.totalLines}</strong></div>
        <div><span>Total Qty</span><strong>{batch.summary.totalQuantity}</strong></div>
        <div><span>Ready</span><strong>{batch.summary.ready}</strong></div>
        <div><span>Missing PDF</span><strong>{batch.summary.missingPdf}</strong></div>
        <div><span>Missing FNSKU</span><strong>{batch.summary.missingFnsku}</strong></div>
        <div><span>Missing Image</span><strong>{batch.summary.missingImage}</strong></div>
      </section>

      <section className="rto-agent-progress-card">
        <div className="rto-agent-progress-head">
          <strong>Agent progress</strong>
          <span>{batch.summary.checked + batch.summary.issues} / {batch.summary.totalLines} reviewed</span>
        </div>
        <div className="rto-agent-progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
        <div className="rto-agent-progress-meta">
          <span>Checked {batch.summary.checked}</span>
          <span>Issues {batch.summary.issues}</span>
          <span>Not checked {batch.summary.notChecked}</span>
        </div>
      </section>

      {message ? <div className="rto-agent-banner rto-agent-banner--ok">{message}</div> : null}
      {error ? <div className="rto-agent-banner rto-agent-banner--error">{error}</div> : null}
      {isCompleted ? <div className="rto-agent-banner rto-agent-banner--ok">This batch is completed and locked.</div> : null}

      <section className="rto-agent-tools">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product code or FNSKU..." />
        <div className="rto-agent-filters">
          {[
            ['all', 'All'],
            ['ready', 'Ready'],
            ['missing_pdf', 'Missing PDF'],
            ['missing_fnsku', 'Missing FNSKU'],
            ['checked', 'Checked'],
            ['issues', 'Issues'],
          ].map(([key, label]) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key as FilterKey)} type="button">
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="rto-agent-card-grid">
        {filteredRows.map((row) => (
          <article key={row.id} className={`rto-agent-card rto-agent-card--${row.agentRowStatus}`}>
            <div className="rto-agent-image-wrap">
              {row.productImage?.downloadUrl ? <img src={row.productImage.downloadUrl} alt={row.productCode} /> : <div>Missing image</div>}
            </div>
            <div className="rto-agent-card-body">
              <div className="rto-agent-card-title">
                <h2>{row.productCode}</h2>
                <span>{statusLabel(row.agentRowStatus)}</span>
              </div>
              <div className="rto-agent-row-facts">
                <p><span>FNSKU</span><strong>{row.fnskuNo || 'Missing'}</strong></p>
                <p><span>Quantity</span><strong>{row.quantity}</strong></p>
                <p><span>Label PDF</span><strong>{row.labelPdf?.fileName || 'Missing PDF'}</strong></p>
              </div>
              <div className="rto-agent-pdf-actions">
                {row.labelPdf?.downloadUrl ? <a href={row.labelPdf.downloadUrl} target="_blank" rel="noreferrer">View Label PDF</a> : <span>PDF missing</span>}
                {row.labelPdf?.downloadUrl ? <a href={row.labelPdf.downloadUrl} download={row.labelPdf.fileName}>Download Label PDF</a> : null}
              </div>
              <div className="rto-agent-row-actions">
                <button disabled={isCompleted || busy === `row-${row.id}`} onClick={() => void setRowStatus(row, 'checked')} type="button">Mark checked</button>
                <button disabled={isCompleted || busy === `row-${row.id}`} onClick={() => void setRowStatus(row, 'not_checked', '')} type="button">Not checked</button>
              </div>
              <label className="rto-agent-note">
                Issue note
                <textarea
                  disabled={isCompleted}
                  placeholder={issueExamples.join(' · ')}
                  defaultValue={row.agentRowNote || ''}
                  onBlur={(e) => {
                    const note = e.currentTarget.value.trim()
                    if (note || row.agentRowStatus === 'issue') void setRowStatus(row, note ? 'issue' : 'not_checked', note)
                  }}
                />
              </label>
            </div>
          </article>
        ))}
        {!filteredRows.length ? <div className="rto-agent-empty">No rows match this filter.</div> : null}
      </section>

      <section className="rto-agent-complete">
        <h2>Complete Batch</h2>
        <label>
          Your name optional
          <input value={completedByName} onChange={(e) => setCompletedByName(e.target.value)} disabled={isCompleted} />
        </label>
        <label>
          Final notes optional
          <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} disabled={isCompleted} />
        </label>
        <button type="button" disabled={isCompleted || busy === 'complete'} onClick={() => void completeBatch()}>
          {isCompleted ? 'Batch Completed' : busy === 'complete' ? 'Completing...' : 'Complete Batch'}
        </button>
      </section>

      <div className="rto-agent-sticky">
        <button type="button" disabled={isCompleted || busy === 'complete'} onClick={() => void completeBatch()}>
          {isCompleted ? 'Completed' : 'Complete Batch'}
        </button>
      </div>
    </main>
  )
}

export default AmazonKsaRtoAgentViewPage

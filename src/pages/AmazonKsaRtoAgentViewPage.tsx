import { useEffect, useMemo, useRef, useState } from 'react'
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
type ViewMode = 'compact' | 'detailed'

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

function filterLabel(filter: FilterKey) {
  if (filter === 'missing_pdf') return 'Missing PDF'
  if (filter === 'missing_fnsku') return 'Missing FNSKU'
  return filter.charAt(0).toUpperCase() + filter.slice(1)
}

function friendlyError(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : ''
  if (
    /inconsistent types|postgres|sql|syntax|constraint|column|relation|parameter \$|database/i.test(message)
  ) {
    return fallback
  }
  return message || fallback
}

function InvalidLinkScreen({ message }: { message: string }) {
  return (
    <main className="rto-agent-page rto-agent-page--center">
      <section className="rto-agent-invalid">
        <p className="rto-agent-eyebrow">Amazon KSA RTO - LIFESMILE</p>
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
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({})
  const [completeNotes, setCompleteNotes] = useState('')
  const [completedByName, setCompletedByName] = useState('')
  const [confirmComplete, setConfirmComplete] = useState(false)
  const rowRefs = useRef<Record<number, HTMLElement | null>>({})

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
          setNoteDrafts(
            Object.fromEntries(result.batch.rows.map((row) => [row.id, row.agentRowNote || '']))
          )
        }
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, 'Could not load this shared batch. Please refresh or ask Life Smile for a new link.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [shareToken])

  useEffect(() => {
    if (!message && !error) return undefined
    const timer = window.setTimeout(() => {
      setMessage('')
      setError('')
    }, 4500)
    return () => window.clearTimeout(timer)
  }, [message, error])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (batch?.rows || []).filter((row) => {
      const matchesSearch = !q || row.productCode.toLowerCase().includes(q) || row.fnskuNo.toLowerCase().includes(q)
      return matchesSearch && rowMatchesFilter(row, filter)
    })
  }, [batch?.rows, filter, search])

  const filterCounts = useMemo(() => {
    const rows = batch?.rows || []
    return {
      all: rows.length,
      ready: rows.filter((row) => row.status === 'Ready').length,
      missing_pdf: rows.filter((row) => !row.labelPdf || row.status === 'Missing PDF').length,
      missing_fnsku: rows.filter((row) => !row.fnskuNo || row.status === 'Missing FNSKU').length,
      checked: rows.filter((row) => row.agentRowStatus === 'checked').length,
      issues: rows.filter((row) => row.agentRowStatus === 'issue').length,
    } satisfies Record<FilterKey, number>
  }, [batch?.rows])

  const progressPercent = batch?.summary.totalLines
    ? Math.round(((batch.summary.checked + batch.summary.issues) / batch.summary.totalLines) * 100)
    : 0
  const isCompleted = batch?.agentStatus === 'completed'
  const reviewedCount = batch ? batch.summary.checked + batch.summary.issues : 0
  const remainingCount = batch ? Math.max(batch.summary.totalLines - reviewedCount, 0) : 0

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
      setNoteDrafts((prev) => ({ ...prev, [row.id]: result.batch.rows.find((item) => item.id === row.id)?.agentRowNote || '' }))
      setMessage(`Row ${row.productCode} marked ${statusLabel(agentRowStatus).toLowerCase()}.`)
    } catch (err) {
      setError(friendlyError(err, 'Could not save this row status. Please try again.'))
    } finally {
      setBusy('')
    }
  }

  async function copyFnsku(row: PublicKsaRtoRow) {
    if (!row.fnskuNo) {
      setError('FNSKU is missing for this row.')
      return
    }
    try {
      await navigator.clipboard.writeText(row.fnskuNo)
      setMessage('FNSKU copied.')
    } catch {
      setError('Could not copy FNSKU. Please copy it manually.')
    }
  }

  function goToNextUnreviewed() {
    const next = (batch?.rows || []).find((row) => row.agentRowStatus === 'not_checked')
    if (!next) {
      setMessage('All rows are reviewed.')
      return
    }
    setFilter('all')
    window.setTimeout(() => rowRefs.current[next.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  async function completeBatch(force = false) {
    if (!batch || isCompleted) return
    if (!force && reviewedCount < batch.summary.totalLines) {
      setConfirmComplete(true)
      return
    }
    setConfirmComplete(false)
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
      setError(friendlyError(err, 'Could not complete this batch. Please try again.'))
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
    <main className={`rto-agent-page rto-agent-page--${viewMode}`}>
      <header className="rto-agent-hero">
        <div>
          <p className="rto-agent-eyebrow">Amazon KSA RTO - LIFESMILE</p>
          <h1>{batch.batchTitle || 'Amazon KSA RTO Labeling'}</h1>
          <div className="rto-agent-hero-meta">
            <span>Reference: <strong>{batch.referenceNo || 'No reference'}</strong></span>
            <span>Destination: <strong>{batch.destination || 'Wanasa-Lifesmile'}</strong></span>
          </div>
        </div>
        <div className={`rto-agent-status rto-agent-status--${batch.agentStatus}`}>
          {batch.agentStatus.replace('_', ' ')}
        </div>
      </header>

      <section className="rto-agent-summary">
        <div><span>Total SKUs</span><strong>{batch.summary.totalLines}</strong></div>
        <div><span>Total Qty</span><strong>{batch.summary.totalQuantity}</strong></div>
        <div><span>Reviewed</span><strong>{reviewedCount}</strong></div>
        <div><span>Checked</span><strong>{batch.summary.checked}</strong></div>
        <div><span>Issues</span><strong>{batch.summary.issues}</strong></div>
        <div><span>Remaining</span><strong>{remainingCount}</strong></div>
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
          <span>Ready {batch.summary.ready}</span>
          <span>Missing PDF {batch.summary.missingPdf}</span>
          <span>Missing FNSKU {batch.summary.missingFnsku}</span>
        </div>
      </section>

      {message ? <div className="rto-agent-banner rto-agent-banner--ok">{message}</div> : null}
      {error ? <div className="rto-agent-banner rto-agent-banner--error">{error}</div> : null}
      {isCompleted ? <div className="rto-agent-banner rto-agent-banner--ok">This batch is completed and locked.</div> : null}

      <section className="rto-agent-tools">
        <div className="rto-agent-toolbar">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product code or FNSKU..." />
          <button type="button" className="rto-agent-secondary-btn" onClick={goToNextUnreviewed}>Next unreviewed</button>
          <div className="rto-agent-view-toggle" aria-label="View mode">
            <button type="button" className={viewMode === 'compact' ? 'active' : ''} onClick={() => setViewMode('compact')}>Compact</button>
            <button type="button" className={viewMode === 'detailed' ? 'active' : ''} onClick={() => setViewMode('detailed')}>Detailed</button>
          </div>
        </div>
        <div className="rto-agent-filters">
          {(['all', 'ready', 'missing_pdf', 'missing_fnsku', 'checked', 'issues'] as FilterKey[]).map((key) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key as FilterKey)} type="button">
              {filterLabel(key)} <strong>{filterCounts[key]}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="rto-agent-card-grid">
        {filteredRows.map((row) => (
          <article
            key={row.id}
            ref={(node) => {
              rowRefs.current[row.id] = node
            }}
            className={`rto-agent-card rto-agent-card--${row.agentRowStatus} ${row.status !== 'Ready' ? 'rto-agent-card--warning' : ''}`}
          >
            <div className="rto-agent-image-wrap">
              {row.productImage?.downloadUrl ? <img src={row.productImage.downloadUrl} alt={row.productCode} /> : <div>Missing image</div>}
            </div>
            <div className="rto-agent-card-main">
              <div className="rto-agent-card-title">
                <div>
                  <h2>{row.productCode}</h2>
                  <div className="rto-agent-fnsku-line">
                    <span>FNSKU</span>
                    <strong>{row.fnskuNo || 'Missing'}</strong>
                    <button type="button" disabled={!row.fnskuNo} onClick={() => void copyFnsku(row)}>Copy</button>
                  </div>
                </div>
                <div className="rto-agent-badges">
                  <span className="rto-agent-qty">Qty {row.quantity}</span>
                  <span className={`rto-agent-row-state rto-agent-row-state--${row.agentRowStatus}`}>{statusLabel(row.agentRowStatus)}</span>
                  {row.status !== 'Ready' ? <span className="rto-agent-warning-badge">{row.status}</span> : null}
                </div>
              </div>
              {viewMode === 'detailed' ? (
                <div className="rto-agent-row-facts">
                  <p><span>Product Code</span><strong>{row.productCode}</strong></p>
                  <p><span>FNSKU</span><strong>{row.fnskuNo || 'Missing'}</strong></p>
                  <p><span>Label PDF</span><strong>{row.labelPdf?.fileName || 'Missing PDF'}</strong></p>
                </div>
              ) : null}
            </div>
            <div className="rto-agent-card-actions">
              <div className="rto-agent-pdf-actions">
                {row.labelPdf?.downloadUrl ? (
                  <>
                    <a className="rto-agent-pdf-primary" href={row.labelPdf.downloadUrl} target="_blank" rel="noreferrer">View Label PDF</a>
                    <a className="rto-agent-pdf-secondary" href={row.labelPdf.downloadUrl} download={row.labelPdf.fileName}>Download</a>
                  </>
                ) : (
                  <span className="rto-agent-pdf-missing">Label PDF missing</span>
                )}
              </div>
              <div className="rto-agent-segmented" aria-label={`Status for ${row.productCode}`}>
                {(['not_checked', 'checked', 'issue'] as AgentRowStatus[]).map((status) => (
                  <button
                    key={status}
                    disabled={isCompleted || busy === `row-${row.id}`}
                    className={row.agentRowStatus === status ? 'active' : ''}
                    onClick={() => void setRowStatus(row, status, status === 'issue' ? noteDrafts[row.id] || row.agentRowNote || '' : '')}
                    type="button"
                  >
                    {statusLabel(status)}
                  </button>
                ))}
              </div>
              {row.agentRowStatus === 'issue' ? (
                <div className="rto-agent-note">
                  <span>Issue note</span>
                  <div className="rto-agent-note-chips">
                    {issueExamples.map((example) => (
                      <button
                        key={example}
                        type="button"
                        disabled={isCompleted || busy === `row-${row.id}`}
                        onClick={() => {
                          setNoteDrafts((prev) => ({ ...prev, [row.id]: example }))
                          void setRowStatus(row, 'issue', example)
                        }}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                  <textarea
                    disabled={isCompleted || busy === `row-${row.id}`}
                    placeholder="Add issue details..."
                    value={noteDrafts[row.id] ?? row.agentRowNote ?? ''}
                    onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [row.id]: e.currentTarget.value }))}
                    onBlur={(e) => void setRowStatus(row, 'issue', e.currentTarget.value.trim())}
                  />
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {!filteredRows.length ? <div className="rto-agent-empty">No rows match this filter.</div> : null}
      </section>

      <section className="rto-agent-complete">
        <div>
          <h2>Complete Batch</h2>
          <p>{reviewedCount} of {batch.summary.totalLines} rows reviewed. Remaining: {remainingCount}.</p>
        </div>
        <label>
          Your name optional
          <input value={completedByName} onChange={(e) => setCompletedByName(e.target.value)} disabled={isCompleted} />
        </label>
        <label>
          Final notes optional
          <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} disabled={isCompleted} />
        </label>
        <button type="button" disabled={isCompleted || busy === 'complete'} onClick={() => void completeBatch(false)}>
          {isCompleted ? 'Batch Completed' : busy === 'complete' ? 'Completing...' : 'Complete Batch'}
        </button>
      </section>

      <div className="rto-agent-sticky">
        <button type="button" disabled={isCompleted || busy === 'complete'} onClick={() => void completeBatch(false)}>
          {isCompleted ? 'Completed' : 'Complete Batch'}
        </button>
      </div>

      {confirmComplete ? (
        <div className="rto-agent-modal" role="dialog" aria-modal="true" aria-labelledby="rto-complete-title">
          <div className="rto-agent-modal-card">
            <p className="rto-agent-eyebrow">Complete Batch</p>
            <h2 id="rto-complete-title">Only {reviewedCount} of {batch.summary.totalLines} rows reviewed.</h2>
            <p>Complete anyway, or review the remaining unreviewed rows first?</p>
            <div className="rto-agent-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setConfirmComplete(false)
                  goToNextUnreviewed()
                }}
              >
                Review remaining
              </button>
              <button type="button" className="danger" onClick={() => void completeBatch(true)}>
                Complete anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default AmazonKsaRtoAgentViewPage

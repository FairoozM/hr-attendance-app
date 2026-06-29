import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, Eye, FileText, Pencil, Trash2, TriangleAlert, X } from 'lucide-react'
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

type FilterKey = 'all' | 'ready' | 'checked' | 'issues' | 'not_checked'
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
  if (filter === 'checked') return row.agentRowStatus === 'checked'
  if (filter === 'issues') return row.agentRowStatus === 'issue'
  if (filter === 'not_checked') return row.agentRowStatus === 'not_checked'
  return true
}

function filterLabel(filter: FilterKey) {
  if (filter === 'not_checked') return 'Not checked'
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
  const [issuePanelRowId, setIssuePanelRowId] = useState<number | null>(null)
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
      const matchesSearch =
        !q ||
        row.productCode.toLowerCase().includes(q) ||
        row.productTitle.toLowerCase().includes(q) ||
        row.companyCode.toLowerCase().includes(q) ||
        row.fnskuNo.toLowerCase().includes(q)
      return matchesSearch && rowMatchesFilter(row, filter)
    })
  }, [batch?.rows, filter, search])

  const filterCounts = useMemo(() => {
    const rows = batch?.rows || []
    return {
      all: rows.length,
      ready: rows.filter((row) => row.status === 'Ready').length,
      checked: rows.filter((row) => row.agentRowStatus === 'checked').length,
      issues: rows.filter((row) => row.agentRowStatus === 'issue').length,
      not_checked: rows.filter((row) => row.agentRowStatus === 'not_checked').length,
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
      if (agentRowStatus !== 'issue') setIssuePanelRowId(null)
      setMessage(`Row ${row.productCode} marked ${statusLabel(agentRowStatus).toLowerCase()}.`)
    } catch (err) {
      setError(friendlyError(err, 'Could not save this row status. Please try again.'))
    } finally {
      setBusy('')
    }
  }

  async function toggleChecked(row: PublicKsaRtoRow, checked: boolean) {
    await setRowStatus(row, checked ? 'checked' : 'not_checked', '')
  }

  async function saveIssue(row: PublicKsaRtoRow) {
    const note = (noteDrafts[row.id] ?? row.agentRowNote ?? '').trim()
    await setRowStatus(row, 'issue', note)
    setIssuePanelRowId(null)
  }

  async function clearIssue(row: PublicKsaRtoRow) {
    setNoteDrafts((prev) => ({ ...prev, [row.id]: '' }))
    await setRowStatus(row, 'not_checked', '')
    setIssuePanelRowId(null)
  }

  async function confirmClearIssue(row: PublicKsaRtoRow) {
    if (!window.confirm(`Clear issue for ${row.productCode}? This will return the row to not checked.`)) return
    await clearIssue(row)
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
          <strong>Wanasa progress</strong>
          <span>{batch.summary.checked + batch.summary.issues} / {batch.summary.totalLines} reviewed</span>
        </div>
        <div className="rto-agent-progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
        <div className="rto-agent-progress-meta">
          <span>Checked {batch.summary.checked}</span>
          <span>Issues {batch.summary.issues}</span>
          <span>Remaining {remainingCount}</span>
          <span>Ready {batch.summary.ready}</span>
        </div>
      </section>

      {message ? <div className="rto-agent-banner rto-agent-banner--ok">{message}</div> : null}
      {error ? <div className="rto-agent-banner rto-agent-banner--error">{error}</div> : null}
      {isCompleted ? <div className="rto-agent-banner rto-agent-banner--ok">This batch is completed and locked.</div> : null}

      <section className="rto-agent-tools">
        <div className="rto-agent-toolbar">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product code, company code, title, or FNSKU..." />
          <button type="button" className="rto-agent-secondary-btn" onClick={goToNextUnreviewed}>Next unreviewed</button>
          <div className="rto-agent-view-toggle" aria-label="View mode">
            <button type="button" className={viewMode === 'compact' ? 'active' : ''} onClick={() => setViewMode('compact')}>Compact</button>
            <button type="button" className={viewMode === 'detailed' ? 'active' : ''} onClick={() => setViewMode('detailed')}>Detailed</button>
          </div>
        </div>
        <div className="rto-agent-filters">
          {(['all', 'ready', 'checked', 'issues', 'not_checked'] as FilterKey[]).map((key) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key as FilterKey)} type="button">
              {filterLabel(key)} <strong>{filterCounts[key]}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="rto-agent-card-grid">
        {filteredRows.map((row, rowIndex) => {
          const serialNo = String(
            (batch.rows.findIndex((item) => item.id === row.id) + 1) || rowIndex + 1
          ).padStart(2, '0')
          const rowBusy = busy === `row-${row.id}`
          const isChecked = row.agentRowStatus === 'checked'
          const hasIssue = row.agentRowStatus === 'issue'

          return (
            <article
              key={row.id}
              ref={(node) => {
                rowRefs.current[row.id] = node
              }}
              className={`rto-agent-card rto-agent-card--${row.agentRowStatus} ${row.status !== 'Ready' ? 'rto-agent-card--warning' : ''}`}
            >
              <div className="rto-agent-card-body">
                <div className="rto-agent-sr-badge" aria-hidden="true">
                  {serialNo}
                </div>

                <div className="rto-agent-image-wrap">
                  {row.productImage?.downloadUrl ? (
                    <img src={row.productImage.downloadUrl} alt={row.productCode} />
                  ) : (
                    <div className="rto-agent-image-missing">Missing image</div>
                  )}
                </div>

                <div className="rto-agent-card-main">
                  <div className="rto-agent-identity">
                    <div className="rto-agent-identity-row rto-agent-identity-row--primary">
                      <div className="rto-agent-identity-field">
                        <span className="rto-agent-identity-label">Product Code</span>
                        <strong className="rto-agent-product-code">{row.productCode}</strong>
                      </div>
                      <div className="rto-agent-identity-field">
                        <span className="rto-agent-identity-label">Amazon FNSKU</span>
                        <div className={`rto-agent-fnsku-value ${!row.fnskuNo ? 'rto-agent-fnsku-value--missing' : ''}`}>
                          <strong>{row.fnskuNo || 'Missing FNSKU'}</strong>
                          {row.fnskuNo ? (
                            <button
                              type="button"
                              className="rto-agent-copy-btn"
                              onClick={() => void copyFnsku(row)}
                              aria-label="Copy FNSKU"
                              title="Copy FNSKU"
                            >
                              <Copy size={15} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rto-agent-identity-row rto-agent-identity-row--meta">
                      <div className="rto-agent-identity-field">
                        <span className="rto-agent-identity-label">Company Code</span>
                        <strong className="rto-agent-company-code">{row.companyCode || '—'}</strong>
                      </div>
                      <div className="rto-agent-identity-field rto-agent-identity-field--title">
                        <span className="rto-agent-identity-label">Title</span>
                        <strong className="rto-agent-product-title">{row.productTitle || '—'}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="rto-agent-badges">
                    {!row.fnskuNo ? <span className="rto-agent-warning-badge">FNSKU missing</span> : null}
                    {!row.labelPdf ? <span className="rto-agent-warning-badge">Label missing</span> : null}
                    {row.status !== 'Ready' && row.fnskuNo && row.labelPdf ? (
                      <span className="rto-agent-warning-badge">{row.status}</span>
                    ) : null}
                  </div>

                  {viewMode === 'detailed' ? (
                    <div className="rto-agent-row-facts">
                      <p><span>Label PDF</span><strong>{row.labelPdf?.fileName || 'Label missing'}</strong></p>
                      <p><span>Row status</span><strong>{statusLabel(row.agentRowStatus)}</strong></p>
                      <p><span>Data status</span><strong>{row.status}</strong></p>
                    </div>
                  ) : null}
                </div>

                <div className="rto-agent-ops-panel">
                  <div className="rto-agent-ops-section rto-agent-ops-qty">
                    <span className="rto-agent-ops-label">QTY</span>
                    <strong className="rto-agent-ops-qty-value">{row.quantity}</strong>
                  </div>

                  <div className="rto-agent-ops-section rto-agent-ops-label-block">
                    <span className="rto-agent-ops-label">Amazon Label</span>
                    <div className="rto-agent-label-actions">
                      {row.labelPdf?.downloadUrl ? (
                        <>
                          <a
                            className="rto-agent-label-btn"
                            href={row.labelPdf.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View label PDF for ${row.productCode}`}
                          >
                            <Eye size={18} aria-hidden="true" />
                            <span>View</span>
                          </a>
                          <a
                            className="rto-agent-label-btn"
                            href={row.labelPdf.downloadUrl}
                            download={row.labelPdf.fileName}
                            aria-label={`Download label PDF for ${row.productCode}`}
                          >
                            <Download size={18} aria-hidden="true" />
                            <span>Download</span>
                          </a>
                        </>
                      ) : (
                        <span className="rto-agent-pdf-missing">
                          <FileText size={16} aria-hidden="true" />
                          Missing label
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rto-agent-ops-section rto-agent-ops-actions">
                    <span className="rto-agent-ops-label">Actions</span>
                    <label
                      className={`rto-agent-check-btn ${isChecked ? 'rto-agent-check-btn--checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isCompleted || rowBusy || hasIssue}
                        onChange={(event) => void toggleChecked(row, event.currentTarget.checked)}
                        aria-label={`Mark ${row.productCode} as checked`}
                      />
                      <span className="rto-agent-checkbox-box" aria-hidden="true">
                        {isChecked ? <Check size={16} /> : null}
                      </span>
                      <span>{isChecked ? 'Checked' : 'Check Item'}</span>
                    </label>
                  </div>

                  <div className="rto-agent-ops-section rto-agent-ops-status">
                    <span className="rto-agent-ops-label">Issue Status</span>
                    {hasIssue ? (
                      <button
                        type="button"
                        className="rto-agent-status-pill rto-agent-status-pill--issue"
                        disabled={isCompleted || rowBusy}
                        onClick={() => setIssuePanelRowId(row.id)}
                        aria-label={`View or edit issue for ${row.productCode}`}
                      >
                        <TriangleAlert size={16} aria-hidden="true" />
                        <span>Issue</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`rto-agent-status-pill rto-agent-status-pill--ok ${isChecked ? 'rto-agent-status-pill--ok-checked' : ''}`}
                        disabled={isCompleted || rowBusy}
                        onClick={() => setIssuePanelRowId((current) => (current === row.id ? null : row.id))}
                        aria-label={`Report issue for ${row.productCode}`}
                        title="Report issue"
                      >
                        <Check size={16} aria-hidden="true" />
                        <span>OK</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {issuePanelRowId === row.id ? (
                <div className="rto-agent-note">
                  <div className="rto-agent-note-head">
                    <span>Issue details</span>
                    <button
                      type="button"
                      className="rto-agent-note-close"
                      onClick={() => setIssuePanelRowId(null)}
                      aria-label={`Close issue panel for ${row.productCode}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="rto-agent-note-chips">
                    {issueExamples.map((example) => (
                      <button
                        key={example}
                        type="button"
                        disabled={isCompleted || rowBusy}
                        onClick={() => {
                          setNoteDrafts((prev) => ({ ...prev, [row.id]: example }))
                        }}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                  <textarea
                    disabled={isCompleted || rowBusy}
                    placeholder="Add issue details..."
                    value={noteDrafts[row.id] ?? row.agentRowNote ?? ''}
                    onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [row.id]: e.currentTarget.value }))}
                  />
                  <div className="rto-agent-note-actions">
                    <button type="button" onClick={() => setIssuePanelRowId(null)} disabled={rowBusy}>
                      Cancel
                    </button>
                    {hasIssue ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void confirmClearIssue(row)}
                          disabled={isCompleted || rowBusy}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          Clear issue
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void saveIssue(row)}
                          disabled={isCompleted || rowBusy}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          Save changes
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void saveIssue(row)}
                        disabled={isCompleted || rowBusy}
                      >
                        Save issue
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
        {!filteredRows.length ? <div className="rto-agent-empty">No rows match this filter.</div> : null}
        {batch.rows.length ? (
          <p className="rto-agent-list-footer">
            Showing <strong>{filteredRows.length}</strong> of <strong>{batch.rows.length}</strong> items
          </p>
        ) : null}
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

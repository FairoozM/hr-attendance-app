import { useCallback, useMemo, useRef, useState } from 'react'
import {
  type BatchDetailResponse,
  type BulkQtyAdjustmentRow,
  type BulkQtyAdjustmentSummary,
  downloadBulkAdjustmentErrors,
  downloadBulkAdjustmentResults,
  downloadTemplate,
  getBulkAdjustmentBatch,
  postBulkAdjustmentBatch,
  refreshBulkAdjustmentValuation,
  safeError,
  uploadBulkAdjustmentFile,
  validateBulkAdjustmentBatch,
} from '../../../../api/bulkQuantityAdjustment'
import '../../../Page.css'
import './BulkQuantityAdjustmentPage.css'

type StepId = 'upload' | 'validate' | 'review' | 'post' | 'results'

const STEPS: { id: StepId; label: string; icon: string }[] = [
  { id: 'upload', label: 'Upload file', icon: '⬆' },
  { id: 'validate', label: 'Validate SKUs', icon: '✓' },
  { id: 'review', label: 'Review adjustment', icon: '📋' },
  { id: 'post', label: 'Post to Zoho', icon: '🔗' },
  { id: 'results', label: 'Results', icon: '📊' },
]

const EMPTY_SUMMARY: BulkQtyAdjustmentSummary = {
  total_rows: 0,
  valid_rows: 0,
  unmatched_skus: 0,
  duplicate_skus: 0,
  invalid_quantities: 0,
  missing_warehouse: 0,
  missing_field: 0,
  error_rows: 0,
  ready_to_post: 0,
  posted_successfully: 0,
  failed: 0,
  pending_valuation: 0,
}

function statusBadge(status: string, kind: 'validation' | 'posting' | 'valuation') {
  const s = status.toLowerCase()
  if (kind === 'validation') {
    if (s === 'valid') return <span className="bqa-badge valid">Valid</span>
    return <span className="bqa-badge error">{status}</span>
  }
  if (kind === 'posting') {
    if (s === 'posted') return <span className="bqa-badge posted">Posted</span>
    if (s === 'failed') return <span className="bqa-badge error">Failed</span>
    if (s === 'ready') return <span className="bqa-badge valid">Ready</span>
    return <span className="bqa-badge pending">{status}</span>
  }
  if (s === 'pending') {
    return (
      <span className="bqa-badge pending bqa-tooltip" title="Zoho posts quantity first. Item value/cost may appear after Zoho finishes inventory valuation (often 10–25 minutes).">
        ⏱ Pending Valuation
      </span>
    )
  }
  if (s === 'complete') return <span className="bqa-badge valid">Valued</span>
  return <span className="bqa-badge pending">{status}</span>
}

function SummaryCards({ summary }: { summary: BulkQtyAdjustmentSummary }) {
  const cards = [
    { label: 'Total rows', value: summary.total_rows, cls: '' },
    { label: 'Valid rows', value: summary.valid_rows, cls: 'ok' },
    { label: 'Unmatched SKUs', value: summary.unmatched_skus, cls: summary.unmatched_skus ? 'bad' : '' },
    { label: 'Duplicate SKUs', value: summary.duplicate_skus, cls: summary.duplicate_skus ? 'warn' : '' },
    { label: 'Invalid quantities', value: summary.invalid_quantities, cls: summary.invalid_quantities ? 'bad' : '' },
    { label: 'Ready to post', value: summary.ready_to_post, cls: 'ok' },
    { label: 'Posted successfully', value: summary.posted_successfully, cls: 'ok' },
    { label: 'Failed', value: summary.failed, cls: summary.failed ? 'bad' : '' },
  ]
  return (
    <div className="bqa-summary-grid">
      {cards.map((c) => (
        <div key={c.label} className={`bqa-summary-card ${c.cls}`}>
          <strong>{c.value}</strong>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

function PreviewTable({ rows }: { rows: BulkQtyAdjustmentRow[] }) {
  return (
    <div className="bqa-table-wrap">
      <table className="bqa-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>SKU</th>
            <th>Zoho item name</th>
            <th>Item ID</th>
            <th>Current stock</th>
            <th>Adjustment</th>
            <th>Expected after</th>
            <th>Warehouse</th>
            <th>Reason</th>
            <th>Reference</th>
            <th>Status</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.row_number}</td>
              <td>{row.sku}</td>
              <td>{row.item_name || '—'}</td>
              <td>{row.zoho_item_id || '—'}</td>
              <td>{row.current_stock == null ? '—' : row.current_stock}</td>
              <td>{row.adjustment_qty}</td>
              <td>{row.expected_stock_after == null ? '—' : row.expected_stock_after}</td>
              <td>{row.warehouse_name || row.warehouse_id || '—'}</td>
              <td>{row.reason}</td>
              <td>{row.reference_number || '—'}</td>
              <td>{statusBadge(row.validation_status, 'validation')}</td>
              <td>{row.error_message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultsTable({ rows }: { rows: BulkQtyAdjustmentRow[] }) {
  return (
    <div className="bqa-table-wrap">
      <table className="bqa-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Warehouse</th>
            <th>Posting</th>
            <th>Valuation</th>
            <th>Zoho adjustment ID</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.row_number}</td>
              <td>{row.sku}</td>
              <td>{row.adjustment_qty}</td>
              <td>{row.warehouse_name || row.warehouse_id}</td>
              <td>{statusBadge(row.posting_status, 'posting')}</td>
              <td>{statusBadge(row.valuation_status, 'valuation')}</td>
              <td>{row.zoho_inventory_adjustment_id || '—'}</td>
              <td>{row.error_message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BulkQuantityAdjustmentPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<StepId>('upload')
  const [batchId, setBatchId] = useState<number | null>(null)
  const [batchRef, setBatchRef] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<BulkQtyAdjustmentRow[]>([])
  const [summary, setSummary] = useState<BulkQtyAdjustmentSummary>(EMPTY_SUMMARY)
  const [zohoAdjIds, setZohoAdjIds] = useState<string[]>([])
  const [postDate, setPostDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const hasBlockingErrors = summary.error_rows > 0
  const canPost = summary.ready_to_post > 0 && !hasBlockingErrors && batchId != null

  const applyBatchResponse = useCallback((data: BatchDetailResponse & { zoho_adjustment_ids?: string[] }) => {
    setRows(data.rows || [])
    setSummary(data.summary || EMPTY_SUMMARY)
    if (data.batch?.batch_reference) setBatchRef(data.batch.batch_reference)
    if (Array.isArray(data.zoho_adjustment_ids)) {
      setZohoAdjIds(data.zoho_adjustment_ids)
    } else if (Array.isArray(data.batch?.zoho_adjustment_ids)) {
      setZohoAdjIds(data.batch.zoho_adjustment_ids)
    }
  }, [])

  const handleDownloadTemplate = async () => {
    setError('')
    try {
      await downloadTemplate()
    } catch (err) {
      setError(safeError(err))
    }
  }

  const handleFilePick = async (file: File | null) => {
    if (!file) return
    setLoading('upload')
    setError('')
    setNotice('')
    try {
      const data = await uploadBulkAdjustmentFile(file)
      setBatchId(data.batch_id)
      setBatchRef(data.batch_reference)
      setFileName(file.name)
      setRows(data.rows || [])
      setSummary({
        ...EMPTY_SUMMARY,
        total_rows: data.rows?.length || 0,
      })
      setStep('validate')
      setNotice(`Uploaded ${data.rows?.length || 0} row(s). Run validation to match SKUs against Zoho.`)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading('')
    }
  }

  const handleValidate = async () => {
    if (!batchId) return
    setLoading('validate')
    setError('')
    setNotice('')
    try {
      const data = await validateBulkAdjustmentBatch(batchId)
      applyBatchResponse(data)
      setStep('review')
      if (data.summary.error_rows > 0) {
        setError(`${data.summary.error_rows} row(s) have blocking validation errors. Fix the file or export errors before posting.`)
      } else {
        setNotice(`${data.summary.valid_rows} row(s) are ready for review.`)
      }
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading('')
    }
  }

  const handlePost = async () => {
    if (!batchId) return
    setConfirmOpen(false)
    setLoading('post')
    setError('')
    setNotice('')
    setStep('post')
    try {
      const data = await postBulkAdjustmentBatch(batchId, { date: postDate })
      applyBatchResponse(data)
      setStep('results')
      setNotice(`Posted ${data.summary.posted_successfully} row(s) to Zoho Inventory.`)
    } catch (err) {
      setError(safeError(err))
      setStep('review')
    } finally {
      setLoading('')
    }
  }

  const handleRefreshValuation = async () => {
    if (!batchId) return
    setLoading('refresh')
    setError('')
    try {
      const data = await refreshBulkAdjustmentValuation(batchId)
      applyBatchResponse(data)
      setNotice('Valuation status refreshed from Zoho.')
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading('')
    }
  }

  const handleExportErrors = async () => {
    if (!batchId) return
    try {
      await downloadBulkAdjustmentErrors(batchId, `${batchRef || 'batch'}-errors.xlsx`)
    } catch (err) {
      setError(safeError(err))
    }
  }

  const handleExportResults = async () => {
    if (!batchId) return
    try {
      await downloadBulkAdjustmentResults(batchId, `${batchRef || 'batch'}-results.xlsx`)
    } catch (err) {
      setError(safeError(err))
    }
  }

  const handleReset = () => {
    setStep('upload')
    setBatchId(null)
    setBatchRef('')
    setFileName('')
    setRows([])
    setSummary(EMPTY_SUMMARY)
    setZohoAdjIds([])
    setError('')
    setNotice('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const pendingValuationCount = useMemo(
    () => rows.filter((r) => r.valuation_status === 'pending').length,
    [rows],
  )

  return (
    <div className="page bqa-page">
      <div className="bqa-shell">
        <header className="bqa-header">
          <div>
            <div className="bqa-eyebrow">Zoho · Inventory · Stock Tools</div>
            <h1 className="bqa-title">Bulk Quantity Adjustment</h1>
            <p className="bqa-subtitle">
              Upload up to ~100 SKUs with adjustment quantities, validate against Zoho Inventory, review, and post safely.
            </p>
          </div>
          {batchRef && (
            <div className="bqa-muted">
              Batch: <strong>{batchRef}</strong>
              {fileName ? <> · {fileName}</> : null}
            </div>
          )}
        </header>

        <div className="bqa-stepper">
          {STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`bqa-step ${step === s.id ? 'active' : ''} ${idx < stepIndex ? 'done' : ''}`}
            >
              <span className="bqa-step-icon">{s.icon}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {(summary.total_rows > 0 || step === 'results') && <SummaryCards summary={summary} />}

        {error && <div className="bqa-error">{error}</div>}
        {notice && <div className="bqa-notice">{notice}</div>}

        {step === 'upload' && (
          <section className="bqa-card">
            <h2 className="bqa-card-title">1. Upload file</h2>
            <p className="bqa-muted">
              Download the template, fill in SKU, adjustment quantity (positive = increase, negative = reduce), warehouse, and reason.
            </p>
            <div className="bqa-actions">
              <button type="button" className="bqa-btn bqa-btn-secondary" onClick={handleDownloadTemplate}>
                📄 Download CSV template
              </button>
            </div>
            <div className="bqa-upload-zone" style={{ marginTop: 16 }}>
              <p><strong>⬆ Upload CSV or Excel (.xlsx)</strong></p>
              <p className="bqa-muted">Required: sku, adjustment_qty, warehouse_name or warehouse_id, reason</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
              />
              <div className="bqa-actions" style={{ justifyContent: 'center' }}>
                <button
                  type="button"
                  className="bqa-btn bqa-btn-primary"
                  disabled={loading !== ''}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {loading === 'upload' ? 'Uploading…' : 'Choose file'}
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'validate' && (
          <section className="bqa-card">
            <h2 className="bqa-card-title">2. Validate SKUs</h2>
            <p className="bqa-muted">
              Match each SKU exactly against Zoho Inventory, validate warehouses and quantities. Nothing is posted yet.
            </p>
            <div className="bqa-actions">
              <button
                type="button"
                className="bqa-btn bqa-btn-primary"
                disabled={!batchId || loading !== ''}
                onClick={handleValidate}
              >
                {loading === 'validate' ? 'Validating…' : '✓ Run validation'}
              </button>
              <button type="button" className="bqa-btn bqa-btn-secondary" onClick={handleReset}>
                Start over
              </button>
            </div>
          </section>
        )}

        {(step === 'review' || step === 'post') && (
          <section className="bqa-card">
            <h2 className="bqa-card-title">3. Review adjustment</h2>
            <p className="bqa-muted">Verify SKU, warehouse, and quantity before posting to Zoho.</p>
            <PreviewTable rows={rows} />
            <div className="bqa-actions">
              {hasBlockingErrors && (
                <button type="button" className="bqa-btn bqa-btn-secondary" onClick={handleExportErrors}>
                  ⚠ Export validation errors (Excel)
                </button>
              )}
              <label className="bqa-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Adjustment date:
                <input type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)} />
              </label>
              <button
                type="button"
                className="bqa-btn bqa-btn-primary"
                disabled={!canPost || loading !== ''}
                onClick={() => setConfirmOpen(true)}
              >
                🔗 Post to Zoho
              </button>
              <button type="button" className="bqa-btn bqa-btn-secondary" onClick={() => setStep('validate')}>
                Re-validate
              </button>
            </div>
            {hasBlockingErrors && (
              <div className="bqa-error" style={{ marginTop: 12 }}>
                Posting is blocked until all validation errors are resolved.
              </div>
            )}
          </section>
        )}

        {step === 'results' && (
          <section className="bqa-card">
            <h2 className="bqa-card-title">5. Results</h2>
            {zohoAdjIds.length > 0 && (
              <div className="bqa-success">
                Created Zoho adjustment ID(s): {zohoAdjIds.join(', ')}
              </div>
            )}
            {pendingValuationCount > 0 && (
              <div className="bqa-notice">
                ⏱ {pendingValuationCount} row(s) have <strong>Pending Valuation</strong>.
                {' '}
                <span className="bqa-tooltip" title="Zoho posts quantity first. Item value/cost may appear after Zoho finishes inventory valuation (often 10–25 minutes).">
                  Quantity was posted successfully — this is not an error.
                </span>
              </div>
            )}
            <ResultsTable rows={rows} />
            <div className="bqa-actions">
              <button type="button" className="bqa-btn bqa-btn-secondary" onClick={handleExportResults}>
                📄 Download result Excel
              </button>
              <button
                type="button"
                className="bqa-btn bqa-btn-secondary"
                disabled={loading === 'refresh'}
                onClick={handleRefreshValuation}
              >
                {loading === 'refresh' ? 'Refreshing…' : '⏱ Refresh valuation status'}
              </button>
              <button type="button" className="bqa-btn bqa-btn-secondary" onClick={handleReset}>
                New batch
              </button>
            </div>
          </section>
        )}

        {confirmOpen && (
          <div className="bqa-modal-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
            <div className="bqa-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>Confirm Zoho posting</h3>
              <p className="bqa-muted">
                <strong>Warning:</strong> This will create quantity adjustments in Zoho Inventory.
                Please verify SKU, warehouse, and quantity before continuing.
              </p>
              <p className="bqa-muted">
                {summary.ready_to_post} row(s) will be posted on {postDate}.
              </p>
              <div className="bqa-actions">
                <button type="button" className="bqa-btn bqa-btn-danger" onClick={handlePost}>
                  Yes, post to Zoho
                </button>
                <button type="button" className="bqa-btn bqa-btn-secondary" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

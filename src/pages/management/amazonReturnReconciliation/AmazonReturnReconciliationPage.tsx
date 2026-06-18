import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteAmazonReturnLabel,
  downloadAmazonReturnBatch,
  getAmazonReturnBatch,
  listAmazonReturnBatches,
  regenerateAmazonReturnLink,
  updateCombinedStockRow,
  uploadAmazonReturnBatch,
  uploadCombinedStockLabel,
  type AmazonReturnBatch,
  type AmazonReturnDetail,
  type CombinedStockRow,
  type MarketplaceCode,
  type ProcessingStatusPatch,
} from '../../../api/amazonReturnReconciliation'
import '../../Page.css'
import './AmazonReturnReconciliationPage.css'

const WORKFLOW_STEPS = [
  'Upload Return File',
  'Review Returned Stock',
  'Review Old Stock',
  'Combined Available Stock',
  'Upload Labels',
  'Share Agent Link',
]

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

function absolutePublicUrl(path: string) {
  if (!path) return ''
  return `${window.location.origin}${window.location.pathname}#${path}`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  }
}

function ProcessingChecks({
  row,
  onChange,
}: {
  row: CombinedStockRow
  onChange: (patch: ProcessingStatusPatch) => void
}) {
  return (
    <div className="arr-processing">
      {([
        ['labelDownloaded', 'Label Downloaded'],
        ['labelPrinted', 'Label Printed'],
        ['relabeled', 'Relabeled'],
        ['packed', 'Packed'],
        ['readyForShipment', 'Ready for Shipment'],
      ] as const).map(([key, label]) => (
        <label className="arr-check" key={key}>
          <input
            type="checkbox"
            checked={row[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
    </div>
  )
}

function CombinedRow({
  row,
  onUpdate,
  onUploadLabel,
  onDeleteLabel,
}: {
  row: CombinedStockRow
  onUpdate: (row: CombinedStockRow, patch: ProcessingStatusPatch) => Promise<void>
  onUploadLabel: (row: CombinedStockRow, file: File) => Promise<void>
  onDeleteLabel: (row: CombinedStockRow) => Promise<void>
}) {
  const labelInputRef = useRef<HTMLInputElement | null>(null)
  const [notes, setNotes] = useState(row.notes)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNotes(row.notes)
  }, [row.notes])

  const saveNotes = async () => {
    setSaving(true)
    try {
      await onUpdate(row, { notes })
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td><strong>{row.workingSku}</strong></td>
      <td>{row.returnedQty}</td>
      <td>{row.oldStockQty}</td>
      <td><strong>{row.totalAvailableQty}</strong></td>
      <td>
        <span className={`arr-badge ${row.label ? 'arr-badge--ok' : 'arr-badge--muted'}`}>{row.labelStatus}</span>
        {row.label ? <span className="arr-subtle">{row.label.fileName}</span> : null}
        <input
          ref={labelInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onUploadLabel(row, file)
            event.currentTarget.value = ''
          }}
        />
        <div className="arr-actions">
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => labelInputRef.current?.click()}>
            {row.label ? 'Replace' : 'Upload'}
          </button>
          {row.label ? (
            <button className="btn btn--danger btn--sm" type="button" onClick={() => void onDeleteLabel(row)}>
              Delete
            </button>
          ) : null}
        </div>
      </td>
      <td>
        <ProcessingChecks row={row} onChange={(patch) => void onUpdate(row, patch)} />
      </td>
      <td>
        <textarea className="arr-input arr-note" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn btn--primary btn--sm" type="button" disabled={saving} onClick={() => void saveNotes()}>
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      </td>
    </tr>
  )
}

export function AmazonReturnReconciliationPage() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [batches, setBatches] = useState<AmazonReturnBatch[]>([])
  const [detail, setDetail] = useState<AmazonReturnDetail | null>(null)
  const [title, setTitle] = useState('')
  const [marketplace, setMarketplace] = useState<MarketplaceCode>('KSA')
  const [agentName, setAgentName] = useState('')
  const [shippingTo, setShippingTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  const publicUrl = useMemo(() => (detail ? absolutePublicUrl(detail.publicUrlPath) : ''), [detail])

  const refreshBatches = useCallback(async () => {
    const json = await listAmazonReturnBatches()
    setBatches(json.batches || [])
  }, [])

  useEffect(() => {
    setLoading(true)
    refreshBatches()
      .then(async () => {
        const json = await listAmazonReturnBatches()
        const first = json.batches?.[0]
        setBatches(json.batches || [])
        if (first) setDetail(await getAmazonReturnBatch(first.id))
      })
      .catch((err) => setError(safeError(err)))
      .finally(() => setLoading(false))
  }, [refreshBatches])

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose an Excel or CSV file first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const json = await uploadAmazonReturnBatch({ file, title, marketplace, agentName, shippingTo })
      setDetail(json)
      await refreshBatches()
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const selectBatch = async (batchId: number) => {
    setBusy(true)
    setError('')
    try {
      setDetail(await getAmazonReturnBatch(batchId))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const updateCombined = async (row: CombinedStockRow, patch: ProcessingStatusPatch) => {
    setError('')
    try {
      setDetail(await updateCombinedStockRow(row.id, patch))
    } catch (err) {
      setError(safeError(err))
    }
  }

  const uploadLabel = async (row: CombinedStockRow, file: File) => {
    setBusy(true)
    setError('')
    try {
      setDetail(await uploadCombinedStockLabel(row.id, file))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteLabel = async (row: CombinedStockRow) => {
    if (!row.label) return
    setBusy(true)
    setError('')
    try {
      setDetail(await deleteAmazonReturnLabel(row.label.id))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      setDetail(await regenerateAmazonReturnLink(detail.batch.id))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="arr-page">
        <header className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">Amazon Return Reconciliation</h1>
            <p className="doc-page-subtitle">
              Operational workflow for KSA/UAE agent stock relabeling: returned stock + old stock = available stock to relabel and ship.
            </p>
          </div>
          <button className="btn btn--primary" type="button" disabled={!detail} onClick={() => detail && void downloadAmazonReturnBatch(detail.batch.id)}>
            Export Sheet
          </button>
        </header>

        <div className="arr-workflow-steps">
          {WORKFLOW_STEPS.map((step, index) => (
            <div className="arr-workflow-step" key={step}>
              <span className="arr-workflow-step__num">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>

        {error ? <div className="page-error">{error}</div> : null}
        {loading ? <div className="page-loading">Loading relabeling batches...</div> : null}

        <section className="arr-card">
          <div className="arr-section-title">
            <h2>1. Upload Return File</h2>
            <span>Excel or CSV from agent</span>
          </div>
          <div className="arr-upload-grid">
            <input className="arr-input" placeholder="Batch title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select className="arr-input" value={marketplace} onChange={(e) => setMarketplace(e.target.value as MarketplaceCode)}>
              <option value="KSA">KSA</option>
              <option value="UAE">UAE</option>
            </select>
            <input className="arr-input" placeholder="Agent name" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
            <input className="arr-input" placeholder="Shipping to" value={shippingTo} onChange={(e) => setShippingTo(e.target.value)} />
            <input ref={fileRef} className="arr-input" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void handleUpload()}>
              {busy ? 'Working...' : 'Upload & Parse'}
            </button>
          </div>
          <div className="arr-batch-list">
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                className={`arr-batch-pill ${detail?.batch.id === batch.id ? 'arr-batch-pill--active' : ''}`}
                onClick={() => void selectBatch(batch.id)}
              >
                <strong>{batch.title}</strong>
                <span>{batch.marketplace} · {batch.totalSkus} SKUs · {batch.totalQtyReceived} returned qty</span>
              </button>
            ))}
          </div>
        </section>

        {detail ? (
          <>
            <section className="arr-card">
              <div className="arr-section-title">
                <h2>Batch Summary</h2>
                <span>{detail.batch.title}</span>
              </div>
              <div className="arr-summary-grid">
                <div className="arr-summary-card"><strong>{detail.summary.totalReturnedSkus}</strong><span>Returned SKUs</span></div>
                <div className="arr-summary-card"><strong>{detail.summary.totalReturnedQty}</strong><span>Returned Qty</span></div>
                <div className="arr-summary-card"><strong>{detail.summary.totalOldStockQty}</strong><span>Old Stock Qty</span></div>
                <div className="arr-summary-card"><strong>{detail.summary.totalAvailableQty}</strong><span>Total Available</span></div>
              </div>
            </section>

            <section className="arr-card">
              <div className="arr-section-title">
                <h2>2. Review Returned Stock</h2>
                <span>{detail.returnedStock.length} rows with received quantity</span>
              </div>
              <div className="arr-table-wrap">
                <table className="arr-table arr-table--compact">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Original SKU</th>
                      <th>Removal Order ID</th>
                      <th>Qty Received</th>
                      <th>Date Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.returnedStock.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.workingSku}</strong></td>
                        <td>{row.originalSku}</td>
                        <td>{row.removalOrderId || '-'}</td>
                        <td>{row.qtyReceived ?? '-'}</td>
                        <td>{row.receivingDate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="arr-card">
              <div className="arr-section-title">
                <h2>3. Review Old Stock With Agent</h2>
                <span>{detail.oldStockItems.length} rows</span>
              </div>
              {detail.oldStockItems.length ? (
                <div className="arr-table-wrap">
                  <table className="arr-table arr-table--compact">
                    <thead>
                      <tr><th>SKU</th><th>Old Stock Qty</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {detail.oldStockItems.map((row) => (
                        <tr key={row.id}>
                          <td>{row.workingSku}</td>
                          <td>{row.qtyReceived ?? '-'}</td>
                          <td>{row.adminNotes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <span className="arr-muted">No old stock section found in this batch.</span>}
            </section>

            <section className="arr-card">
              <div className="arr-section-title">
                <h2>4. Combined Available Stock</h2>
                <span>Returned + Old Stock merged by working SKU</span>
              </div>
              <div className="arr-table-wrap">
                <table className="arr-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Returned Qty</th>
                      <th>Old Stock Qty</th>
                      <th>Total Available Qty</th>
                      <th>Source Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.combinedStock.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.workingSku}</strong></td>
                        <td>{row.returnedQty}</td>
                        <td>{row.oldStockQty}</td>
                        <td><strong>{row.totalAvailableQty}</strong></td>
                        <td className="arr-muted">
                          {row.returnedQty > 0 ? `Returned ${row.returnedQty}` : ''}
                          {row.returnedQty > 0 && row.oldStockQty > 0 ? ' + ' : ''}
                          {row.oldStockQty > 0 ? `Old Stock ${row.oldStockQty}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="arr-card">
              <div className="arr-section-title">
                <h2>5. Upload FNSKU Labels</h2>
                <span>One label per combined SKU</span>
              </div>
              <div className="arr-table-wrap">
                <table className="arr-table arr-table--wide">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Returned</th>
                      <th>Old Stock</th>
                      <th>Total</th>
                      <th>FNSKU Label</th>
                      <th>Processing Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.combinedStock.map((row) => (
                      <CombinedRow
                        key={row.id}
                        row={row}
                        onUpdate={updateCombined}
                        onUploadLabel={uploadLabel}
                        onDeleteLabel={deleteLabel}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="arr-card arr-warning-card">
              <div className="arr-section-title">
                <h2>6. Share Agent Link</h2>
                <span>Public link is active</span>
              </div>
              <p className="arr-muted">Share this secure link with the agent to download labels and update processing status.</p>
              <div className="arr-link-row">
                <input className="arr-input" value={publicUrl} readOnly />
                <button className="btn btn--ghost" type="button" onClick={() => void copyText(publicUrl).then((ok) => setCopied(ok))}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button className="btn btn--danger" type="button" disabled={busy} onClick={() => void regenerate()}>
                  Regenerate
                </button>
              </div>
            </section>

            {detail.ignoredRows.length ? (
              <section className="arr-card arr-collapsible">
                <button className="arr-collapsible__toggle" type="button" onClick={() => setShowIgnored((v) => !v)}>
                  Rows ignored because received quantity was blank ({detail.ignoredRows.length})
                </button>
                {showIgnored ? (
                  <div className="arr-table-wrap">
                    <table className="arr-table arr-table--compact">
                      <thead>
                        <tr><th>Working SKU</th><th>Original SKU</th><th>Alternative SKU</th><th>Removal Order</th></tr>
                      </thead>
                      <tbody>
                        {detail.ignoredRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.workingSku}</td>
                            <td>{row.originalSku}</td>
                            <td>{row.alternativeSku || '-'}</td>
                            <td>{row.removalOrderId || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

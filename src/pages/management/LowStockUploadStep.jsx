import { useCallback, useRef, useState } from 'react'
import { api } from '../../api/client'
import { PP_REQUEST_OPTS, getPendingLowStock } from './purchasePlanningUtils'
import { Badge } from './PurchasePlanningBadges'
import { UnmatchedLowStockTable } from './UnmatchedLowStockTable'

export function LowStockUploadStep({ lowStock, loading, onUploaded, hasVigil, onRemoveUnmatched, removingLowStockId }) {
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedSummary, setSavedSummary] = useState(null)

  const pending = getPendingLowStock(lowStock)
  const matched = pending.filter((item) => String(item.zohoItemId || '').trim())
  const unmatched = pending.filter((item) => !String(item.zohoItemId || '').trim())

  const submit = useCallback(
    async (save) => {
      if (!file) return
      if (save) {
        const existingPending = lowStock.filter((i) => i.status === 'pending' || i.status === 'planned').length
        if (existingPending > 0) {
          const ok = window.confirm(
            'Re-uploading low-stock SKUs will mark all current pending and planned rows as ignored and start a new batch.\n\nContinue?'
          )
          if (!ok) return
        }
      }
      setBusy(true)
      setError('')
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('save', save ? 'true' : 'false')
        const path = save
          ? '/api/purchase-planning/low-stock-upload?save=true'
          : '/api/purchase-planning/low-stock-upload'
        const res = await api.postForm(path, form, PP_REQUEST_OPTS)
        setPreview(res.preview)
        if (res.saved) {
          const uploaded = Number(res.summary?.uploaded ?? 0)
          setSavedSummary({
            uploaded,
            matched: Number(res.summary?.matched ?? 0),
            unmatched: Number(res.summary?.unmatched ?? 0),
            enrichmentQueued: Boolean(res.enrichmentQueued),
          })
          setFile(null)
          setPreview(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
          await onUploaded(res)
        }
      } catch (err) {
        setError(err.message || (save ? 'Save failed' : 'Preview failed'))
        if (err.body?.preview) setPreview(err.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file, lowStock, onUploaded]
  )

  if (!hasVigil) {
    return (
      <p className="pp-hint pp-hint--warn">Upload Vigil wholesale stock in Step 1 before uploading low-stock SKUs.</p>
    )
  }

  return (
    <div className="pp-step-content">
      <div className="pp-upload-card">
        <p className="pp-hint">
          Upload CSV or Excel with SKUs in the first column or a column named SKU. Saving creates <strong>pending</strong>{' '}
          rows for Zoho enrichment in Step 3.
        </p>
        <div className="pp-reupload-warning">
          <strong>Re-upload warning:</strong> A new file marks existing pending and planned low-stock rows as{' '}
          <em>ignored</em> and starts a fresh batch.
        </div>
        <div className="pp-upload-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null)
              setPreview(null)
              setError('')
            }}
          />
          <button type="button" className="btn" disabled={!file || busy} onClick={() => submit(false)}>
            Preview
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!file || busy || (preview && preview.summary.invalidRows > 0)}
            onClick={() => submit(true)}
          >
            Save low-stock SKUs
          </button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {preview && (
        <div className="pp-preview">
          <div className="pp-preview__meta">
            <Badge tone={preview.summary.invalidRows ? 'danger' : 'success'}>
              {preview.summary.validRows} valid / {preview.summary.invalidRows} invalid
            </Badge>
            <span>SKU column: {preview.summary.skuHeader || 'first column'}</span>
          </div>
          <div className="doc-table-wrap">
            <table className="doc-table pp-preview-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 12).map((row) => (
                  <tr key={row.rowNumber} className={!row.valid ? 'pp-row--invalid' : ''}>
                    <td>{row.rowNumber}</td>
                    <td>{row.sku || '—'}</td>
                    <td>
                      {row.valid ? (
                        <Badge tone="success">Valid</Badge>
                      ) : (
                        <Badge tone="danger">{row.errors.join(', ')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(savedSummary || pending.length > 0) && (
        <div className="pp-summary-card">
          <h3>Current low-stock batch</h3>
          {loading ? (
            <p>Loading…</p>
          ) : (
            <dl className="pp-dl">
              <div>
                <dt>Pending SKUs</dt>
                <dd>{pending.length}</dd>
              </div>
              <div>
                <dt>Matched to Zoho</dt>
                <dd>{matched.length}</dd>
              </div>
              <div>
                <dt>Unmatched</dt>
                <dd>{unmatched.length}</dd>
              </div>
              <div>
                <dt>Pending enrichment</dt>
                <dd>{unmatched.length > 0 ? unmatched.length : 'Complete'}</dd>
              </div>
            </dl>
          )}
          {savedSummary?.enrichmentQueued && (
            <p className="pp-hint">Background Zoho enrichment started after last save.</p>
          )}
        </div>
      )}

      {unmatched.length > 0 && !loading && onRemoveUnmatched && (
        <UnmatchedLowStockTable items={unmatched} onRemove={onRemoveUnmatched} removingId={removingLowStockId} />
      )}
    </div>
  )
}

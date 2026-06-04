import { useCallback, useState } from 'react'
import { api } from '../../api/client'
import { PP_REQUEST_OPTS, fmt, formatUploadDate, getLatestVigilUpload } from './purchasePlanningUtils'
import { Badge } from './PurchasePlanningBadges'

export function VigilUploadStep({ uploads, onUploaded, status }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replaceMode, setReplaceMode] = useState(false)
  const latest = getLatestVigilUpload(uploads)
  const hasSaved = Boolean(latest)

  const submit = useCallback(
    async (save) => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('save', save ? 'true' : 'false')
        const res = await api.postForm('/api/purchase-planning/vigil-upload', form, PP_REQUEST_OPTS)
        setPreview(res.preview)
        if (res.saved) {
          setFile(null)
          setPreview(null)
          setReplaceMode(false)
          await onUploaded()
        }
      } catch (err) {
        setError(err.message || 'Upload failed')
        if (err.body?.preview) setPreview(err.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file, onUploaded]
  )

  const canSave = preview && preview.summary.invalidRows === 0

  return (
    <div className="pp-step-content">
      {hasSaved && !replaceMode && (
        <div className="pp-summary-card">
          <h3>Latest Vigil upload</h3>
          <dl className="pp-dl">
            <div>
              <dt>File</dt>
              <dd>{latest.fileName}</dd>
            </div>
            <div>
              <dt>Uploaded</dt>
              <dd>{formatUploadDate(latest.uploadedAt)}</dd>
            </div>
            <div>
              <dt>Total rows</dt>
              <dd>{latest.rowsCount}</dd>
            </div>
            <div>
              <dt>Valid rows</dt>
              <dd>{latest.validRows ?? latest.rowsCount}</dd>
            </div>
          </dl>
          <p className="pp-hint">
            Vigil wholesale stock caps final order quantities. Item code + available quantity columns are required.
          </p>
          <button type="button" className="btn" onClick={() => setReplaceMode(true)}>
            Replace Vigil stock
          </button>
        </div>
      )}

      {(replaceMode || !hasSaved) && (
        <div className="pp-upload-card">
          <p className="pp-hint">
            Upload a CSV or Excel file with <strong>item code</strong> and <strong>available wholesale quantity</strong>.
            Preview validates headers and rows before save.
          </p>
          <div className="pp-upload-actions">
            <input
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null)
                setPreview(null)
                setError('')
              }}
            />
            <button type="button" className="btn" disabled={!file || busy} onClick={() => submit(false)}>
              {busy && !preview ? 'Previewing…' : 'Preview'}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!file || busy || !canSave}
              onClick={() => submit(true)}
            >
              Save Vigil upload
            </button>
            {hasSaved && replaceMode && (
              <button type="button" className="btn btn--ghost" onClick={() => setReplaceMode(false)}>
                Cancel replace
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}
      {preview && (replaceMode || !hasSaved) && (
        <div className="pp-preview">
          <div className="pp-preview__meta">
            <Badge tone={preview.summary.invalidRows ? 'danger' : 'success'}>
              {preview.summary.validRows} valid / {preview.summary.invalidRows} invalid
            </Badge>
            <span>Item code: {preview.summary.itemCodeHeader || 'missing'}</span>
            <span>Stock: {preview.summary.stockHeader || 'missing'}</span>
          </div>
          <div className="doc-table-wrap">
            <table className="doc-table pp-preview-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Item code</th>
                  <th>Available stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 12).map((row) => (
                  <tr key={row.rowNumber} className={!row.valid ? 'pp-row--invalid' : ''}>
                    <td>{row.rowNumber}</td>
                    <td>{row.itemCode || '—'}</td>
                    <td>{fmt(row.availableStock)}</td>
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
          {!canSave && (
            <p className="pp-hint pp-hint--warn">Fix invalid rows before saving. Save is disabled until preview has zero invalid rows.</p>
          )}
        </div>
      )}

      {status === 'completed' && hasSaved && !replaceMode && (
        <p className="pp-step-done-hint">Vigil stock is ready. Continue to Step 2 to upload low-stock SKUs.</p>
      )}
    </div>
  )
}

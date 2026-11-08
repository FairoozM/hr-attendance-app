import { useCallback, useState } from 'react'
import { api } from '../../../api/client'
import { Badge } from './PurchasePlanningBadges'
import { UploadPreviewTable } from './UploadPreviewTable'
import { asApiError, type PurchasePlan, type StepStatus, type UploadPreview, type VigilUpload } from './purchasePlanningTypes'
import { PP_REQUEST_OPTS, fmt, formatUploadDate, getCurrentVigilUpload, getLatestVigilUpload } from './purchasePlanningUtils'

const UPLOAD_ACCEPT =
  '.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface VigilUploadStepProps {
  uploads: VigilUpload[]
  plans: PurchasePlan[]
  onUploaded: () => Promise<void> | void
  status: StepStatus
}

export function VigilUploadStep({ uploads, plans, onUploaded, status }: VigilUploadStepProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replaceMode, setReplaceMode] = useState(false)
  const latest = getCurrentVigilUpload(uploads, plans)
  const previous = latest ? null : getLatestVigilUpload(uploads)

  const submit = useCallback(
    async (save: boolean) => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('save', save ? 'true' : 'false')
        const res: { saved: boolean; preview: UploadPreview } = await api.postForm(
          '/api/purchase-planning/vigil-upload',
          form,
          PP_REQUEST_OPTS
        )
        setPreview(res.preview)
        if (res.saved) {
          setFile(null)
          setPreview(null)
          setReplaceMode(false)
          await onUploaded()
        }
      } catch (err) {
        const apiErr = asApiError(err)
        setError(apiErr.message || 'Upload failed')
        if (apiErr.body?.preview) setPreview(apiErr.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file, onUploaded]
  )

  const canSave = Boolean(preview && preview.summary.invalidRows === 0)
  const showUploader = replaceMode || !latest

  return (
    <div className="pp-step-content">
      {latest && !replaceMode && (
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
            Vigil wholesale stock caps final order quantities. New plans use the latest upload; existing drafts keep the
            upload they were built from.
          </p>
          <button type="button" className="btn" onClick={() => setReplaceMode(true)}>
            Replace Vigil stock
          </button>
        </div>
      )}

      {showUploader && (
        <div className="pp-upload-card">
          {previous && (
            <p className="pp-hint pp-hint--warn">
              Upload this cycle&apos;s Vigil stock. The previous file ({previous.fileName},{' '}
              {formatUploadDate(previous.uploadedAt)}) was used for an earlier purchase order.
            </p>
          )}
          <p className="pp-hint">
            Upload a CSV or Excel file with <strong>item code</strong> and <strong>available wholesale quantity</strong>.
            Preview validates headers and rows before save.
          </p>
          <div className="pp-upload-actions">
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
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
            {latest && replaceMode && (
              <button type="button" className="btn btn--ghost" onClick={() => setReplaceMode(false)}>
                Cancel replace
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}
      {preview && showUploader && (
        <UploadPreviewTable
          preview={preview}
          meta={
            <>
              <span>Item code: {preview.summary.itemCodeHeader || 'missing'}</span>
              <span>Stock: {preview.summary.stockHeader || 'missing'}</span>
            </>
          }
          columns={[
            { label: 'Item code', render: (row) => row.itemCode || '—' },
            { label: 'Available stock', render: (row) => fmt(row.availableStock) },
          ]}
          footer={
            !canSave ? (
              <p className="pp-hint pp-hint--warn">
                Fix invalid rows before saving. Save is disabled until preview has zero invalid rows.
              </p>
            ) : null
          }
        />
      )}

      {status === 'completed' && latest && !replaceMode && (
        <p className="pp-step-done-hint">
          <Badge tone="success">Ready</Badge> Vigil stock is in place. Continue to Step 2 to upload low-stock SKUs.
        </p>
      )}
    </div>
  )
}

import { useCallback, useRef, useState } from 'react'
import { api } from '../../../api/client'
import { UnmatchedLowStockTable } from './UnmatchedLowStockTable'
import { UploadPreviewTable } from './UploadPreviewTable'
import type { ConfirmOptions } from './useConfirmDialog'
import { asApiError, type LowStockItem, type LowStockUploadResponse, type UploadPreview } from './purchasePlanningTypes'
import { PP_REQUEST_OPTS, getPendingLowStock } from './purchasePlanningUtils'

const UPLOAD_ACCEPT =
  '.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface SavedSummary {
  uploaded: number
  matched: number
  unmatched: number
  enrichmentQueued: boolean
}

interface LowStockUploadStepProps {
  lowStock: LowStockItem[]
  loading: boolean
  onUploaded: (res: LowStockUploadResponse) => Promise<void> | void
  hasVigil: boolean
  hasOpenDraft?: boolean
  onRemoveUnmatched: (item: LowStockItem) => void
  removingLowStockId: number | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export function LowStockUploadStep({
  lowStock,
  loading,
  onUploaded,
  hasVigil,
  hasOpenDraft = false,
  onRemoveUnmatched,
  removingLowStockId,
  confirm,
}: LowStockUploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null)

  const pending = getPendingLowStock(lowStock)
  const matched = pending.filter((item) => String(item.zohoItemId || '').trim())
  const unmatched = pending.filter((item) => !String(item.zohoItemId || '').trim())

  const submit = useCallback(
    async (save: boolean) => {
      if (!file) return
      if (save && (pending.length > 0 || hasOpenDraft)) {
        const ok = await confirm({
          title: 'Replace the low-stock batch?',
          message: 'A new file replaces the current low-stock batch.',
          details: [
            'SKUs that are not in the new file are marked as ignored.',
            'An existing draft plan stays until you delete it.',
          ],
          confirmLabel: 'Replace batch',
        })
        if (!ok) return
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
        const res: LowStockUploadResponse = await api.postForm(path, form, PP_REQUEST_OPTS)
        setPreview(res.preview)
        if (res.saved) {
          setSavedSummary({
            uploaded: Number(res.summary?.uploaded ?? 0),
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
        const apiErr = asApiError(err)
        setError(apiErr.message || (save ? 'Save failed' : 'Preview failed'))
        if (apiErr.body?.preview) setPreview(apiErr.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file, pending.length, hasOpenDraft, onUploaded, confirm]
  )

  if (!hasVigil && pending.length === 0) {
    return (
      <p className="pp-hint pp-hint--warn">
        Upload this cycle&apos;s Vigil wholesale stock in Step 1 before uploading low-stock SKUs.
      </p>
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
            accept={UPLOAD_ACCEPT}
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
            disabled={!file || busy || Boolean(preview && preview.summary.invalidRows > 0)}
            onClick={() => submit(true)}
          >
            Save low-stock SKUs
          </button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {preview && (
        <UploadPreviewTable
          preview={preview}
          meta={<span>SKU column: {preview.summary.skuHeader || 'first column'}</span>}
          columns={[{ label: 'SKU', render: (row) => row.sku || '—' }]}
        />
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

      {unmatched.length > 0 && !loading && (
        <UnmatchedLowStockTable items={unmatched} onRemove={onRemoveUnmatched} removingId={removingLowStockId} />
      )}
    </div>
  )
}

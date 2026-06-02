import { useCallback, useState } from 'react'
import {
  previewVigilStockFile,
  type VigilParsedRow,
  type VigilPreviewResponse,
} from '../../../api/amazonOutOfStockClearance'

interface VigilUploadPanelProps {
  onConfirmed: (rows: VigilParsedRow[]) => void
}

export function VigilUploadPanel({ onConfirmed }: VigilUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<VigilPreviewResponse['preview'] | null>(null)
  const [needsMapping, setNeedsMapping] = useState(false)
  const [itemCodeHeader, setItemCodeHeader] = useState('')
  const [stockHeader, setStockHeader] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const runPreview = useCallback(
    async (mapping?: { itemCodeHeader?: string; stockHeader?: string }) => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        const res = await previewVigilStockFile(file, mapping)
        setPreview(res.preview)
        setNeedsMapping(Boolean(res.needsColumnMapping))
        if (res.preview.summary.itemCodeHeader) setItemCodeHeader(res.preview.summary.itemCodeHeader)
        if (res.preview.summary.stockHeader) setStockHeader(res.preview.summary.stockHeader)
        if (res.needsColumnMapping && !mapping) {
          setError(res.message || 'Confirm column mapping before using this file.')
        }
      } catch (e) {
        const err = e as Error & { body?: { preview?: VigilPreviewResponse['preview'] } }
        setError(err.message || 'Upload failed')
        if (err.body?.preview) setPreview(err.body.preview)
      } finally {
        setBusy(false)
      }
    },
    [file]
  )

  const confirmRows = useCallback(() => {
    if (!preview) return
    const valid = preview.rows.filter((r) => r.valid)
    onConfirmed(
      valid.map((r) => ({
        itemCode: r.itemCode,
        itemName: r.itemName,
        normalizedItemCode: r.itemCode,
        availableStock: r.availableStock,
        valid: true,
      }))
    )
  }, [preview, onConfirmed])

  const headers = preview?.availableHeaders || preview?.headers || []

  return (
    <section className="ainv-panel">
      <h2 className="ainv-section-title">Vigil wholesale stock upload</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Upload Excel or CSV. Preview and confirm column mapping before calculation.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xls,.xlsx,text/csv"
          className="text-sm"
          style={{ color: 'var(--text-soft)' }}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setPreview(null)
            setError('')
            setNeedsMapping(false)
          }}
        />
        <button
          type="button"
          className="ainv-btn"
          disabled={!file || busy}
          onClick={() => void runPreview()}
        >
          {busy ? 'Parsing…' : 'Preview file'}
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--primary-emerald"
          disabled={!preview || busy || preview.summary.validRows === 0 || (needsMapping && (!itemCodeHeader || !stockHeader))}
          onClick={confirmRows}
        >
          Confirm Vigil data
        </button>
      </div>
      {error && <p className="ainv-banner ainv-banner--amber mt-3">{error}</p>}
      {needsMapping && headers.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="ainv-label">
            Item code column
            <select
              className="ainv-input"
              value={itemCodeHeader}
              onChange={(e) => setItemCodeHeader(e.target.value)}
            >
              <option value="">Select column</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="ainv-label">
            Stock quantity column
            <select
              className="ainv-input"
              value={stockHeader}
              onChange={(e) => setStockHeader(e.target.value)}
            >
              <option value="">Select column</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ainv-btn ainv-btn--amber md:col-span-2"
            disabled={!itemCodeHeader || !stockHeader || busy}
            onClick={() =>
              void runPreview({ itemCodeHeader, stockHeader })
            }
          >
            Apply column mapping and re-preview
          </button>
        </div>
      )}
      {preview && (
        <div className="ainv-table-wrap mt-4" style={{ maxHeight: 'none' }}>
          <p className="px-4 py-2 text-xs ainv-table__muted" style={{ borderBottom: '1px solid var(--theme-border)' }}>
            {preview.summary.validRows} valid / {preview.summary.invalidRows} invalid — Item:{' '}
            {preview.summary.itemCodeHeader || '—'} · Stock: {preview.summary.stockHeader || '—'}
          </p>
          <table className="ainv-table">
            <thead>
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Item code</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 10).map((row) => (
                <tr key={row.rowNumber}>
                  <td className="px-3 py-2">{row.rowNumber}</td>
                  <td className="px-3 py-2">{row.itemCode || '—'}</td>
                  <td className="px-3 py-2">{row.availableStock}</td>
                  <td className="px-3 py-2">{row.valid ? 'Valid' : row.errors.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

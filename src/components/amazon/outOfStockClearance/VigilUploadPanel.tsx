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
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
      <h2 className="text-lg font-semibold text-white">Vigil wholesale stock upload</h2>
      <p className="mt-1 text-sm text-slate-400">
        Upload Excel or CSV. Preview and confirm column mapping before calculation.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xls,.xlsx,text/csv"
          className="text-sm text-slate-300"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setPreview(null)
            setError('')
            setNeedsMapping(false)
          }}
        />
        <button
          type="button"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50"
          disabled={!file || busy}
          onClick={() => void runPreview()}
        >
          {busy ? 'Parsing…' : 'Preview file'}
        </button>
        <button
          type="button"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={!preview || busy || preview.summary.validRows === 0 || (needsMapping && (!itemCodeHeader || !stockHeader))}
          onClick={confirmRows}
        >
          Confirm Vigil data
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-amber-200">{error}</p>}
      {needsMapping && headers.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-400">
            Item code column
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
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
          <label className="text-sm text-slate-400">
            Stock quantity column
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100"
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
            className="md:col-span-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
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
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <p className="border-b border-white/10 px-4 py-2 text-xs text-slate-400">
            {preview.summary.validRows} valid / {preview.summary.invalidRows} invalid — Item:{' '}
            {preview.summary.itemCodeHeader || '—'} · Stock: {preview.summary.stockHeader || '—'}
          </p>
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="bg-white/5 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Item code</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 10).map((row) => (
                <tr key={row.rowNumber} className="border-t border-white/5">
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

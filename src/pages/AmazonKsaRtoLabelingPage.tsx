import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  createKsaRtoLabelBatch,
  deleteKsaRtoLabelBatch,
  deleteKsaRtoLabelRowFile,
  getKsaRtoLabelBatch,
  listKsaRtoLabelBatches,
  parseKsaRtoLabelFile,
  updateKsaRtoLabelBatch,
  uploadKsaRtoLabelRowFile,
  uploadKsaRtoLabelRowFileJson,
  type KsaRtoBatchPayload,
  type KsaRtoLabelBatch,
  type KsaRtoLabelFile,
  type KsaRtoLabelRow,
  type KsaRtoRowStatus,
} from '../api/amazonKsaRtoLabeling'
import { downloadBlob } from '../api/client'
import '../styles/amazonInventoryPage.css'
import './AmazonKsaRtoLabelingPage.css'

const DEFAULT_TITLE = 'Amazon KSA RTO - LIFESMILE'
const DEFAULT_DESTINATION = 'Wanasa-Lifesmile'

type DraftRow = KsaRtoLabelRow & { id: string | number }
type RowFileKind = 'product_image' | 'fnsku_label_pdf'

interface BatchMeta {
  batchTitle: string
  referenceNo: string
  agentName: string
  destination: string
  notes: string
}

function newRow(): DraftRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productCode: '',
    fnskuNo: '',
    quantity: 1,
    notes: '',
    status: 'Missing Product Code',
    productImage: null,
    labelPdf: null,
  }
}

function rowStatus(row: Pick<KsaRtoLabelRow, 'productCode' | 'fnskuNo' | 'quantity' | 'productImage' | 'labelPdf'>): KsaRtoRowStatus {
  if (!String(row.productCode || '').trim()) return 'Missing Product Code'
  if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) return 'Invalid Qty'
  if (!String(row.fnskuNo || '').trim()) return 'Missing FNSKU'
  if (!row.productImage) return 'Missing Image'
  if (!row.labelPdf) return 'Missing PDF'
  return 'Ready'
}

function normalizeRow(row: Partial<KsaRtoLabelRow>, index = 0): DraftRow {
  const quantity = Number(String(row.quantity ?? '').replace(/,/g, '').trim())
  const draft: DraftRow = {
    id: row.id ?? `parsed-${Date.now()}-${index}`,
    productCode: String(row.productCode ?? '').trim(),
    fnskuNo: String(row.fnskuNo ?? '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    notes: String(row.notes ?? '').trim(),
    productImage: row.productImage || null,
    labelPdf: row.labelPdf || null,
    files: row.files || [],
  }
  return { ...draft, status: rowStatus(draft) }
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatSize(bytes?: number) {
  const size = Number(bytes || 0)
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function parsePastedRows(text: string): DraftRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return []
  const firstCells = lines[0].split(/\t|,/).map((cell) => cell.trim().toLowerCase())
  const hasHeader = firstCells.some((cell) => /product|sku|code|fnsku|qty|quantity|notes/.test(cell))
  const dataLines = hasHeader ? lines.slice(1) : lines
  return dataLines
    .map((line, index) => {
      const cells = line.includes('\t') ? line.split('\t') : line.split(',')
      return normalizeRow(
        {
          productCode: cells[0],
          fnskuNo: cells[1],
          quantity: cells[2],
          notes: cells.slice(3).join(' '),
        },
        index
      )
    })
    .filter((row) => row.productCode || row.fnskuNo || row.quantity)
}

function statusClass(status: KsaRtoRowStatus) {
  return status.toLowerCase().replace(/\s+/g, '-')
}

function imageDataUrl(file: KsaRtoLabelFile | null | undefined) {
  return file?.downloadUrl || ''
}

function buildPrintableHtml(meta: BatchMeta, rows: DraftRow[]) {
  const tableRows = rows
    .map((row, index) => {
      const image = imageDataUrl(row.productImage)
      return `
        <tr>
          <td>${image ? `<img class="thumb" src="${image}" />` : '<span class="warn">Missing image</span>'}</td>
          <td>${index + 1}</td>
          <td>${row.productCode}</td>
          <td>${row.fnskuNo || '<span class="warn">Missing FNSKU</span>'}</td>
          <td>${row.quantity}</td>
          <td>${row.labelPdf?.fileName || '<span class="warn">Missing PDF</span>'}</td>
        </tr>`
    })
    .join('')
  return `<!doctype html>
    <html>
      <head>
        <title>${meta.batchTitle || DEFAULT_TITLE}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
          h1 { font-size: 26px; margin: 0 0 8px; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 12px 0 18px; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #111827; padding: 10px; font-size: 13px; text-align: left; vertical-align: middle; }
          th { background: #f3f4f6; }
          .thumb { width: 72px; height: 72px; object-fit: contain; display: block; }
          .total { margin-top: 16px; font-weight: 700; }
          .warn { color: #92400e; font-weight: 700; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${meta.batchTitle || DEFAULT_TITLE}</h1>
        <div class="meta">
          <div><strong>Reference:</strong> ${meta.referenceNo || '-'}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
          <div><strong>Agent:</strong> ${meta.agentName || '-'}</div>
          <div><strong>Destination:</strong> ${meta.destination || DEFAULT_DESTINATION}</div>
        </div>
        <table>
          <thead>
            <tr><th>Product Image</th><th>Sr.</th><th>Product name / code</th><th>FNSKU No</th><th>Quantity</th><th>FNSKU Label PDF</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="total">Total quantity: ${rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)}</div>
        ${meta.notes ? `<p><strong>Notes:</strong> ${meta.notes}</p>` : ''}
      </body>
    </html>`
}

export function AmazonKsaRtoLabelingPage() {
  const [meta, setMeta] = useState<BatchMeta>({
    batchTitle: DEFAULT_TITLE,
    referenceNo: '',
    agentName: '',
    destination: DEFAULT_DESTINATION,
    notes: '',
  })
  const [rows, setRows] = useState<DraftRow[]>([newRow()])
  const [batches, setBatches] = useState<KsaRtoLabelBatch[]>([])
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const dataInputRef = useRef<HTMLInputElement | null>(null)

  const summary = useMemo(() => {
    const statuses = rows.map(rowStatus)
    return {
      totalLines: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + (Number(row.quantity) > 0 ? Number(row.quantity) : 0), 0),
      ready: statuses.filter((status) => status === 'Ready').length,
      missingFnsku: statuses.filter((status) => status === 'Missing FNSKU').length,
      missingImage: statuses.filter((status) => status === 'Missing Image').length,
      missingPdf: statuses.filter((status) => status === 'Missing PDF').length,
      invalidRows: statuses.filter((status) => status === 'Missing Product Code' || status === 'Invalid Qty').length,
    }
  }, [rows])

  const refreshBatches = useCallback(async () => {
    const result = await listKsaRtoLabelBatches({ search })
    setBatches(result.batches)
  }, [search])

  useEffect(() => {
    void refreshBatches().catch((err) => setError(err.message || 'Could not load batch history.'))
  }, [refreshBatches])

  function resetDraft() {
    setActiveBatchId(null)
    setMeta({ batchTitle: DEFAULT_TITLE, referenceNo: '', agentName: '', destination: DEFAULT_DESTINATION, notes: '' })
    setRows([newRow()])
    setPasteText('')
    setMessage('')
    setError('')
  }

  function updateRow(id: DraftRow['id'], patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, ...patch }
        return { ...next, status: rowStatus(next) }
      })
    )
  }

  function replaceServerRow(row: KsaRtoLabelRow | null | undefined) {
    if (!row?.id) return
    setRows((prev) => prev.map((item) => (String(item.id) === String(row.id) ? normalizeRow(row) : item)))
  }

  function appendRows(nextRows: DraftRow[]) {
    if (!nextRows.length) {
      setError('No usable rows found.')
      return
    }
    setRows((prev) => {
      const shouldReplaceBlank =
        prev.length === 1 && !prev[0].productCode.trim() && !prev[0].fnskuNo.trim() && Number(prev[0].quantity) === 1
      return shouldReplaceBlank ? nextRows : [...prev, ...nextRows]
    })
    setMessage(`${nextRows.length} row(s) added. Upload product images and FNSKU PDFs per row after saving.`)
    setError('')
  }

  function payload(): KsaRtoBatchPayload {
    return {
      ...meta,
      rows: rows.map((row) => ({
        id: typeof row.id === 'number' ? row.id : undefined,
        productCode: row.productCode.trim(),
        fnskuNo: row.fnskuNo.trim(),
        quantity: Number(row.quantity),
        notes: row.notes || '',
      })),
    }
  }

  async function saveBatch() {
    setBusy('save')
    setError('')
    try {
      const invalid = rows.filter((row) => ['Missing Product Code', 'Invalid Qty'].includes(rowStatus(row)))
      if (invalid.length) throw new Error('Product code and positive quantity are required before saving.')
      const result = activeBatchId
        ? await updateKsaRtoLabelBatch(activeBatchId, payload())
        : await createKsaRtoLabelBatch(payload())
      setActiveBatchId(result.batch.id)
      setRows((result.batch.rows || []).map((row, index) => normalizeRow(row, index)))
      setMessage(activeBatchId ? 'Batch updated.' : 'Batch saved. You can now upload images and PDFs per SKU row.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save batch.')
    } finally {
      setBusy('')
    }
  }

  async function saveDraftForUpload() {
    const invalid = rows.filter((row) => ['Missing Product Code', 'Invalid Qty'].includes(rowStatus(row)))
    if (invalid.length) throw new Error('Product code and positive quantity are required before uploading files.')
    const result = activeBatchId
      ? await updateKsaRtoLabelBatch(activeBatchId, payload())
      : await createKsaRtoLabelBatch(payload())
    const nextRows = (result.batch.rows || []).map((row, index) => normalizeRow(row, index))
    setActiveBatchId(result.batch.id)
    setRows(nextRows)
    await refreshBatches()
    return { batchId: result.batch.id, rows: nextRows }
  }

  async function openBatch(id: number) {
    setBusy(`open-${id}`)
    setError('')
    try {
      const result = await getKsaRtoLabelBatch(id)
      const batch = result.batch
      setActiveBatchId(batch.id)
      setMeta({
        batchTitle: batch.batchTitle || DEFAULT_TITLE,
        referenceNo: batch.referenceNo || '',
        agentName: batch.agentName || '',
        destination: batch.destination || DEFAULT_DESTINATION,
        notes: batch.notes || '',
      })
      setRows((batch.rows || []).map((row, index) => normalizeRow(row, index)))
      setMessage(`Opened batch #${batch.id}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open batch.')
    } finally {
      setBusy('')
    }
  }

  async function removeBatch(id: number) {
    if (!window.confirm('Delete this batch, rows, and uploaded SKU files?')) return
    setBusy(`delete-batch-${id}`)
    try {
      await deleteKsaRtoLabelBatch(id)
      if (activeBatchId === id) resetDraft()
      await refreshBatches()
      setMessage('Batch deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete batch.')
    } finally {
      setBusy('')
    }
  }

  async function uploadRowFile(row: DraftRow, rowIndex: number, fileType: RowFileKind, file: File) {
    const key = `${fileType}-${row.id}`
    setBusy(key)
    setError('')
    try {
      let batchId = activeBatchId
      let targetRow = row
      if (!batchId || typeof targetRow.id !== 'number') {
        const saved = await saveDraftForUpload()
        batchId = saved.batchId
        targetRow = saved.rows[rowIndex]
      }
      if (!batchId || typeof targetRow?.id !== 'number') throw new Error('Could not prepare this SKU row for upload.')
      let result: { file: KsaRtoLabelFile; row: KsaRtoLabelRow }
      try {
        result = await uploadKsaRtoLabelRowFile(batchId, targetRow.id, fileType, file)
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (!/non-JSON|Got HTML|not reaching your Express API|HTTP 403/i.test(message)) throw err
        result = await uploadKsaRtoLabelRowFileJson(batchId, targetRow.id, fileType, file)
      }
      replaceServerRow(result.row)
      setMessage(fileType === 'product_image' ? 'Product image uploaded.' : 'FNSKU label PDF uploaded.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload row file.')
    } finally {
      setBusy('')
    }
  }

  async function removeRowFile(file: KsaRtoLabelFile) {
    if (!window.confirm(`Remove ${file.fileName}?`)) return
    setBusy(`row-file-${file.id}`)
    try {
      const result = await deleteKsaRtoLabelRowFile(file.id)
      replaceServerRow(result.row)
      setMessage('Row file removed.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove row file.')
    } finally {
      setBusy('')
    }
  }

  async function parseUpload(file: File) {
    setBusy('parse')
    try {
      const result = await parseKsaRtoLabelFile(file)
      appendRows((result.rows || []).map((row, index) => normalizeRow(row, index)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse uploaded file.')
    } finally {
      setBusy('')
      if (dataInputRef.current) dataInputRef.current.value = ''
    }
  }

  function exportCsv() {
    const headers = [
      'product_code',
      'fnsku_no',
      'quantity',
      'image_file_name',
      'image_url',
      'label_pdf_file_name',
      'label_pdf_url',
      'status',
      'notes',
    ]
    const lines = [
      headers.map(csvEscape).join(','),
      ...rows.map((row) =>
        [
          row.productCode,
          row.fnskuNo,
          row.quantity,
          row.productImage?.fileName || '',
          row.productImage?.fileUrl || row.productImage?.downloadUrl || '',
          row.labelPdf?.fileName || '',
          row.labelPdf?.fileUrl || row.labelPdf?.downloadUrl || '',
          rowStatus(row),
          row.notes || '',
        ].map(csvEscape).join(',')
      ),
    ]
    downloadBlob(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), 'amazon-ksa-rto-labeling.csv')
  }

  function exportXlsx() {
    const worksheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        product_code: row.productCode,
        fnsku_no: row.fnskuNo,
        quantity: row.quantity,
        image_file_name: row.productImage?.fileName || '',
        image_url: row.productImage?.fileUrl || row.productImage?.downloadUrl || '',
        label_pdf_file_name: row.labelPdf?.fileName || '',
        label_pdf_url: row.labelPdf?.fileUrl || row.labelPdf?.downloadUrl || '',
        status: rowStatus(row),
        notes: row.notes || '',
      }))
    )
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'KSA RTO Labeling')
    XLSX.writeFile(workbook, 'amazon-ksa-rto-labeling.xlsx')
  }

  async function imageForPdf(file?: KsaRtoLabelFile | null) {
    if (!file?.downloadUrl) return null
    try {
      const res = await fetch(file.downloadUrl, { cache: 'no-store' })
      const blob = await res.blob()
      return await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => resolve('')
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  async function exportPdf() {
    setBusy('pdf')
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      doc.setFontSize(18)
      doc.text(meta.batchTitle || DEFAULT_TITLE, 42, 42)
      doc.setFontSize(10)
      doc.text(`Reference: ${meta.referenceNo || '-'}   Agent: ${meta.agentName || '-'}   Destination: ${meta.destination || DEFAULT_DESTINATION}`, 42, 62)
      const imageCache = new Map<string | number, string>()
      for (const row of rows) {
        const data = await imageForPdf(row.productImage)
        if (data) imageCache.set(row.id, data)
      }
      autoTable(doc, {
        startY: 82,
        head: [['Image', 'Product name / code', 'FNSKU No', 'Qty', 'FNSKU Label PDF', 'Status']],
        body: rows.map((row) => [
          '',
          row.productCode,
          row.fnskuNo || 'Missing FNSKU',
          row.quantity,
          row.labelPdf?.fileName || 'Missing PDF',
          rowStatus(row),
        ]),
        styles: { fontSize: 9, cellPadding: 7, minCellHeight: 58 },
        headStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39] },
        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 0) return
          const row = rows[data.row.index]
          const image = imageCache.get(row.id)
          if (!image) return
          const format = image.startsWith('data:image/jpeg') ? 'JPEG' : image.startsWith('data:image/webp') ? 'WEBP' : 'PNG'
          doc.addImage(image, format, data.cell.x + 5, data.cell.y + 5, 48, 48, undefined, 'FAST')
        },
      })
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 82
      doc.text(`Total quantity: ${summary.totalQuantity}`, 42, finalY + 24)
      if (meta.notes) doc.text(`Notes: ${meta.notes}`, 42, finalY + 42, { maxWidth: 740 })
      doc.save('amazon-ksa-rto-labeling.pdf')
    } finally {
      setBusy('')
    }
  }

  function printSheet() {
    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) {
      setError('Popup blocked. Allow popups to print the sheet.')
      return
    }
    popup.document.write(buildPrintableHtml(meta, rows))
    popup.document.close()
    popup.focus()
    window.setTimeout(() => popup.print(), 500)
  }

  function duplicateRow(row: DraftRow, index: number) {
    setRows((prev) => [
      ...prev.slice(0, index + 1),
      normalizeRow({ ...row, id: `dup-${Date.now()}`, productImage: null, labelPdf: null, files: [] }),
      ...prev.slice(index + 1),
    ])
  }

  return (
    <div className="akr-page ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header akr-hero">
        <div>
          <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon · KSA RTO</p>
          <h1 className="ainv-page__title">Amazon KSA RTO Labeling / FNSKU Label Upload</h1>
          <p className="ainv-page__lead">
            Prepare per-SKU product images, FNSKU label PDFs, product codes, FNSKU numbers, and quantities for the KSA RTO agent.
          </p>
        </div>
        <div className="akr-hero__actions">
          <button type="button" className="ainv-btn" onClick={resetDraft}>New batch</button>
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy === 'save'} onClick={() => void saveBatch()}>
            {busy === 'save' ? 'Saving...' : activeBatchId ? 'Save changes' : 'Save draft'}
          </button>
        </div>
      </header>

      <section className="akr-summary-grid">
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Total SKUs / Lines</p><p className="ainv-summary-card__value">{summary.totalLines}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Total Quantity</p><p className="ainv-summary-card__value">{summary.totalQuantity}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Ready</p><p className="ainv-summary-card__value">{summary.ready}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Missing FNSKU</p><p className="ainv-summary-card__value">{summary.missingFnsku}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Missing Image</p><p className="ainv-summary-card__value">{summary.missingImage}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Missing PDF</p><p className="ainv-summary-card__value">{summary.missingPdf}</p></div>
      </section>

      {message ? <div className="ainv-banner ainv-banner--sky">{message}</div> : null}
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}
      {summary.invalidRows > 0 ? <div className="ainv-banner ainv-banner--amber">Fix {summary.invalidRows} missing product code / invalid quantity row(s) before saving.</div> : null}

      <section className="akr-grid">
        <div className="ainv-panel akr-main">
          <div className="akr-panel-head">
            <h2>Batch Details</h2>
            {activeBatchId ? <span className="akr-pill">Batch #{activeBatchId}</span> : <span className="akr-pill akr-pill--warn">Unsaved</span>}
          </div>
          <div className="akr-form-grid">
            <label className="ainv-label">Batch title<input className="ainv-input" value={meta.batchTitle} onChange={(e) => setMeta({ ...meta, batchTitle: e.target.value })} /></label>
            <label className="ainv-label">Reference no<input className="ainv-input" value={meta.referenceNo} onChange={(e) => setMeta({ ...meta, referenceNo: e.target.value })} /></label>
            <label className="ainv-label">Agent name<input className="ainv-input" value={meta.agentName} onChange={(e) => setMeta({ ...meta, agentName: e.target.value })} /></label>
            <label className="ainv-label">Destination<input className="ainv-input" value={meta.destination} onChange={(e) => setMeta({ ...meta, destination: e.target.value })} /></label>
            <label className="ainv-label akr-span-2">Notes<textarea className="ainv-input" rows={3} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></label>
          </div>
        </div>

        <aside className="ainv-panel akr-history">
          <div className="akr-panel-head">
            <h2>History</h2>
            <button type="button" className="ainv-btn" onClick={() => void refreshBatches()}>Refresh</button>
          </div>
          <input className="ainv-input" placeholder="Search product, FNSKU, reference..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="akr-history-list">
            {batches.map((batch) => (
              <article key={batch.id} className={`akr-history-card ${activeBatchId === batch.id ? 'akr-history-card--active' : ''}`}>
                <button type="button" onClick={() => void openBatch(batch.id)}>
                  <strong>{batch.batchTitle}</strong>
                  <span>{batch.referenceNo || 'No reference'} · {formatDate(batch.updatedAt)}</span>
                  <span>{batch.totalLines} lines · Qty {batch.totalQuantity} · Missing FNSKU {batch.missingFnskuCount}</span>
                </button>
                <button type="button" className="akr-danger-link" onClick={() => void removeBatch(batch.id)}>Delete</button>
              </article>
            ))}
            {!batches.length ? <p className="akr-muted">No saved batches yet.</p> : null}
          </div>
        </aside>
      </section>

      <section className="akr-grid">
        <div className="ainv-panel">
          <div className="akr-panel-head"><h2>Paste from Excel / Google Sheet</h2></div>
          <textarea className="ainv-input akr-paste" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Product name / code\tFNSKU No\tQuantity\tNotes" />
          <button type="button" className="ainv-btn ainv-btn--primary-emerald" onClick={() => appendRows(parsePastedRows(pasteText))}>Parse pasted rows</button>
        </div>
        <div className="ainv-panel">
          <div className="akr-panel-head"><h2>Upload CSV / XLSX</h2></div>
          <p className="akr-muted">Expected columns: product name / code, FNSKU no, quantity, notes optional. Optional image_url/pdf_url are accepted for future reference.</p>
          <input ref={dataInputRef} className="akr-file-input" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const file = e.target.files?.[0]; if (file) void parseUpload(file) }} />
          <button type="button" className="ainv-btn" disabled={busy === 'parse'} onClick={() => dataInputRef.current?.click()}>{busy === 'parse' ? 'Parsing...' : 'Choose file'}</button>
        </div>
      </section>

      <section className="ainv-panel">
        <div className="akr-panel-head">
          <div>
            <h2>SKU Labeling Grid</h2>
            <p className="akr-muted">Click Upload Image or Upload PDF on each SKU row. New drafts are saved automatically before upload.</p>
          </div>
          <button type="button" className="ainv-btn" onClick={() => setRows((prev) => [...prev, newRow()])}>Add row</button>
        </div>
        <div className="akr-sku-grid">
          {rows.map((row, index) => {
            const status = rowStatus(row)
            return (
              <article key={row.id} className={`akr-sku-card akr-sku-card--${statusClass(status)}`}>
                <div className="akr-sku-card__sr">#{index + 1}</div>
                <div className="akr-product-image">
                  {row.productImage?.downloadUrl ? (
                    <img src={row.productImage.downloadUrl} alt={row.productCode || 'Product'} />
                  ) : (
                    <div className="akr-image-placeholder">Missing image</div>
                  )}
                  <label className="akr-upload-chip">
                    {row.productImage ? 'Replace image' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void uploadRowFile(row, index, 'product_image', file)
                        e.currentTarget.value = ''
                      }}
                    />
                  </label>
                  {row.productImage ? <button type="button" className="akr-mini-link" onClick={() => void removeRowFile(row.productImage as KsaRtoLabelFile)}>Remove</button> : null}
                </div>

                <div className="akr-sku-fields">
                  <label className="ainv-label">Product name / code<input className="akr-cell-input" value={row.productCode} onChange={(e) => updateRow(row.id, { productCode: e.target.value })} /></label>
                  <label className="ainv-label">FNSKU No<input className="akr-cell-input" value={row.fnskuNo} placeholder="Warning only if missing" onChange={(e) => updateRow(row.id, { fnskuNo: e.target.value })} /></label>
                  <label className="ainv-label">Quantity<input className="akr-cell-input akr-qty" type="number" min={0} value={row.quantity} onChange={(e) => updateRow(row.id, { quantity: Number(e.target.value) })} /></label>
                </div>

                <div className="akr-pdf-box">
                  <p className="akr-file-label">FNSKU Label PDF</p>
                  {row.labelPdf ? (
                    <div className="akr-pdf-card">
                      <strong>{row.labelPdf.fileName}</strong>
                      <span>{formatSize(row.labelPdf.fileSize)} · {formatDate(row.labelPdf.createdAt)}</span>
                      <div className="akr-actions">
                        {row.labelPdf.downloadUrl ? <a href={row.labelPdf.downloadUrl} target="_blank" rel="noreferrer">View</a> : null}
                        {row.labelPdf.downloadUrl ? <a href={row.labelPdf.downloadUrl} download={row.labelPdf.fileName}>Download</a> : null}
                        <button type="button" onClick={() => void removeRowFile(row.labelPdf as KsaRtoLabelFile)}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div className="akr-pdf-missing">Missing PDF</div>
                  )}
                  <label className="akr-upload-chip">
                    {row.labelPdf ? 'Replace PDF' : 'Upload PDF'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void uploadRowFile(row, index, 'fnsku_label_pdf', file)
                        e.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>

                <div className="akr-status-actions">
                  <span className={`akr-status akr-status--${statusClass(status)}`}>{status}</span>
                  <div className="akr-actions">
                    <button type="button" onClick={() => duplicateRow(row, index)}>Duplicate</button>
                    <button type="button" onClick={() => { if (window.confirm('Delete this row?')) setRows((prev) => prev.filter((item) => item.id !== row.id)) }}>Delete</button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="ainv-panel akr-export-panel">
        <div>
          <h2>Export / Print</h2>
          <p className="akr-muted">Exports include product thumbnails, product code, FNSKU, quantity, PDF filename/status, and row status.</p>
        </div>
        <div className="akr-button-row">
          <button type="button" className="ainv-btn" onClick={printSheet}>Print Sheet</button>
          <button type="button" className="ainv-btn" disabled={busy === 'pdf'} onClick={() => void exportPdf()}>{busy === 'pdf' ? 'Exporting...' : 'Export PDF'}</button>
          <button type="button" className="ainv-btn" onClick={exportXlsx}>Export Excel</button>
          <button type="button" className="ainv-btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </section>
    </div>
  )
}

export default AmazonKsaRtoLabelingPage

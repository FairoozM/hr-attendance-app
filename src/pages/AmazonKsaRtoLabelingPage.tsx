import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  createKsaRtoLabelBatch,
  deleteKsaRtoLabelBatch,
  deleteKsaRtoLabelFile,
  getKsaRtoLabelBatch,
  listKsaRtoLabelBatches,
  parseKsaRtoLabelFile,
  updateKsaRtoLabelBatch,
  uploadKsaRtoLabelFile,
  type KsaRtoBatchPayload,
  type KsaRtoFileType,
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
    status: 'Missing FNSKU',
  }
}

function rowStatus(row: Pick<KsaRtoLabelRow, 'productCode' | 'fnskuNo' | 'quantity'>): KsaRtoRowStatus {
  if (!row.productCode.trim() || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) {
    return 'Invalid Qty'
  }
  if (!row.fnskuNo.trim()) return 'Missing FNSKU'
  return 'Ready'
}

function normalizeRow(row: Partial<KsaRtoLabelRow>, index = 0): DraftRow {
  const quantity = Number(String(row.quantity ?? '').replace(/,/g, '').trim())
  const draft = {
    id: row.id ?? `parsed-${Date.now()}-${index}`,
    productCode: String(row.productCode ?? '').trim(),
    fnskuNo: String(row.fnskuNo ?? '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    notes: String(row.notes ?? '').trim(),
  }
  return { ...draft, status: rowStatus(draft) }
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatSize(bytes?: number) {
  const size = Number(bytes || 0)
  if (!size) return '—'
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
  const hasHeader = firstCells.some((cell) => /product|sku|code|fnsku|qty|quantity/.test(cell))
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

function buildPrintableHtml(meta: BatchMeta, rows: DraftRow[], files: KsaRtoLabelFile[], headerImageUrl?: string) {
  const pdfNames = files.filter((file) => file.fileType === 'fnsku_pdf').map((file) => file.fileName)
  const tableRows = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${row.productCode}</td>
          <td>${row.fnskuNo || '<span class="warn">Missing FNSKU</span>'}</td>
          <td>${row.quantity}</td>
        </tr>`
    )
    .join('')
  return `<!doctype html>
    <html>
      <head>
        <title>${meta.batchTitle || DEFAULT_TITLE}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
          .header-img { max-width: 100%; max-height: 140px; object-fit: contain; margin-bottom: 18px; }
          h1 { font-size: 26px; margin: 0 0 8px; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 12px 0 18px; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #111827; padding: 12px; font-size: 15px; text-align: left; }
          th { background: #f3f4f6; }
          .total { margin-top: 16px; font-weight: 700; }
          .warn { color: #92400e; font-weight: 700; }
          .refs { margin-top: 18px; font-size: 13px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        ${headerImageUrl ? `<img class="header-img" src="${headerImageUrl}" />` : ''}
        <h1>${meta.batchTitle || DEFAULT_TITLE}</h1>
        <div class="meta">
          <div><strong>Reference:</strong> ${meta.referenceNo || '—'}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
          <div><strong>Agent:</strong> ${meta.agentName || '—'}</div>
          <div><strong>Destination:</strong> ${meta.destination || DEFAULT_DESTINATION}</div>
        </div>
        <table>
          <thead>
            <tr><th>Sr. No.</th><th>Product name / code</th><th>FNSKU No</th><th>Quantity</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="total">Total quantity: ${rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)}</div>
        ${meta.notes ? `<p><strong>Notes:</strong> ${meta.notes}</p>` : ''}
        ${pdfNames.length ? `<div class="refs"><strong>Uploaded FNSKU PDFs:</strong><br />${pdfNames.join('<br />')}</div>` : ''}
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
  const [files, setFiles] = useState<KsaRtoLabelFile[]>([])
  const [batches, setBatches] = useState<KsaRtoLabelBatch[]>([])
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [headerPreview, setHeaderPreview] = useState('')
  const headerInputRef = useRef<HTMLInputElement | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const dataInputRef = useRef<HTMLInputElement | null>(null)

  const summary = useMemo(() => {
    const totalLines = rows.length
    const totalQuantity = rows.reduce((sum, row) => sum + (Number(row.quantity) > 0 ? Number(row.quantity) : 0), 0)
    const missingFnsku = rows.filter((row) => rowStatus(row) === 'Missing FNSKU').length
    const invalidQty = rows.filter((row) => rowStatus(row) === 'Invalid Qty').length
    const pdfCount = files.filter((file) => file.fileType === 'fnsku_pdf').length
    return { totalLines, totalQuantity, missingFnsku, invalidQty, pdfCount }
  }, [files, rows])

  const headerFile = files.find((file) => file.fileType === 'header_image')
  const headerImageForPreview = headerPreview || headerFile?.downloadUrl || ''

  const refreshBatches = useCallback(async () => {
    const result = await listKsaRtoLabelBatches({ search })
    setBatches(result.batches)
  }, [search])

  useEffect(() => {
    void refreshBatches().catch((err) => setError(err.message || 'Could not load batch history.'))
  }, [refreshBatches])

  function updateRow(id: DraftRow['id'], patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, ...patch }
        return { ...next, status: rowStatus(next) }
      })
    )
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
    setMessage(`${nextRows.length} row(s) added.`)
    setError('')
  }

  function payload(): KsaRtoBatchPayload {
    return {
      ...meta,
      headerImageUrl: headerFile?.fileUrl || '',
      rows: rows.map((row) => ({
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
      const invalid = rows.filter((row) => rowStatus(row) === 'Invalid Qty')
      if (invalid.length) throw new Error('Fix invalid product code or quantity rows before saving.')
      const result = activeBatchId
        ? await updateKsaRtoLabelBatch(activeBatchId, payload())
        : await createKsaRtoLabelBatch(payload())
      setActiveBatchId(result.batch.id)
      setRows((result.batch.rows || []).map((row, index) => normalizeRow(row, index)))
      setFiles(result.batch.files || [])
      setMessage(activeBatchId ? 'Batch updated.' : 'Batch saved.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save batch.')
    } finally {
      setBusy('')
    }
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
      setFiles(batch.files || [])
      setHeaderPreview('')
      setMessage(`Opened batch #${batch.id}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open batch.')
    } finally {
      setBusy('')
    }
  }

  async function removeBatch(id: number) {
    if (!window.confirm('Delete this batch, rows, and uploaded files?')) return
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

  function resetDraft() {
    setActiveBatchId(null)
    setMeta({ batchTitle: DEFAULT_TITLE, referenceNo: '', agentName: '', destination: DEFAULT_DESTINATION, notes: '' })
    setRows([newRow()])
    setFiles([])
    setHeaderPreview('')
    setPasteText('')
  }

  async function uploadFile(fileType: KsaRtoFileType, file: File) {
    if (!activeBatchId) {
      setError('Save the batch first, then upload files.')
      return
    }
    setBusy(fileType)
    try {
      const result = await uploadKsaRtoLabelFile(activeBatchId, fileType, file)
      setFiles((prev) => [result.file, ...prev.filter((existing) => fileType !== 'header_image' || existing.fileType !== 'header_image')])
      if (fileType === 'header_image') setHeaderPreview(result.file.downloadUrl)
      setMessage('File uploaded.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload file.')
    } finally {
      setBusy('')
    }
  }

  async function removeFile(file: KsaRtoLabelFile) {
    if (!window.confirm(`Remove ${file.fileName}?`)) return
    setBusy(`file-${file.id}`)
    try {
      await deleteKsaRtoLabelFile(file.id)
      setFiles((prev) => prev.filter((item) => item.id !== file.id))
      if (file.fileType === 'header_image') setHeaderPreview('')
      setMessage('File removed.')
      await refreshBatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove file.')
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
    const lines = [
      ['Product name / code', 'FNSKU No', 'Quantity', 'Notes'].map(csvEscape).join(','),
      ...rows.map((row) => [row.productCode, row.fnskuNo, row.quantity, row.notes || ''].map(csvEscape).join(',')),
    ]
    downloadBlob(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), 'amazon-ksa-rto-labeling.csv')
  }

  function exportXlsx() {
    const worksheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        'Product name / code': row.productCode,
        'FNSKU No': row.fnskuNo,
        Quantity: row.quantity,
        Notes: row.notes || '',
      }))
    )
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'KSA RTO Labeling')
    XLSX.writeFile(workbook, 'amazon-ksa-rto-labeling.xlsx')
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    let y = 42
    if (headerPreview.startsWith('data:image/')) {
      const imageFormat = headerPreview.startsWith('data:image/jpeg') ? 'JPEG' : headerPreview.startsWith('data:image/webp') ? 'WEBP' : 'PNG'
      doc.addImage(headerPreview, imageFormat, 42, y, 180, 70, undefined, 'FAST')
      y += 88
    }
    doc.setFontSize(18)
    doc.text(meta.batchTitle || DEFAULT_TITLE, 42, y)
    y += 24
    doc.setFontSize(10)
    doc.text(`Reference: ${meta.referenceNo || '-'}`, 42, y)
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 300, y)
    y += 16
    doc.text(`Agent: ${meta.agentName || '-'}`, 42, y)
    doc.text(`Destination: ${meta.destination || DEFAULT_DESTINATION}`, 300, y)
    y += 18
    autoTable(doc, {
      startY: y,
      head: [['Sr. No.', 'Product name / code', 'FNSKU No', 'Quantity']],
      body: rows.map((row, index) => [index + 1, row.productCode, row.fnskuNo || 'Missing FNSKU', row.quantity]),
      styles: { fontSize: 10, cellPadding: 8 },
      headStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39] },
    })
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y
    doc.text(`Total quantity: ${summary.totalQuantity}`, 42, finalY + 24)
    if (meta.notes) doc.text(`Notes: ${meta.notes}`, 42, finalY + 42, { maxWidth: 500 })
    const pdfNames = files.filter((file) => file.fileType === 'fnsku_pdf').map((file) => file.fileName)
    if (pdfNames.length) doc.text(`Uploaded FNSKU PDFs: ${pdfNames.join(', ')}`, 42, finalY + 62, { maxWidth: 500 })
    doc.save('amazon-ksa-rto-labeling.pdf')
  }

  function printSheet() {
    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) {
      setError('Popup blocked. Allow popups to print the sheet.')
      return
    }
    popup.document.write(buildPrintableHtml(meta, rows, files, headerImageForPreview))
    popup.document.close()
    popup.focus()
    window.setTimeout(() => popup.print(), 300)
  }

  return (
    <div className="akr-page ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header akr-hero">
        <div>
          <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon · KSA RTO</p>
          <h1 className="ainv-page__title">Amazon KSA RTO Labeling / FNSKU Label Upload</h1>
          <p className="ainv-page__lead">
            Prepare the simple product code, FNSKU, and quantity sheet for the RTO agent. Missing FNSKU is a warning only.
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
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Missing FNSKU Count</p><p className="ainv-summary-card__value">{summary.missingFnsku}</p></div>
        <div className="ainv-summary-card"><p className="ainv-summary-card__label">Uploaded PDF Labels</p><p className="ainv-summary-card__value">{summary.pdfCount}</p><p className="ainv-summary-card__hint">{summary.pdfCount ? 'Linked to this batch' : 'No PDFs yet'}</p></div>
      </section>

      {message ? <div className="ainv-banner ainv-banner--sky">{message}</div> : null}
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}
      {summary.invalidQty > 0 ? <div className="ainv-banner ainv-banner--amber">Fix {summary.invalidQty} invalid quantity/product row(s) before saving.</div> : null}

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
                  <span>{batch.totalLines} lines · Qty {batch.totalQuantity} · Missing {batch.missingFnskuCount}</span>
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
          <textarea className="ainv-input akr-paste" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Product name / code\tFNSKU No\tQuantity" />
          <button type="button" className="ainv-btn ainv-btn--primary-emerald" onClick={() => appendRows(parsePastedRows(pasteText))}>Parse pasted rows</button>
        </div>
        <div className="ainv-panel">
          <div className="akr-panel-head"><h2>Upload CSV / XLSX</h2></div>
          <p className="akr-muted">Expected columns: product name / code, FNSKU no, quantity, notes optional.</p>
          <input ref={dataInputRef} className="akr-file-input" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const file = e.target.files?.[0]; if (file) void parseUpload(file) }} />
          <button type="button" className="ainv-btn" disabled={busy === 'parse'} onClick={() => dataInputRef.current?.click()}>{busy === 'parse' ? 'Parsing...' : 'Choose file'}</button>
        </div>
      </section>

      <section className="ainv-panel">
        <div className="akr-panel-head">
          <h2>Manual Entry Table</h2>
          <button type="button" className="ainv-btn" onClick={() => setRows((prev) => [...prev, newRow()])}>Add row</button>
        </div>
        <div className="akr-table-wrap">
          <table className="akr-table">
            <thead><tr><th>Sr. No.</th><th>Product name / code</th><th>FNSKU No</th><th>Quantity</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((row, index) => {
                const status = rowStatus(row)
                return (
                  <tr key={row.id} className={status === 'Missing FNSKU' ? 'akr-row-warn' : status === 'Invalid Qty' ? 'akr-row-error' : ''}>
                    <td>{index + 1}</td>
                    <td><input className="akr-cell-input" value={row.productCode} onChange={(e) => updateRow(row.id, { productCode: e.target.value })} /></td>
                    <td><input className="akr-cell-input" value={row.fnskuNo} placeholder="Optional" onChange={(e) => updateRow(row.id, { fnskuNo: e.target.value })} /></td>
                    <td><input className="akr-cell-input akr-qty" type="number" min={0} value={row.quantity} onChange={(e) => updateRow(row.id, { quantity: Number(e.target.value) })} /></td>
                    <td><span className={`akr-status akr-status--${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span></td>
                    <td>
                      <div className="akr-actions">
                        <button type="button" onClick={() => updateRow(row.id, { notes: window.prompt('Notes', row.notes || '') || row.notes || '' })}>Edit</button>
                        <button type="button" onClick={() => setRows((prev) => [...prev.slice(0, index + 1), { ...row, id: `dup-${Date.now()}` }, ...prev.slice(index + 1)])}>Duplicate</button>
                        <button type="button" onClick={() => { if (window.confirm('Delete this row?')) setRows((prev) => prev.filter((item) => item.id !== row.id)) }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="akr-grid">
        <div className="ainv-panel">
          <div className="akr-panel-head"><h2>Title / Header Picture</h2></div>
          {headerImageForPreview ? <img className="akr-header-preview" src={headerImageForPreview} alt="Header preview" /> : <div className="akr-empty-upload">PNG, JPG, or WebP banner/logo</div>}
          <input ref={headerInputRef} className="akr-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => setHeaderPreview(String(reader.result || ''))
            reader.readAsDataURL(file)
            void uploadFile('header_image', file)
          }} />
          <div className="akr-button-row">
            <button type="button" className="ainv-btn" onClick={() => headerInputRef.current?.click()}>{headerImageForPreview ? 'Replace image' : 'Upload image'}</button>
            {headerFile ? <button type="button" className="ainv-btn" onClick={() => void removeFile(headerFile)}>Remove</button> : null}
          </div>
        </div>

        <div className="ainv-panel">
          <div className="akr-panel-head"><h2>Upload FNSKU Label PDF</h2></div>
          <input ref={pdfInputRef} className="akr-file-input" type="file" multiple accept="application/pdf,.pdf" onChange={(e) => {
            const selected = Array.from(e.target.files || [])
            selected.forEach((file) => void uploadFile('fnsku_pdf', file))
            if (pdfInputRef.current) pdfInputRef.current.value = ''
          }} />
          <button type="button" className="ainv-btn ainv-btn--primary-sky" onClick={() => pdfInputRef.current?.click()} disabled={!activeBatchId}>Upload PDF labels</button>
          <div className="akr-file-list">
            {files.filter((file) => file.fileType === 'fnsku_pdf').map((file) => (
              <div key={file.id} className="akr-file-card">
                <div><strong>{file.fileName}</strong><span>{formatDate(file.createdAt)} · {formatSize(file.fileSize)} · {file.status}</span></div>
                <div className="akr-actions">
                  {file.downloadUrl ? <a href={file.downloadUrl} target="_blank" rel="noreferrer">View</a> : null}
                  {file.downloadUrl ? <a href={file.downloadUrl} download={file.fileName}>Download</a> : null}
                  <button type="button" onClick={() => void removeFile(file)}>Remove</button>
                </div>
              </div>
            ))}
            {!files.some((file) => file.fileType === 'fnsku_pdf') ? <p className="akr-muted">No label PDFs uploaded.</p> : null}
          </div>
        </div>
      </section>

      <section className="ainv-panel akr-export-panel">
        <div>
          <h2>Export / Print</h2>
          <p className="akr-muted">Print sheet uses the agent format: product name / code, FNSKU no, and quantity.</p>
        </div>
        <div className="akr-button-row">
          <button type="button" className="ainv-btn" onClick={printSheet}>Print Sheet</button>
          <button type="button" className="ainv-btn" onClick={exportPdf}>Export PDF</button>
          <button type="button" className="ainv-btn" onClick={exportXlsx}>Export Excel</button>
          <button type="button" className="ainv-btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </section>
    </div>
  )
}

export default AmazonKsaRtoLabelingPage

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, postBinary, downloadBlob } from '../../api/client'
import './BulkZohoInvoicePage.css'

type Usage = {
  utc_day?: string
  daily_limit?: number
  successful_calls?: number | null
  per_minute_limit?: number
}

type CachedItem = {
  sku: string
  item_id: string
  name: string
  rate: number
  tax_id?: string
  unit?: string
  status?: string
}

type InvoiceLine = {
  sku: string
  item_id: string
  name: string
  quantity: number
  rate: number
  discount: number
  tax_id: string
  warehouse_id: string
  status: 'Ready' | 'Missing'
}

const todayIso = () => new Date().toISOString().slice(0, 10)

function parseSkuText(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const seen = new Set<string>()
  const skus: string[] = []
  let duplicates = 0
  for (const sku of lines) {
    const key = sku.toLowerCase()
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    skus.push(sku)
  }
  return { pasted: lines.length, unique: skus.length, duplicates, skus }
}

function parseQuantityText(text: string) {
  const rawLines = text.split(/\r?\n/)
  const values: number[] = []
  let invalid = 0
  for (const rawLine of rawLines) {
    const firstCell = rawLine.split('\t')[0]
    const cleaned = firstCell.trim().replace(/,/g, '')
    if (!cleaned) continue
    const n = Number(cleaned)
    if (Number.isFinite(n) && n > 0) values.push(n)
    else invalid += 1
  }
  return { pasted: rawLines.map((line) => line.trim()).filter(Boolean).length, valid: values.length, invalid, values }
}

function csvEscape(value: unknown) {
  const s = String(value ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportValidationCsv(lines: InvoiceLine[], missing: string[]) {
  const rows = [['Sr No', 'SKU', 'Zoho Item Name', 'Zoho Item ID', 'Quantity', 'Rate', 'Discount', 'Tax ID', 'Warehouse ID', 'Status']]
  lines.forEach((line, index) => {
    rows.push([
      String(index + 1),
      line.sku,
      line.name,
      line.item_id,
      String(line.quantity),
      String(line.rate),
      String(line.discount),
      line.tax_id,
      line.warehouse_id,
      line.status,
    ])
  })
  missing.forEach((sku, index) => rows.push([String(lines.length + index + 1), sku, '', '', '', '', '', '', '', 'Missing']))
  const csv = `${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'bulk_invoice_validation.csv')
}

export default function BulkZohoInvoicePage() {
  const [skuText, setSkuText] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState(todayIso())
  const [currencyCode, setCurrencyCode] = useState<'AED' | 'SAR'>('AED')
  const [warehouseId, setWarehouseId] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [taxMode, setTaxMode] = useState<'inclusive' | 'exclusive'>('exclusive')
  const [defaultTaxId, setDefaultTaxId] = useState('')
  const [defaultQuantity, setDefaultQuantity] = useState(1)
  const [defaultRate, setDefaultRate] = useState('')

  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const parsed = useMemo(() => parseSkuText(skuText), [skuText])
  const parsedQuantities = useMemo(() => parseQuantityText(quantityText), [quantityText])
  const readyCount = lines.filter((line) => line.status === 'Ready').length
  const createDisabled = loading !== '' || !customerId.trim() || !warehouseId.trim() || lines.length === 0 || missing.length > 0

  useEffect(() => {
    let cancelled = false
    api.get('/api/weekly-reports/zoho-api-usage')
      .then((data: any) => {
        if (cancelled) return
        const zoho = data?.zoho || {}
        setUsage({
          utc_day: zoho.api_usage_today?.utc_day,
          daily_limit: zoho.api_usage_today?.daily_limit,
          successful_calls: zoho.api_usage_today?.successful_calls,
          per_minute_limit: zoho.per_minute_limit,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const validate = useCallback(async () => {
    setLoading('validate')
    setError('')
    setSuccess('')
    try {
      const data = await api.post('/api/zoho/items/validate-skus', { skus: parsed.skus })
      const found: CachedItem[] = Array.isArray(data?.found) ? data.found : []
      const foundBySku = new Map(found.map((item) => [item.sku.toLowerCase(), item]))
      const nextLines: InvoiceLine[] = []
      const nextMissing: string[] = []
      for (let index = 0; index < parsed.skus.length; index += 1) {
        const sku = parsed.skus[index]
        const item = foundBySku.get(sku.toLowerCase())
        if (!item) {
          nextMissing.push(sku)
          continue
        }
        nextLines.push({
          sku,
          item_id: item.item_id,
          name: item.name,
          quantity: parsedQuantities.values[index] || (Number(defaultQuantity) > 0 ? Number(defaultQuantity) : 1),
          rate: defaultRate.trim() !== '' ? Number(defaultRate) || 0 : Number(item.rate) || 0,
          discount: 0,
          tax_id: item.tax_id || defaultTaxId,
          warehouse_id: warehouseId,
          status: 'Ready',
        })
      }
      setLines(nextLines)
      setMissing(nextMissing)
      if (data?.usage) setUsage(data.usage)
    } catch (err: any) {
      setError(err?.message || 'Failed to validate SKUs.')
    } finally {
      setLoading('')
    }
  }, [parsed.skus, parsedQuantities.values, defaultQuantity, defaultRate, defaultTaxId, warehouseId])

  const syncItems = useCallback(async () => {
    setLoading('sync')
    setError('')
    setSuccess('')
    try {
      const data = await api.post('/api/zoho/items/sync', {})
      if (data?.usage) setUsage(data.usage)
      setSuccess(`Synced ${data?.items_synced ?? 0} items from ${data?.pages_fetched ?? 0} page(s). API calls used: ${data?.api_calls_used ?? 0}.`)
      await validate()
    } catch (err: any) {
      setError(err?.message || 'Failed to sync Zoho items.')
    } finally {
      setLoading('')
    }
  }, [validate])

  const updateLine = (index: number, patch: Partial<InvoiceLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const applyPastedQuantities = useCallback(() => {
    if (lines.length === 0 || parsedQuantities.values.length === 0) return
    setLines((prev) => prev.map((line, index) => ({
      ...line,
      quantity: parsedQuantities.values[index] || line.quantity,
    })))
  }, [lines.length, parsedQuantities.values])

  const createInvoice = useCallback(async () => {
    setConfirmOpen(false)
    setLoading('create')
    setError('')
    setSuccess('')
    try {
      const payload = {
        customer_id: customerId.trim(),
        date,
        due_date: dueDate,
        currency_code: currencyCode,
        warehouse_id: warehouseId.trim(),
        reference_number: referenceNumber.trim(),
        notes,
        is_inclusive_tax: taxMode === 'inclusive',
        line_items: lines.map((line) => ({
          sku: line.sku,
          item_id: line.item_id,
          quantity: line.quantity,
          rate: line.rate,
          discount: line.discount,
          tax_id: line.tax_id,
          warehouse_id: line.warehouse_id || warehouseId.trim(),
        })),
      }
      const data = await api.post('/api/zoho/invoices/bulk-create', payload)
      if (data?.usage) setUsage(data.usage)
      setSuccess(data?.duplicate
        ? `Duplicate protected: existing invoice ${data?.invoice?.invoice_number || data?.invoice?.zoho_invoice_id || ''} returned.`
        : `Created Zoho invoice ${data?.invoice?.invoice_number || data?.invoice?.zoho_invoice_id || ''}.`)
    } catch (err: any) {
      setError(err?.message || 'Failed to create invoice.')
    } finally {
      setLoading('')
    }
  }, [customerId, date, dueDate, currencyCode, warehouseId, referenceNumber, notes, taxMode, lines])

  return (
    <div className="bzi-page">
      <div className="bzi-shell">
        <header className="bzi-header">
          <div>
            <div className="bzi-eyebrow">Admin · Zoho</div>
            <h1 className="bzi-title">Bulk Zoho Invoice</h1>
            <p className="bzi-subtitle">Paste SKUs, validate from local cache, then create one Zoho invoice with all lines.</p>
          </div>
          {usage && (
            <div className="bzi-usage">
              <span>Zoho API daily usage</span>
              <strong>{usage.successful_calls ?? '—'} / {usage.daily_limit ?? '—'}</strong>
              <span>Per minute limit: {usage.per_minute_limit ?? '—'}</span>
              <span>UTC day: {usage.utc_day ?? '—'}</span>
            </div>
          )}
        </header>

        <section className="bzi-card">
          <h2 className="bzi-card-title">Invoice Header</h2>
          <div className="bzi-grid">
            <label className="bzi-field"><span className="bzi-label">Customer ID</span><input className="bzi-input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Zoho customer_id" /></label>
            <label className="bzi-field"><span className="bzi-label">Invoice Date</span><input className="bzi-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="bzi-field"><span className="bzi-label">Due Date</span><input className="bzi-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
            <label className="bzi-field"><span className="bzi-label">Currency</span><select className="bzi-select" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value as 'AED' | 'SAR')}><option value="AED">AED</option><option value="SAR">SAR</option></select></label>
            <label className="bzi-field"><span className="bzi-label">Warehouse ID</span><input className="bzi-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="Zoho warehouse_id" /></label>
            <label className="bzi-field"><span className="bzi-label">Reference Number</span><input className="bzi-input" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></label>
            <label className="bzi-field"><span className="bzi-label">Tax Mode</span><select className="bzi-select" value={taxMode} onChange={(e) => setTaxMode(e.target.value as 'inclusive' | 'exclusive')}><option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option></select></label>
            <label className="bzi-field"><span className="bzi-label">Default Tax ID</span><input className="bzi-input" value={defaultTaxId} onChange={(e) => setDefaultTaxId(e.target.value)} /></label>
            <label className="bzi-field"><span className="bzi-label">Default Quantity</span><input className="bzi-input" type="number" min="0.01" step="0.01" value={defaultQuantity} onChange={(e) => setDefaultQuantity(Number(e.target.value) || 1)} /></label>
            <label className="bzi-field"><span className="bzi-label">Default Rate Optional</span><input className="bzi-input" type="number" min="0" step="0.01" value={defaultRate} onChange={(e) => setDefaultRate(e.target.value)} placeholder="Use cache rate if blank" /></label>
            <label className="bzi-field bzi-field--wide"><span className="bzi-label">Notes</span><input className="bzi-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
        </section>

        <section className="bzi-card">
          <h2 className="bzi-card-title">SKU & Quantity Input</h2>
          <div className="bzi-paste-grid">
            <div>
              <label className="bzi-label" htmlFor="bzi-sku-textarea">SKU Input</label>
              <textarea id="bzi-sku-textarea" className="bzi-textarea" value={skuText} onChange={(e) => setSkuText(e.target.value)} placeholder={'SKU-001\nSKU-002\nSKU-003'} />
            </div>
            <div>
              <label className="bzi-label" htmlFor="bzi-quantity-textarea">Quantity Input</label>
              <textarea id="bzi-quantity-textarea" className="bzi-textarea" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} placeholder={'1\n2\n5'} />
              <p className="bzi-muted" style={{ marginTop: 8 }}>Paste one quantity per line from Excel. Row 1 matches the first unique SKU.</p>
            </div>
          </div>
          <div className="bzi-counter-row" style={{ marginTop: 12 }}>
            <span className="bzi-counter">Pasted: {parsed.pasted}</span>
            <span className="bzi-counter">Unique: {parsed.unique}</span>
            <span className="bzi-counter">Duplicates: {parsed.duplicates}</span>
            <span className="bzi-counter">Quantities: {parsedQuantities.valid}</span>
            <span className="bzi-counter">Invalid Qty: {parsedQuantities.invalid}</span>
            <span className="bzi-counter bzi-counter--missing">Missing: {missing.length}</span>
            <span className="bzi-counter bzi-counter--ready">Ready: {readyCount}</span>
          </div>
          <div className="bzi-actions">
            <button className="bzi-btn bzi-btn--primary" disabled={loading !== '' || parsed.unique === 0} onClick={validate}>{loading === 'validate' ? 'Validating…' : 'Validate SKUs'}</button>
            <button className="bzi-btn bzi-btn--ghost" disabled={loading !== '' || missing.length === 0} onClick={syncItems}>{loading === 'sync' ? 'Syncing…' : 'Sync Items From Zoho'}</button>
            <button className="bzi-btn bzi-btn--ghost" disabled={loading !== '' || lines.length === 0 || parsedQuantities.valid === 0} onClick={applyPastedQuantities}>Apply Quantities</button>
            <button className="bzi-btn bzi-btn--ghost" disabled={lines.length === 0 && missing.length === 0} onClick={() => exportValidationCsv(lines, missing)}>Export Validation CSV</button>
            <button className="bzi-btn bzi-btn--primary" disabled={createDisabled} onClick={() => setConfirmOpen(true)}>{loading === 'create' ? 'Creating…' : 'Create Invoice'}</button>
          </div>
          <p className="bzi-muted" style={{ marginTop: 12 }}>Estimated Zoho API calls: Validate SKUs: 0 · Create Invoice: 1 · Sync Items: only if manually clicked.</p>
          {missing.length > 0 && <div className="bzi-callout bzi-callout--error"><strong>Missing SKUs</strong><div className="bzi-missing-list">{missing.join(', ')}</div></div>}
          {readyCount > 0 && missing.length === 0 && <div className="bzi-callout bzi-callout--success">{readyCount} SKU(s) ready for invoice creation.</div>}
          {error && <div className="bzi-callout bzi-callout--error">{error}</div>}
          {success && <div className="bzi-callout bzi-callout--success">{success}</div>}
        </section>

        <section className="bzi-card">
          <h2 className="bzi-card-title">Editable Line Items</h2>
          <div className="bzi-table-wrap">
            <table className="bzi-table">
              <thead><tr><th>Sr No</th><th>SKU</th><th>Zoho Item Name</th><th>Zoho Item ID</th><th>Quantity</th><th>Rate</th><th>Discount</th><th>Tax ID</th><th>Warehouse ID</th><th>Status</th></tr></thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={10} className="bzi-muted">Validate SKUs to build invoice lines.</td></tr>
                ) : lines.map((line, index) => (
                  <tr key={`${line.sku}-${line.item_id}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{line.sku}</td>
                    <td>{line.name}</td>
                    <td>{line.item_id}</td>
                    <td><input className="bzi-table-input" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: Number(e.target.value) || 0 })} /></td>
                    <td><input className="bzi-table-input" type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(index, { rate: Number(e.target.value) || 0 })} /></td>
                    <td><input className="bzi-table-input" type="number" min="0" step="0.01" value={line.discount} onChange={(e) => updateLine(index, { discount: Number(e.target.value) || 0 })} /></td>
                    <td><input className="bzi-table-input bzi-table-input--wide" value={line.tax_id} onChange={(e) => updateLine(index, { tax_id: e.target.value })} /></td>
                    <td><input className="bzi-table-input bzi-table-input--wide" value={line.warehouse_id} onChange={(e) => updateLine(index, { warehouse_id: e.target.value })} /></td>
                    <td><span className="bzi-status bzi-status--ready">{line.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {confirmOpen && (
        <div className="bzi-modal-backdrop" role="dialog" aria-modal="true">
          <div className="bzi-modal">
            <h2 className="bzi-card-title">Confirm Invoice Creation</h2>
            <p className="bzi-subtitle">This will create 1 Zoho invoice with {lines.length} line items and consume approximately 1 API call.</p>
            <div className="bzi-actions">
              <button className="bzi-btn bzi-btn--primary" onClick={createInvoice}>Create 1 Invoice</button>
              <button className="bzi-btn bzi-btn--ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

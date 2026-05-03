import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './DocumentExpiryPage.css'
import './PurchasePlanningPage.css'

const EMPTY_FILTERS = {
  matchStatus: '',
  unavailableOnly: false,
  criticalOnly: false,
  includedOnly: false,
}

function fmt(n) {
  const value = Number(n || 0)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function Badge({ children, tone = 'muted' }) {
  return <span className={`pp-badge pp-badge--${tone}`}>{children}</span>
}

function SummaryCards({ plan, lowStock }) {
  const items = plan?.items || []
  const matched = items.filter((item) => item.matchType !== 'not_found').length
  const unavailable = items.filter((item) => item.wholesaleAvailableQty <= 0 || item.matchType === 'not_found').length
  const totalSuggested = items.reduce((sum, item) => sum + Number(item.suggestedQty || 0), 0)
  const totalFinal = items.reduce((sum, item) => sum + (item.included ? Number(item.finalQty || 0) : 0), 0)

  return (
    <div className="doc-summary-cards pp-summary">
      <div className="doc-summary-card doc-summary-card--total">
        <span className="doc-summary-card__count">{lowStock.length}</span>
        <span className="doc-summary-card__label">Low stock SKUs</span>
      </div>
      <div className="doc-summary-card doc-summary-card--ok">
        <span className="doc-summary-card__count">{matched}</span>
        <span className="doc-summary-card__label">Matched SKUs</span>
      </div>
      <div className="doc-summary-card doc-summary-card--expired">
        <span className="doc-summary-card__count">{items.length - matched}</span>
        <span className="doc-summary-card__label">Unmatched SKUs</span>
      </div>
      <div className="doc-summary-card doc-summary-card--due-soon">
        <span className="doc-summary-card__count">{totalSuggested}</span>
        <span className="doc-summary-card__label">Suggested Qty</span>
      </div>
      <div className="doc-summary-card doc-summary-card--urgent">
        <span className="doc-summary-card__count">{totalFinal}</span>
        <span className="doc-summary-card__label">Final Qty</span>
      </div>
      <div className="doc-summary-card doc-summary-card--expired">
        <span className="doc-summary-card__count">{unavailable}</span>
        <span className="doc-summary-card__label">Wholesale unavailable</span>
      </div>
    </div>
  )
}

function UploadPanel({ uploads, onUploaded }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = useCallback(async (save) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('save', save ? 'true' : 'false')
      const res = await api.postForm('/api/purchase-planning/vigil-upload', form)
      setPreview(res.preview)
      if (res.saved) {
        setFile(null)
        onUploaded()
      }
    } catch (err) {
      setError(err.message || 'Upload failed')
      if (err.body?.preview) setPreview(err.body.preview)
    } finally {
      setBusy(false)
    }
  }, [file, onUploaded])

  return (
    <section className="pp-panel">
      <div className="pp-panel__head">
        <div>
          <h2>Vigil Stock Upload</h2>
          <p>Preview CSV or Excel wholesale stock rows before saving them as the active upload.</p>
        </div>
        <div className="pp-upload-actions">
          <input type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setPreview(null)
            setError('')
          }} />
          <button className="btn" disabled={!file || busy} onClick={() => submit(false)}>Preview</button>
          <button className="btn btn--primary" disabled={!file || busy || !preview || preview.summary.invalidRows > 0} onClick={() => submit(true)}>
            Save upload
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
                    <td>{row.itemCode || '-'}</td>
                    <td>{fmt(row.availableStock)}</td>
                    <td>{row.valid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">{row.errors.join(', ')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="pp-upload-history">
        <strong>Latest uploads</strong>
        {uploads.length === 0 ? <span>No saved Vigil uploads yet.</span> : uploads.slice(0, 3).map((upload) => (
          <span key={upload.id}>{upload.fileName} · {upload.rowsCount} rows</span>
        ))}
      </div>
    </section>
  )
}

function PlanTable({ plan, filters, onFiltersChange, onItemChange }) {
  const rows = useMemo(() => {
    const source = plan?.items || []
    return source.filter((item) => {
      if (filters.matchStatus && item.matchType !== filters.matchStatus) return false
      if (filters.unavailableOnly && item.wholesaleAvailableQty > 0 && item.matchType !== 'not_found') return false
      if (filters.criticalOnly && item.currentZohoStock > 0) return false
      if (filters.includedOnly && !item.included) return false
      return true
    })
  }, [plan, filters])

  if (!plan) {
    return <div className="pp-empty">Generate or open a draft purchase plan to review SKUs and final quantities.</div>
  }

  return (
    <section className="pp-panel">
      <div className="pp-panel__head">
        <div>
          <h2>{plan.planNumber}</h2>
          <p>Status: <Badge tone={plan.status === 'sent_to_zoho' ? 'success' : plan.status === 'failed' ? 'danger' : 'warning'}>{plan.status}</Badge></p>
        </div>
        {plan.zohoPurchaseOrderId && <Badge tone="success">Zoho PO {plan.zohoPurchaseOrderId}</Badge>}
      </div>

      <div className="doc-filters pp-filters">
        <select value={filters.matchStatus} onChange={(e) => onFiltersChange({ ...filters, matchStatus: e.target.value })}>
          <option value="">All match statuses</option>
          <option value="exact">Exact</option>
          <option value="parent">Parent</option>
          <option value="not_found">Not found</option>
        </select>
        {[
          ['unavailableOnly', 'Unavailable only'],
          ['criticalOnly', 'Critical stock'],
          ['includedOnly', 'Included only'],
        ].map(([key, label]) => (
          <label className="pp-check" key={key}>
            <input type="checkbox" checked={filters[key]} onChange={(e) => onFiltersChange({ ...filters, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>

      <div className="doc-table-wrap">
        <table className="doc-table pp-plan-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item Name</th>
              <th>Zoho Stock</th>
              <th>Vigil Code</th>
              <th>Wholesale</th>
              <th>Sales 3M</th>
              <th>Bundle 3M</th>
              <th>Avg Monthly</th>
              <th>Suggested</th>
              <th>Final Qty</th>
              <th>Match</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className={!item.included ? 'pp-row--muted' : ''}>
                <td><strong>{item.sku}</strong></td>
                <td>{item.itemName}</td>
                <td>{fmt(item.currentZohoStock)}</td>
                <td>{item.vigilCode || '-'}</td>
                <td>{fmt(item.wholesaleAvailableQty)}</td>
                <td>{fmt(item.totalSalesLast3Months)}</td>
                <td>{fmt(item.totalBundleUsageLast3Months)}</td>
                <td>{fmt(item.averageMonthlyUsage)}</td>
                <td>{item.suggestedQty}</td>
                <td>
                  <input
                    className="pp-qty-input"
                    type="number"
                    min="0"
                    value={item.finalQty}
                    onChange={(e) => onItemChange(item.id, { finalQty: e.target.value })}
                  />
                </td>
                <td>
                  <Badge tone={item.matchType === 'exact' ? 'success' : item.matchType === 'parent' ? 'warning' : 'danger'}>
                    {item.matchType}
                  </Badge>
                </td>
                <td>
                  <button
                    className="btn btn--sm"
                    onClick={() => onItemChange(item.id, { included: !item.included })}
                  >
                    {item.included ? 'Ignore' : 'Include'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="12" className="pp-empty-cell">No items match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function PurchasePlanningPage() {
  const [lowStock, setLowStock] = useState([])
  const [uploads, setUploads] = useState([])
  const [plans, setPlans] = useState([])
  const [activePlan, setActivePlan] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    const [low, uploadRes, planRes] = await Promise.all([
      api.get('/api/purchase-planning/low-stock'),
      api.get('/api/purchase-planning/vigil-uploads'),
      api.get('/api/purchase-planning/plans'),
    ])
    setLowStock(low.items || [])
    setUploads(uploadRes.uploads || [])
    setPlans(planRes.plans || [])
  }, [])

  useEffect(() => {
    setLoading(true)
    load().catch((err) => setError(err.message || 'Failed to load purchase planning')).finally(() => setLoading(false))
  }, [load])

  const refreshActivePlan = useCallback(async (id) => {
    const res = await api.get(`/api/purchase-planning/plans/${id}`)
    setActivePlan(res.plan)
    return res.plan
  }, [])

  const syncLowStock = useCallback(async () => {
    setBusy('sync')
    setError('')
    setNotice('')
    try {
      const res = await api.get('/api/purchase-planning/low-stock/sync')
      setLowStock(res.items || [])
      setNotice(`Synced ${res.summary.detected} low-stock SKUs from Zoho.`)
    } catch (err) {
      setError(err.message || 'Low-stock sync failed')
    } finally {
      setBusy('')
    }
  }, [])

  const generatePlan = useCallback(async () => {
    setBusy('generate')
    setError('')
    setNotice('')
    try {
      const res = await api.post('/api/purchase-planning/generate-plan', {})
      setActivePlan(res.plan)
      await load()
      setNotice(`Generated draft plan ${res.plan.planNumber}.`)
    } catch (err) {
      setError(err.message || 'Plan generation failed')
    } finally {
      setBusy('')
    }
  }, [load])

  const openPlan = useCallback(async (id) => {
    setBusy(`plan-${id}`)
    setError('')
    try {
      await refreshActivePlan(id)
    } catch (err) {
      setError(err.message || 'Failed to open plan')
    } finally {
      setBusy('')
    }
  }, [refreshActivePlan])

  const updateItem = useCallback(async (itemId, patch) => {
    if (!activePlan) return
    const optimisticItems = activePlan.items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
    setActivePlan({ ...activePlan, items: optimisticItems })
    try {
      await api.put(`/api/purchase-planning/plans/${activePlan.id}/items/${itemId}`, patch)
      await refreshActivePlan(activePlan.id)
    } catch (err) {
      setError(err.message || 'Failed to update plan item')
      await refreshActivePlan(activePlan.id)
    }
  }, [activePlan, refreshActivePlan])

  const createPo = useCallback(async () => {
    if (!activePlan) return
    if (!window.confirm(`Create a Zoho purchase order from ${activePlan.planNumber}? This cannot be sent twice.`)) return
    setBusy('po')
    setError('')
    setNotice('')
    try {
      const res = await api.post(`/api/purchase-planning/plans/${activePlan.id}/create-zoho-po`, {})
      await refreshActivePlan(activePlan.id)
      await load()
      setNotice(`Created Zoho purchase order ${res.zohoPurchaseOrderId || ''} with ${res.sentLines} lines.`)
    } catch (err) {
      setError(err.message || 'Zoho purchase order failed')
      await refreshActivePlan(activePlan.id).catch(() => {})
    } finally {
      setBusy('')
    }
  }, [activePlan, load, refreshActivePlan])

  if (loading) return <div className="page"><p className="page-loading">Loading Purchase Planning…</p></div>

  return (
    <div className="page pp-page">
      <div className="doc-page-hero pp-hero">
        <div>
          <h1 className="doc-page-title">Purchase Planning</h1>
          <p className="doc-page-subtitle">
            Detect ecommerce SKUs below 3 pcs, match them to Vigil wholesale stock, calculate three-month usage,
            and create a reviewed draft before sending any PO to Zoho.
          </p>
        </div>
        <div className="pp-hero__actions">
          <button className="btn" disabled={busy === 'sync'} onClick={syncLowStock}>Sync low stock</button>
          <button className="btn btn--primary" disabled={busy === 'generate'} onClick={generatePlan}>Generate Purchase Plan</button>
          <button className="btn btn--primary" disabled={!activePlan || activePlan.status === 'sent_to_zoho' || busy === 'po'} onClick={createPo}>
            Create PO in Zoho
          </button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {notice && <div className="pp-notice">{notice}</div>}

      <SummaryCards plan={activePlan} lowStock={lowStock} />

      <div className="pp-grid">
        <UploadPanel uploads={uploads} onUploaded={load} />
        <section className="pp-panel">
          <div className="pp-panel__head">
            <div>
              <h2>Draft Plans</h2>
              <p>Open a draft, review final quantities, then send it to Zoho.</p>
            </div>
          </div>
          <div className="pp-plan-list">
            {plans.length === 0 && <span>No purchase plans generated yet.</span>}
            {plans.slice(0, 8).map((plan) => (
              <button key={plan.id} className={`pp-plan-card ${activePlan?.id === plan.id ? 'pp-plan-card--active' : ''}`} onClick={() => openPlan(plan.id)}>
                <strong>{plan.planNumber}</strong>
                <span>{plan.itemsCount} items · final qty {plan.totalFinalQty}</span>
                <Badge tone={plan.status === 'sent_to_zoho' ? 'success' : plan.status === 'failed' ? 'danger' : 'warning'}>{plan.status}</Badge>
              </button>
            ))}
          </div>
        </section>
      </div>

      <PlanTable
        plan={activePlan}
        filters={filters}
        onFiltersChange={setFilters}
        onItemChange={updateItem}
      />
    </div>
  )
}

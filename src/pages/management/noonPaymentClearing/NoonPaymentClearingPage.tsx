import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  approveNoonPaymentClearingBatch,
  fetchNoonFeeJournalMappings,
  fetchNoonPaymentClearingBatch,
  fetchNoonSavedBatches,
  fetchNoonZohoCustomers,
  forceRepostNoonPaymentClearing,
  generateNoonPaymentPreview,
  type NoonPaymentClearingPreview,
  type NoonPaymentPreview,
  type NoonPostingResult,
  type NoonSavedBatchSummary,
  postNoonPaymentClearingToZoho,
  previewNoonStatementUpload,
  saveNoonFeeJournalMapping,
} from '../../../api/noonPaymentClearing'
import { CLEARING_STEPS, type StepStatus } from './clearingSteps'
import { ClearingStepper, StepPanel } from './components/ClearingStepper'
import './NoonPaymentClearingPage.css'

const STEP_KEY_TO_ID = new Map(CLEARING_STEPS.map((s) => [s.key, s.id]))
const STEP_ID_TO_KEY = new Map(CLEARING_STEPS.map((s) => [s.id, s.key]))
const BASE = '/management/noon-payment-clearing'

function money(value: number | undefined | null) {
  const n = Number(value) || 0
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeError(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message)
  return 'Something went wrong'
}

export function NoonPaymentClearingPage() {
  const navigate = useNavigate()
  const params = useParams()
  const routeBatchId = params.batchId ? String(params.batchId) : ''
  const routeStepKey = params.stepKey || ''
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [zohoCustomerName, setZohoCustomerName] = useState('Noon')
  const [customers, setCustomers] = useState<Array<{ name: string; label: string }>>([])
  const [savedBatches, setSavedBatches] = useState<NoonSavedBatchSummary[]>([])
  const [preview, setPreview] = useState<NoonPaymentClearingPreview | null>(null)
  const [paymentPreview, setPaymentPreview] = useState<NoonPaymentPreview | null>(null)
  const [postingResult, setPostingResult] = useState<NoonPostingResult | null>(null)
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [feeMappings, setFeeMappings] = useState<Array<Record<string, unknown>>>([])
  const [mappingDraft, setMappingDraft] = useState({
    normalizedFeeType: 'ADVERTISING',
    debitAccountName: '',
    debitAccountId: '',
    creditAccountName: '',
    creditAccountId: '',
  })

  const loadedBatchId = preview?.batchId != null ? String(preview.batchId) : ''
  const stepFromKey = STEP_KEY_TO_ID.get(routeStepKey)
  const activeStep = preview ? (stepFromKey ?? 2) : 1

  const clearingPath = useCallback((stepId: number, batchId?: string | number | null) => {
    const key = STEP_ID_TO_KEY.get(stepId) || 'select'
    const bid = batchId == null ? '' : String(batchId).trim()
    return bid ? `${BASE}/batch/${bid}/${key}` : `${BASE}/${key}`
  }, [])

  const goToStep = useCallback(
    (stepId: number) => {
      navigate(clearingPath(stepId, loadedBatchId || routeBatchId || null))
    },
    [navigate, clearingPath, loadedBatchId, routeBatchId]
  )

  const refreshBatches = useCallback(async () => {
    const batches = await fetchNoonSavedBatches(50)
    setSavedBatches(batches)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchNoonZohoCustomers()
        if (cancelled) return
        setCustomers(rows)
        if (rows[0]?.name) setZohoCustomerName(rows[0].name)
      } catch (err) {
        if (!cancelled) setError(safeError(err))
      }
      try {
        await refreshBatches()
      } catch (err) {
        if (!cancelled) setError(safeError(err))
      }
      try {
        const data = await fetchNoonFeeJournalMappings()
        if (!cancelled) setFeeMappings(data.mappings || [])
      } catch (err) {
        if (!cancelled) setError(safeError(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshBatches])

  useEffect(() => {
    if (!routeBatchId || (preview && String(preview.batchId) === routeBatchId)) return
    setLoading(true)
    fetchNoonPaymentClearingBatch(routeBatchId)
      .then((data) => {
        setPreview(data)
        setError('')
      })
      .catch((err) => setError(safeError(err)))
      .finally(() => setLoading(false))
  }, [routeBatchId, preview])

  const isApproved = preview?.status === 'approved' || preview?.batch?.status === 'approved'
  const isPosted = Boolean(preview?.postedToZoho || preview?.status === 'posted' || preview?.batch?.status === 'posted')
  const isClean = Boolean(preview?.isCleanForApproval)

  const stepStatuses = useMemo(() => {
    const s: Record<number, StepStatus> = {}
    s[1] = preview ? 'completed' : 'in_progress'
    s[2] = preview ? 'completed' : 'not_started'
    s[3] = preview ? 'completed' : 'not_started'
    s[4] = !preview
      ? 'not_started'
      : (preview.unmatchedOrders?.length || 0) > 0 || (preview.multipleMatchItems?.length || 0) > 0
        ? 'blocked'
        : 'completed'
    s[5] = preview ? 'completed' : 'not_started'
    s[6] = preview ? 'completed' : 'not_started'
    s[7] = !preview
      ? 'not_started'
      : preview.reconciliationSummary?.reconciliationStatus === 'mismatch'
        ? 'blocked'
        : 'completed'
    s[8] = !preview ? 'not_started' : isApproved || isPosted ? 'completed' : isClean ? 'ready' : 'blocked'
    s[9] = !preview
      ? 'not_started'
      : (preview.feeJournalLines || []).some((l) => l.mappingStatus === 'needs_mapping')
        ? 'blocked'
        : isApproved || isPosted
          ? 'ready'
          : 'not_started'
    s[10] = paymentPreview ? 'completed' : isApproved || isPosted ? 'ready' : 'not_started'
    s[11] = isPosted ? 'completed' : paymentPreview ? 'ready' : 'not_started'
    return s
  }, [preview, isApproved, isPosted, isClean, paymentPreview])

  async function onUpload(file: File | null | undefined) {
    if (!file) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const data = await previewNoonStatementUpload(file, zohoCustomerName)
      setPreview(data)
      setPaymentPreview(null)
      setPostingResult(null)
      await refreshBatches()
      navigate(clearingPath(2, data.batchId))
      setNotice(`Loaded statement batch #${data.batchId}`)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onOpenBatch(batchId: number) {
    setLoading(true)
    setError('')
    try {
      const data = await fetchNoonPaymentClearingBatch(batchId)
      setPreview(data)
      setPaymentPreview(null)
      navigate(clearingPath(2, batchId))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onApprove() {
    if (!preview?.batchId) return
    setLoading(true)
    setError('')
    try {
      await approveNoonPaymentClearingBatch(preview.batchId)
      const data = await fetchNoonPaymentClearingBatch(preview.batchId)
      setPreview(data)
      goToStep(9)
      setNotice('Statement approved. Map fee journals, then generate payment preview.')
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onGeneratePaymentPreview() {
    if (!preview?.batchId) return
    setLoading(true)
    setError('')
    try {
      const pp = await generateNoonPaymentPreview(preview.batchId)
      setPaymentPreview(pp)
      goToStep(10)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onPost(dryRun: boolean) {
    if (!preview?.batchId) return
    if (!dryRun && !window.confirm('Post Noon invoice payments and fee journals to Zoho?')) return
    setLoading(true)
    setError('')
    try {
      const result = await postNoonPaymentClearingToZoho(preview.batchId, dryRun)
      setPostingResult(result)
      if (!dryRun) {
        const data = await fetchNoonPaymentClearingBatch(preview.batchId)
        setPreview(data)
      }
      goToStep(11)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onForceRepost() {
    if (!preview?.batchId) return
    const reason = window.prompt('Force repost reason (min 4 characters)?') || ''
    if (reason.trim().length < 4) return
    setLoading(true)
    try {
      const result = await forceRepostNoonPaymentClearing(preview.batchId, reason.trim())
      setPostingResult(result)
      const data = await fetchNoonPaymentClearingBatch(preview.batchId)
      setPreview(data)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onSaveMapping() {
    setLoading(true)
    try {
      await saveNoonFeeJournalMapping(mappingDraft)
      const data = await fetchNoonFeeJournalMappings()
      setFeeMappings(data.mappings || [])
      if (preview?.batchId) {
        const refreshed = await fetchNoonPaymentClearingBatch(preview.batchId)
        setPreview(refreshed)
      }
      setNotice('Fee journal mapping saved.')
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  const rows = preview?.allRows || []
  const parents = preview?.hierarchy?.parentGroups || []

  return (
    <div className="ainv-page npc-page">
      <header className="ainv-page__header">
        <div>
          <p className="npc-step-panel__eyebrow">Management · Noon · AE</p>
          <h1>Noon Payment Clearance</h1>
          <p className="ainv-page__subtitle">
            Import once, reconcile parent/item Noon orders to Zoho item-level invoices, approve, then post grouped
            payments and fee journals.
          </p>
        </div>
      </header>

      <div className="npc-alert" role="note">
        Zoho posting is guarded. Invoice payments use <strong>item-level</strong> Noon IDs only. Parent-order and
        statement fees are journals — never missing invoices.
      </div>

      {notice ? (
        <div className="npc-alert npc-approved-panel" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="npc-alert npc-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      <ClearingStepper activeStep={activeStep} stepStatuses={stepStatuses} onStepClick={goToStep} />

      {CLEARING_STEPS.map((step) => {
        const collapsed = activeStep !== step.id
        const status = stepStatuses[step.id] || 'not_started'
        return (
          <StepPanel
            key={step.id}
            step={step}
            status={status}
            collapsed={collapsed}
            onExpand={() => goToStep(step.id)}
            summary={
              collapsed && preview
                ? step.id === 4
                  ? `${preview.matchedOrders?.length || 0} matched · ${preview.unmatchedOrders?.length || 0} missing`
                  : step.id === 7
                    ? preview.reconciliationSummary?.reconciliationStatus
                    : undefined
                : undefined
            }
          >
            {step.id === 1 && (
              <div className="npc-step-stack">
                <div className="npc-actions">
                  <label className="ainv-label">
                    Zoho customer
                    <select
                      className="ainv-input"
                      value={zohoCustomerName}
                      onChange={(e) => setZohoCustomerName(e.target.value)}
                      disabled={loading}
                    >
                      {(customers.length ? customers : [{ name: 'Noon', label: 'Noon (NOON-AE)' }]).map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.label || c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="npc-button-row">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
                    hidden
                    onChange={(e) => onUpload(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--primary-sky"
                    disabled={loading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {loading ? 'Uploading…' : 'Upload Noon statement'}
                  </button>
                  <button type="button" className="ainv-btn" disabled>
                    Fetch via API (later)
                  </button>
                </div>
                <h3>Saved statement batches</h3>
                {savedBatches.length === 0 ? (
                  <p className="npc-muted">No saved statement batches yet. Upload a statement to create one.</p>
                ) : (
                  <div className="npc-table-wrap">
                    <table className="npc-table">
                      <thead>
                        <tr>
                          <th>Batch</th>
                          <th>Reference</th>
                          <th>Status</th>
                          <th>Total</th>
                          <th>Match</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {savedBatches.map((b) => (
                          <tr key={b.batchId}>
                            <td>{b.batchId}</td>
                            <td>
                              <code className="npc-ref">{b.referenceNr || '—'}</code>
                            </td>
                            <td>{b.status}</td>
                            <td className="npc-money">{money(b.settlementTotal)}</td>
                            <td>
                              {b.matchedItemCount} ok / {b.unmatchedItemCount} missing
                            </td>
                            <td>
                              <button type="button" className="ainv-btn ainv-btn--sm" onClick={() => onOpenBatch(b.batchId)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {step.id === 2 && preview && (
              <div className="npc-step-stack">
                <div className="npc-summary-grid">
                  <div className="ainv-summary-card">
                    <span>Rows</span>
                    <strong>{rows.length}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Reference</span>
                    <strong>{String(preview.metadata?.referenceNr || '—')}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Settlement</span>
                    <strong>{money(preview.totals?.settlementTotal)}</strong>
                  </div>
                </div>
                <div className="npc-table-wrap npc-table-wrap--wide">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Parent Order</th>
                        <th>Item Order</th>
                        <th>SKU</th>
                        <th>Type</th>
                        <th>Class</th>
                        <th>Proceeds</th>
                        <th>Commission</th>
                        <th>Fulfillment</th>
                        <th>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>
                            <code className="npc-ref">{row.parentOrderId || '—'}</code>
                          </td>
                          <td>
                            <code className="npc-ref">{row.itemOrderId || '—'}</code>
                          </td>
                          <td>{row.sku || row.partnerSku || '—'}</td>
                          <td>{row.transactionType}</td>
                          <td>{row.rowClass}</td>
                          <td className="npc-money">{money(row.netProceed)}</td>
                          <td className="npc-money">{money(row.referralFee)}</td>
                          <td className="npc-money">{money(row.fulfillmentFee)}</td>
                          <td className="npc-money">{money(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step.id === 3 && preview && (
              <div className="npc-step-stack">
                <p className="npc-muted">
                  Expand a parent to see item-level children. Matching still uses each Item Order separately.
                </p>
                {parents.map((parent) => {
                  const open = expandedParents[parent.parentOrderId] ?? true
                  return (
                    <div key={parent.parentOrderId} className="npc-callout">
                      <button
                        type="button"
                        className="ainv-btn ainv-btn--sm"
                        onClick={() =>
                          setExpandedParents((prev) => ({
                            ...prev,
                            [parent.parentOrderId]: !open,
                          }))
                        }
                      >
                        {open ? 'Collapse' : 'Expand'} {parent.parentOrderId}
                      </button>
                      <span className="npc-muted">
                        {' '}
                        {parent.children.length} item(s) · {parent.parentCharges.length} parent charge(s) · total{' '}
                        {money(parent.totals?.total)}
                      </span>
                      {open ? (
                        <div className="npc-table-wrap" style={{ marginTop: '0.75rem' }}>
                          <table className="npc-table">
                            <thead>
                              <tr>
                                <th>Item Order</th>
                                <th>SKU</th>
                                <th>Title</th>
                                <th>Proceeds</th>
                                <th>Match</th>
                                <th>Zoho Invoice</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parent.children.map((child) => (
                                <tr key={child.itemOrderId}>
                                  <td>
                                    <code className="npc-ref">{child.itemOrderId}</code>
                                  </td>
                                  <td>{child.sku || child.partnerSku || '—'}</td>
                                  <td>{child.title || '—'}</td>
                                  <td className="npc-money">{money(child.totals?.netProceed)}</td>
                                  <td>{child.matchStatus || '—'}</td>
                                  <td>{child.zohoInvoiceNumber || '—'}</td>
                                </tr>
                              ))}
                              {parent.parentCharges.map((charge) => (
                                <tr key={`pc-${charge.rowNumber}`}>
                                  <td colSpan={2}>
                                    <strong>Parent Order Charge</strong>
                                  </td>
                                  <td>{charge.title || charge.transactionType}</td>
                                  <td className="npc-money">{money(charge.total)}</td>
                                  <td>not_applicable</td>
                                  <td>—</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}

            {step.id === 4 && preview && (
              <div className="npc-step-stack">
                <div className="npc-summary-grid">
                  <div className="ainv-summary-card">
                    <span>Matched</span>
                    <strong>{preview.matchedOrders?.length || 0}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Missing invoice</span>
                    <strong>{preview.unmatchedOrders?.length || 0}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Multiple matches</span>
                    <strong>{preview.multipleMatchItems?.length || 0}</strong>
                  </div>
                </div>
                <div className="npc-table-wrap">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Parent Order</th>
                        <th>Item Order</th>
                        <th>SKU</th>
                        <th>Status</th>
                        <th>Zoho Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(preview.matchedOrders || []), ...(preview.unmatchedOrders || []), ...(preview.multipleMatchItems || [])].map(
                        (item) => (
                          <tr key={`${item.itemOrderId}-${item.matchStatus}`}>
                            <td>
                              <code className="npc-ref">{item.parentOrderId}</code>
                            </td>
                            <td>
                              <code className="npc-ref">{item.itemOrderId}</code>
                            </td>
                            <td>{item.sku || '—'}</td>
                            <td>{item.matchStatus}</td>
                            <td>{item.zohoInvoiceNumber || '—'}</td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step.id === 5 && preview && (
              <div className="npc-step-stack">
                <p className="npc-muted">order_update / fee-only adjustments — not treated as new sales invoices.</p>
                <div className="npc-table-wrap">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Parent</th>
                        <th>Item</th>
                        <th>Type</th>
                        <th>Title</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.adjustments || []).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>
                            <code className="npc-ref">{row.parentOrderId || '—'}</code>
                          </td>
                          <td>
                            <code className="npc-ref">{row.itemOrderId || '—'}</code>
                          </td>
                          <td>{row.transactionType}</td>
                          <td>{row.title}</td>
                          <td className="npc-money">{money(row.total)}</td>
                        </tr>
                      ))}
                      {(preview.adjustments || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="npc-empty">
                            No adjustments in this statement.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step.id === 6 && preview && (
              <div className="npc-step-stack">
                <div className="npc-alert">
                  Parent Order Charges are legitimate. They are <strong>not</strong> missing invoices and are not assigned
                  to a single child invoice.
                </div>
                <div className="npc-table-wrap">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Parent Order</th>
                        <th>Charge</th>
                        <th>Fulfillment</th>
                        <th>Shipping</th>
                        <th>Total</th>
                        <th>Related children</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.parentCharges || []).map((row) => {
                        const related =
                          parents.find((p) => p.parentOrderId === row.parentOrderId)?.children.map((c) => c.itemOrderId) ||
                          []
                        return (
                          <tr key={row.rowNumber}>
                            <td>
                              <code className="npc-ref">{row.parentOrderId}</code>
                            </td>
                            <td>{row.title || 'Parent Order Charge'}</td>
                            <td className="npc-money">{money(row.fulfillmentFee)}</td>
                            <td className="npc-money">{money(row.shippingCharges)}</td>
                            <td className="npc-money">{money(row.total)}</td>
                            <td>{related.join(', ') || '—'}</td>
                          </tr>
                        )
                      })}
                      {(preview.parentCharges || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="npc-empty">
                            No parent-level charges.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step.id === 7 && preview && (
              <div className="npc-step-stack">
                <div className="npc-summary-grid">
                  <div className="ainv-summary-card">
                    <span>Item proceeds</span>
                    <strong>{money(preview.reconciliationSummary.itemOrderProceeds)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Referral fees</span>
                    <strong>{money(preview.reconciliationSummary.referralCommissionFees)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Fulfillment / shipping</span>
                    <strong>{money(preview.reconciliationSummary.fulfillmentLogisticsFees)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Parent charges</span>
                    <strong>{money(preview.reconciliationSummary.parentOrderCharges)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Statement fees</span>
                    <strong>{money(preview.reconciliationSummary.statementLevelFees)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Expected</span>
                    <strong>{money(preview.reconciliationSummary.expectedSettlement)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Calculated</span>
                    <strong>{money(preview.reconciliationSummary.calculatedSettlement)}</strong>
                  </div>
                  <div className="ainv-summary-card">
                    <span>Difference</span>
                    <strong>{money(preview.reconciliationSummary.reconciliationDifference)}</strong>
                  </div>
                </div>
                <p>
                  Status:{' '}
                  <strong>{preview.reconciliationSummary.reconciliationStatus}</strong>
                </p>
              </div>
            )}

            {step.id === 8 && preview && (
              <div className="npc-step-stack">
                {(preview.blockingIssues || []).length ? (
                  <div className="npc-alert npc-alert--error">
                    <ul>
                      {preview.blockingIssues.map((issue, idx) => (
                        <li key={`${issue.code}-${idx}`}>
                          {issue.code}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="npc-alert npc-approved-panel">Ready for approval.</div>
                )}
                <button
                  type="button"
                  className="ainv-btn ainv-btn--primary-sky"
                  disabled={!isClean || isApproved || isPosted || loading}
                  onClick={onApprove}
                >
                  {isApproved || isPosted ? 'Approved' : 'Approve settlement'}
                </button>
              </div>
            )}

            {step.id === 9 && preview && (
              <div className="npc-step-stack">
                <div className="npc-table-wrap">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Fee type</th>
                        <th>Amount</th>
                        <th>Parent</th>
                        <th>Mapping</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.feeJournalLines || []).map((line) => (
                        <tr key={line.lineIndex}>
                          <td>{line.feeType}</td>
                          <td className="npc-money">{money(line.amount)}</td>
                          <td>{line.parentOrderId || '—'}</td>
                          <td>{line.mappingStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="npc-actions">
                  <label className="ainv-label">
                    Fee type
                    <input
                      className="ainv-input"
                      value={mappingDraft.normalizedFeeType}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, normalizedFeeType: e.target.value }))}
                    />
                  </label>
                  <label className="ainv-label">
                    Debit account name
                    <input
                      className="ainv-input"
                      value={mappingDraft.debitAccountName}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, debitAccountName: e.target.value }))}
                    />
                  </label>
                  <label className="ainv-label">
                    Debit account id
                    <input
                      className="ainv-input"
                      value={mappingDraft.debitAccountId}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, debitAccountId: e.target.value }))}
                    />
                  </label>
                  <label className="ainv-label">
                    Credit account name
                    <input
                      className="ainv-input"
                      value={mappingDraft.creditAccountName}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, creditAccountName: e.target.value }))}
                    />
                  </label>
                  <label className="ainv-label">
                    Credit account id
                    <input
                      className="ainv-input"
                      value={mappingDraft.creditAccountId}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, creditAccountId: e.target.value }))}
                    />
                  </label>
                </div>
                <button type="button" className="ainv-btn" disabled={loading} onClick={onSaveMapping}>
                  Save fee mapping
                </button>
                <p className="npc-muted">{feeMappings.length} mapping rule(s) stored.</p>
              </div>
            )}

            {step.id === 10 && (
              <div className="npc-step-stack">
                <button
                  type="button"
                  className="ainv-btn ainv-btn--primary-sky"
                  disabled={(!isApproved && !isPosted) || loading}
                  onClick={onGeneratePaymentPreview}
                >
                  Generate payment preview
                </button>
                {paymentPreview ? (
                  <>
                    <div className="npc-summary-grid">
                      <div className="ainv-summary-card">
                        <span>Invoice payments</span>
                        <strong>{money(paymentPreview.summary.totalInvoicePayments)}</strong>
                      </div>
                      <div className="ainv-summary-card">
                        <span>Fees / journals</span>
                        <strong>{money(paymentPreview.summary.totalFeesJournals)}</strong>
                      </div>
                      <div className="ainv-summary-card">
                        <span>Expected settlement</span>
                        <strong>{money(paymentPreview.summary.expectedNoonSettlement)}</strong>
                      </div>
                    </div>
                    <h3>Invoice payments (item-level)</h3>
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Item Order</th>
                            <th>Parent</th>
                            <th>SKU</th>
                            <th>Zoho Invoice</th>
                            <th>Amount</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentPreview.invoicePayments.map((p) => (
                            <tr key={p.itemOrderId}>
                              <td>
                                <code className="npc-ref">{p.itemOrderId}</code>
                              </td>
                              <td>
                                <code className="npc-ref">{p.parentOrderId}</code>
                              </td>
                              <td>{p.sku || '—'}</td>
                              <td>{p.zohoInvoiceNumber}</td>
                              <td className="npc-money">{money(p.totalClearingAmount)}</td>
                              <td>{p.paymentAction}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h3>Parent-level / statement charges (journals)</h3>
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Class</th>
                            <th>Fee</th>
                            <th>Parent</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...(paymentPreview.parentLevelCharges || []),
                            ...(paymentPreview.statementLevelCharges || []),
                          ].map((line, idx) => (
                            <tr key={idx}>
                              <td>{String(line.rowClass || '')}</td>
                              <td>{String(line.feeType || '')}</td>
                              <td>{String(line.parentOrderId || '—')}</td>
                              <td className="npc-money">{money(Number(line.amount) || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="npc-muted">Approve the settlement, then generate the preview.</p>
                )}
              </div>
            )}

            {step.id === 11 && (
              <div className="npc-step-stack">
                <div className="npc-button-row">
                  <button type="button" className="ainv-btn" disabled={!paymentPreview || loading} onClick={() => onPost(true)}>
                    Dry run
                  </button>
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--danger"
                    disabled={!paymentPreview || isPosted || loading}
                    onClick={() => onPost(false)}
                  >
                    Post to Zoho
                  </button>
                  {isPosted ? (
                    <button type="button" className="ainv-btn" disabled={loading} onClick={onForceRepost}>
                      Force repost
                    </button>
                  ) : null}
                </div>
                {postingResult ? (
                  <div className="npc-alert">
                    <div>
                      Status: <strong>{postingResult.status}</strong> {postingResult.dryRun ? '(dry run)' : ''}
                    </div>
                    <div>
                      Payments created: {postingResult.summary?.paymentsCreated ?? 0}, skipped:{' '}
                      {postingResult.summary?.paymentsSkipped ?? 0}, journals:{' '}
                      {postingResult.summary?.journalsCreated ?? 0}, errors: {postingResult.summary?.errors ?? 0}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {!preview && step.id > 1 ? <p className="npc-muted">Upload or open a statement in step 1 first.</p> : null}
          </StepPanel>
        )
      })}
    </div>
  )
}

export default NoonPaymentClearingPage

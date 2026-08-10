import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  approveNoonPaymentClearingBatch,
  excludeNoonOpenBalanceShortfalls,
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
  reconcileNoonOpenBalances,
} from '../../../api/noonPaymentClearing'
import { CLEARING_STEPS, type StepStatus } from './clearingSteps'
import { ClearingStepper, StepPanel } from './components/ClearingStepper'
import { NoonFeeJournalMappingPanel } from './components/NoonFeeJournalMappingPanel'
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
  const postingResultRef = useRef<HTMLDivElement | null>(null)
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

  const isApproved =
    preview?.status === 'approved' ||
    preview?.batch?.status === 'approved' ||
    String((preview as { batch?: { status?: string } })?.batch?.status || '') === 'approved'
  const isPosted = Boolean(
    preview?.postedToZoho ||
      preview?.status === 'posted' ||
      preview?.batch?.status === 'posted' ||
      preview?.batch?.postedToZoho
  )

  // Same rules as backend validateBatchReadyForApproval — fee journal mapping is Step 9, not approval.
  const approvalBlockers = useMemo(() => {
    if (!preview) return [] as string[]
    const reasons: string[] = []
    if (preview.reconciliationSummary?.reconciliationStatus === 'mismatch') {
      reasons.push('Statement reconciliation does not balance.')
    }
    if ((preview.unmatchedOrders || []).length > 0) {
      reasons.push(`${preview.unmatchedOrders.length} item order(s) still missing a Zoho invoice.`)
    }
    if ((preview.multipleMatchItems || []).length > 0) {
      reasons.push(`${preview.multipleMatchItems.length} item order(s) matched more than one invoice.`)
    }
    for (const issue of preview.blockingIssues || []) {
      if (issue.code === 'UNEXPLAINED_OTHER') {
        reasons.push(issue.message || 'Unexplained transaction amount remains.')
      }
      if (issue.code === 'OPEN_BALANCE_SHORT') {
        reasons.push(issue.message || 'Invoice open balance is short — fix in Parent-Level Charges.')
      }
    }
    if ((preview.openBalanceShortfalls || []).length > 0) {
      reasons.push(
        `${preview.openBalanceShortfalls!.length} invoice(s) lack open Zoho balance — check Parent-Level Charges and exclude already-paid logistics.`
      )
    }
    return Array.from(new Set(reasons))
  }, [preview])
  const canApproveSettlement = Boolean(preview) && approvalBlockers.length === 0

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
    s[6] = !preview
      ? 'not_started'
      : (preview.openBalanceShortfalls || []).length > 0
        ? 'blocked'
        : 'completed'
    s[7] = !preview
      ? 'not_started'
      : preview.reconciliationSummary?.reconciliationStatus === 'mismatch'
        ? 'blocked'
        : 'completed'
    s[8] = !preview
      ? 'not_started'
      : isApproved || isPosted
        ? 'completed'
        : canApproveSettlement
          ? 'ready'
          : 'blocked'
    s[9] = !preview
      ? 'not_started'
      : (preview.feeJournalLines || []).some((l) => l.mappingStatus === 'needs_mapping')
        ? 'blocked'
        : 'ready'
    s[10] = paymentPreview ? 'completed' : isApproved || isPosted ? 'ready' : 'not_started'
    s[11] = isPosted ? 'completed' : paymentPreview ? 'ready' : 'not_started'
    return s
  }, [preview, isApproved, isPosted, canApproveSettlement, paymentPreview])

  async function onReconcileOpenBalances() {
    if (!preview?.batchId) return
    setLoading(true)
    setError('')
    setNotice('Checking live Zoho open balances…')
    try {
      const data = await reconcileNoonOpenBalances(preview.batchId)
      setPreview(data)
      const n = data.openBalanceShortfalls?.length || 0
      setNotice(
        n
          ? `Open balance check: ${n} invoice(s) need attention — exclude already-paid logistics below.`
          : 'Open balance check passed — all planned clearings fit live Zoho balances.'
      )
      goToStep(6)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onExcludeOpenBalanceShortfall(zohoInvoiceId: string) {
    if (!preview?.batchId || !zohoInvoiceId) return
    if (
      !window.confirm(
        `Exclude clearing for ${zohoInvoiceId} from Zoho payments?\n\nUse this when the invoice is already paid (orphan logistics). It will not be posted as a Record Payment.`
      )
    ) {
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await excludeNoonOpenBalanceShortfalls(preview.batchId, {
        zohoInvoiceIds: [zohoInvoiceId],
      })
      setPreview(data)
      setNotice(`Excluded ${zohoInvoiceId} from payment clearing. Re-checked open balances.`)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onExcludeAllOpenBalanceShortfalls() {
    if (!preview?.batchId) return
    const n = preview.openBalanceShortfalls?.length || 0
    if (!n) return
    if (
      !window.confirm(
        `Exclude all ${n} shortfall invoice(s) from Zoho payment clearing?\n\nUse when those invoices are already paid (orphan logistics only).`
      )
    ) {
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await excludeNoonOpenBalanceShortfalls(preview.batchId, {})
      setPreview(data)
      setNotice('Excluded shortfall invoices from payment clearing. Re-checked open balances.')
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onUpload(file: File | null | undefined) {
    if (!file) return
    setLoading(true)
    setError('')
    setNotice('Uploading statement… matching Zoho invoices in the background (avoids CloudFront timeout).')
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
      setNotice('')
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
    setNotice('Generating payment preview…')
    try {
      const pp = await generateNoonPaymentPreview(preview.batchId)
      setPaymentPreview(pp)
      setNotice('Payment preview ready.')
      goToStep(10)
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      setNotice('')
      window.alert(`Generate payment preview failed\n\n${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function onPost(dryRun: boolean) {
    if (!preview?.batchId) return
    if (!dryRun && !window.confirm('Post Noon invoice payments and fee journals to Zoho?')) return
    setLoading(true)
    setError('')
    setNotice(dryRun ? '' : 'Posting to Zoho in the background — keep this tab open until the result appears.')
    try {
      const result = await postNoonPaymentClearingToZoho(preview.batchId, dryRun)
      setPostingResult(result)
      const created = result.summary?.paymentsCreated ?? 0
      const skipped = result.summary?.paymentsSkipped ?? 0
      const journals = result.summary?.journalsCreated ?? 0
      const errors = result.summary?.errors ?? 0
      const missing = Array.isArray((result as { missingPaymentTypes?: string[] }).missingPaymentTypes)
        ? (result as { missingPaymentTypes?: string[] }).missingPaymentTypes || []
        : []
      const headline =
        result.message ||
        `${dryRun ? 'Dry run' : 'Post'} finished — payments created ${created}, skipped ${skipped}, journals ${journals}, errors ${errors}`
      if (!dryRun) {
        window.alert(
          missing.length || errors || result.success === false
            ? `FAILED / INCOMPLETE\n\n${headline}\n\nMissing: ${missing.join(', ') || 'n/a'}\nCheck Step 11 for error details.`
            : `SUCCESS\n\n${headline}\n\nYou should see 3 payment groups in Zoho: net_balance, commission, fulfillment_shipping.`
        )
        const data = await fetchNoonPaymentClearingBatch(preview.batchId)
        setPreview(data)
        if (result.success === false || errors > 0 || missing.length) {
          setError(headline)
        } else {
          setNotice(headline)
        }
      } else {
        setNotice(headline)
      }
      goToStep(11)
      requestAnimationFrame(() => {
        postingResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      window.alert(`Post failed\n\n${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function onForceRepost() {
    if (!preview?.batchId) return
    const ok = window.confirm(
      'FORCE REPOST\n\n' +
        'This clears local “already posted” flags and posts again to Zoho.\n\n' +
        'If Zoho already has Noon payments for this statement (e.g. commission #5560), ' +
        'VOID them first or you will get duplicates / amount errors.\n\n' +
        'Continue?'
    )
    if (!ok) return
    const reason = window.prompt('Force repost reason (min 4 characters)?') || ''
    if (reason.trim().length < 4) {
      window.alert('Force repost cancelled — reason must be at least 4 characters.')
      return
    }
    setLoading(true)
    setError('')
    setNotice('Force repost started — posting to Zoho in the background (may take a few minutes). Do not close this tab.')
    try {
      const result = await forceRepostNoonPaymentClearing(preview.batchId, reason.trim())
      setPostingResult(result)
      const headline = result.message || `Force repost status: ${result.status}`
      window.alert(
        result.success === false
          ? `FORCE REPOST FAILED\n\n${headline}`
          : `FORCE REPOST DONE\n\n${headline}`
      )
      const data = await fetchNoonPaymentClearingBatch(preview.batchId)
      setPreview(data)
      if (result.success === false) setError(headline)
      else setNotice(headline)
      goToStep(11)
      requestAnimationFrame(() => {
        postingResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      window.alert(`Force repost failed\n\n${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function refreshPreviewFromServer() {
    if (!preview?.batchId) return
    const refreshed = await fetchNoonPaymentClearingBatch(preview.batchId)
    setPreview(refreshed)
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
        Zoho posting is guarded. Invoice payments use <strong>item-level</strong> Noon IDs only and split to
        Undeposited (1066), Uncleared Commission (1067), and Uncleared Shipping (1068). Statement fees
        (Advertising) are journals — parent logistics fold into invoice payments, never missing invoices.
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
            blocker={
              step.id === 6 && (preview?.openBalanceShortfalls || []).length > 0
                ? `${preview!.openBalanceShortfalls!.length} invoice(s) lack open Zoho balance — exclude already-paid logistics.`
                : step.id === 8 && approvalBlockers.length
                  ? approvalBlockers[0]
                  : step.id === 9 &&
                      (preview?.feeJournalLines || []).some((l) => l.mappingStatus === 'needs_mapping')
                    ? 'Map statement fee expense accounts first (Advertising).'
                    : undefined
            }
            summary={
              collapsed && preview
                ? step.id === 4
                  ? `${preview.matchedOrders?.length || 0} matched · ${preview.unmatchedOrders?.length || 0} missing`
                  : step.id === 6
                    ? (preview.openBalanceShortfalls || []).length
                      ? `${preview.openBalanceShortfalls!.length} open-balance shortfall(s)`
                      : preview.openBalanceCheckedAt
                        ? 'Open balances OK'
                        : 'Check open balances'
                  : step.id === 7
                    ? preview.reconciliationSummary?.reconciliationStatus
                    : step.id === 8
                      ? canApproveSettlement
                        ? isApproved || isPosted
                          ? 'Approved'
                          : 'Ready to approve'
                        : approvalBlockers[0]
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
                  Parent logistics fold onto a child / Zoho invoice for Record Payment (1068). Before approve, check{' '}
                  <strong>live Zoho open balance</strong> — already-paid invoices must be excluded here, not at Force
                  repost.
                </div>
                <div className="npc-button-row">
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--primary-sky"
                    disabled={loading}
                    onClick={onReconcileOpenBalances}
                  >
                    Check open balances (Zoho)
                  </button>
                  {(preview.openBalanceShortfalls || []).length > 0 ? (
                    <button
                      type="button"
                      className="ainv-btn ainv-btn--danger"
                      disabled={loading}
                      onClick={onExcludeAllOpenBalanceShortfalls}
                    >
                      Exclude all shortfalls from payment
                    </button>
                  ) : null}
                </div>
                {preview.openBalanceCheckedAt ? (
                  <p className="npc-muted">Last checked: {preview.openBalanceCheckedAt}</p>
                ) : (
                  <p className="npc-muted">Not checked yet — run Check open balances before approving.</p>
                )}
                {(preview.openBalanceShortfalls || []).length > 0 ? (
                  <div className="npc-alert npc-alert--error" role="alert">
                    <strong>
                      {(preview.openBalanceShortfalls || []).length} invoice(s) cannot clear — open balance too low
                    </strong>
                    <div className="npc-table-wrap" style={{ marginTop: 10 }}>
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Invoice</th>
                            <th>Item / logistics</th>
                            <th>Planned clearing</th>
                            <th>Open balance</th>
                            <th>Over by</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preview.openBalanceShortfalls || []).map((s) => (
                            <tr key={`${s.zohoInvoiceId}-${s.itemOrderId}`}>
                              <td>
                                {s.zohoInvoiceNumber || '—'}
                                <div className="npc-muted">
                                  <code className="npc-ref">{s.zohoInvoiceId}</code>
                                </div>
                              </td>
                              <td>
                                <code className="npc-ref">{s.itemOrderId || '—'}</code>
                                {s.reason ? <div className="npc-muted">{s.reason}</div> : null}
                              </td>
                              <td className="npc-money">{money(s.totalClearingAmount)}</td>
                              <td className="npc-money">{money(s.openBalance)}</td>
                              <td className="npc-money">{money(s.overBy)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="ainv-btn"
                                  disabled={loading}
                                  onClick={() => onExcludeOpenBalanceShortfall(s.zohoInvoiceId)}
                                >
                                  Exclude from payment
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : preview.openBalanceCheckedAt ? (
                  <div className="npc-alert npc-approved-panel">
                    Open balances OK — planned clearings fit live Zoho balances.
                  </div>
                ) : null}

                <h3>Parent-level charges</h3>
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
                        const assigned = String(row.assignedItemOrderId || '')
                        const excluded = Boolean(row.excludeFromPaymentClearing)
                        return (
                          <tr key={row.rowNumber}>
                            <td>
                              <code className="npc-ref">{row.parentOrderId}</code>
                              {assigned ? (
                                <div className="npc-muted" style={{ marginTop: 4 }}>
                                  Cleared via: <code className="npc-ref">{assigned}</code>
                                  <br />
                                  Parent-order fallback
                                </div>
                              ) : null}
                              {excluded ? (
                                <div className="npc-muted" style={{ marginTop: 4 }}>
                                  Excluded from payment clearing (already paid)
                                </div>
                              ) : null}
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
                {isApproved || isPosted ? (
                  <div className="npc-alert npc-approved-panel">Settlement approved.</div>
                ) : approvalBlockers.length ? (
                  <div className="npc-alert npc-alert--error">
                    <p>Cannot approve yet:</p>
                    <ul>
                      {approvalBlockers.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="npc-alert npc-approved-panel">
                    Ready for approval. Fee account mapping is the next step — it does not block approval.
                  </div>
                )}
                <button
                  type="button"
                  className="ainv-btn ainv-btn--primary-sky"
                  disabled={!canApproveSettlement || isApproved || isPosted || loading}
                  onClick={onApprove}
                >
                  {isApproved || isPosted ? 'Approved' : 'Approve settlement'}
                </button>
              </div>
            )}

            {step.id === 9 && preview && (
              <NoonFeeJournalMappingPanel preview={preview} onPreviewRefresh={refreshPreviewFromServer} />
            )}

            {step.id === 10 && (
              <div className="npc-step-stack">
                {error ? (
                  <div className="npc-alert npc-alert--error" role="alert">
                    {error}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="ainv-btn ainv-btn--primary-sky"
                  disabled={(!isApproved && !isPosted) || loading}
                  onClick={onGeneratePaymentPreview}
                >
                  {loading ? 'Generating…' : 'Generate payment preview'}
                </button>
                {!isApproved && !isPosted ? (
                  <p className="npc-muted">
                    Statement is not approved yet (status: {String(preview?.status || preview?.batch?.status || '—')}).
                    Go to <strong>Step 8</strong> and click Approve settlement.
                  </p>
                ) : !paymentPreview ? (
                  <p className="npc-muted">
                    Settlement is approved. Click <strong>Generate payment preview</strong> above.
                  </p>
                ) : null}
                {paymentPreview ? (
                  <>
                    <div className="npc-summary-grid">
                      <div className="ainv-summary-card">
                        <span>Invoice payments</span>
                        <strong>{money(paymentPreview.summary.totalInvoicePayments)}</strong>
                      </div>
                      <div className="ainv-summary-card">
                        <span>Statement fee journals</span>
                        <strong>{money(paymentPreview.summary.totalFeesJournals)}</strong>
                      </div>
                      <div className="ainv-summary-card">
                        <span>Expected settlement</span>
                        <strong>{money(paymentPreview.summary.expectedNoonSettlement)}</strong>
                      </div>
                    </div>
                    <h3>Invoice payments (Net 1066 / Commission 1067 / Shipping 1068)</h3>
                    <p className="npc-muted">
                      Noon CSV &quot;Net Proceeds&quot; is invoice gross. 1066 gets the residual after commission and
                      shipping (e.g. 759 − 119.54 − 33.60 = 605.86). Zoho gets exactly three grouped payments
                      (net / commission / shipping) — not one payment per invoice line.
                    </p>
                    {paymentPreview.summary?.blocked ||
                    (paymentPreview.summary?.invoiceOverpaymentCount ?? 0) > 0 ? (
                      <div className="npc-alert npc-alert--error" role="alert">
                        Blocked: payment totals exceed Zoho invoice value on{' '}
                        {paymentPreview.summary.invoiceOverpaymentCount} invoice(s). Fix matching / logistics
                        before posting.
                      </div>
                    ) : null}
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Item Order</th>
                            <th>Zoho Invoice</th>
                            <th>Net undeposited (1066)</th>
                            <th>Commission (1067)</th>
                            <th>Shipping / Fulfillment (1068)</th>
                            <th>Total (must = invoice)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentPreview.invoicePayments.map((p) => (
                            <tr key={p.itemOrderId}>
                              <td>
                                <code className="npc-ref">{p.itemOrderId}</code>
                                {p.parentLogisticsAddOn ? (
                                  <div className="npc-muted">
                                    incl. parent/adj logistics {money(p.parentLogisticsAddOn)}
                                    {Array.isArray(p.parentLogisticsSources) && p.parentLogisticsSources[0]
                                      ? ` (row ${p.parentLogisticsSources[0].rowNumber}: total ${money(p.parentLogisticsSources[0].total)})`
                                      : ''}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {p.zohoInvoiceNumber}
                                {p.invoiceTotal != null ? (
                                  <div className="npc-muted">{money(p.invoiceTotal)}</div>
                                ) : null}
                              </td>
                              <td className="npc-money">
                                {money(p.netBalancePayment?.amount ?? p.invoiceClearingNetBalance)}
                              </td>
                              <td className="npc-money">
                                {money(p.commissionPayment?.amount ?? p.referralFee)}
                              </td>
                              <td className="npc-money">
                                {money(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping)}
                              </td>
                              <td className="npc-money">{money(p.totalClearingAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h3>Parent / adjustment logistics (folded into invoice payments → uncleared)</h3>
                    <p className="npc-muted">
                      Parent shipping lines with no sale in this statement are matched to existing Noon Zoho
                      invoices by order id (no Excel upload). &quot;No child assignment&quot; means Zoho also has no
                      invoice for that Noon parent order.
                    </p>
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Charge</th>
                            <th>Amount</th>
                            <th>Clearing detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...(paymentPreview.parentLevelCharges || []),
                            ...(paymentPreview.adjustmentClearings || []).filter(
                              (line) => line.clearingPath === 'invoice_payment_uncleared'
                            ),
                          ].map((line, idx) => (
                            <tr key={`folded-${idx}`}>
                              <td>
                                <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                                {line.accountingTreatment ? (
                                  <div className="npc-muted">{String(line.accountingTreatment)}</div>
                                ) : null}
                              </td>
                              <td className="npc-money">
                                {money(Number(line.signedAmount != null ? line.signedAmount : line.amount) || 0)}
                              </td>
                              <td>
                                {line.previewNote ? (
                                  <span className="npc-muted">{String(line.previewNote)}</span>
                                ) : (
                                  String(line.parentOrderId || '—')
                                )}
                              </td>
                            </tr>
                          ))}
                          {(paymentPreview.parentLevelCharges || []).length === 0 &&
                          (paymentPreview.adjustmentClearings || []).filter(
                            (line) => line.clearingPath === 'invoice_payment_uncleared'
                          ).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="npc-empty">
                                No parent/adjustment logistics folded into payments.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <h3>Uncleared → expense reclass (same post)</h3>
                    <p className="npc-muted">
                      After payments park amounts on 1067 / 1068, journals move them to Commission Exp (2143) /
                      Shipping Exp (2162) and Input VAT (1085).
                    </p>
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Reclass</th>
                            <th>Gross / Expense after VAT / Input VAT</th>
                            <th>Journal</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(paymentPreview.unclearedReclassJournals || []).map((line, idx) => (
                            <tr key={`reclass-${idx}`}>
                              <td>
                                <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                              </td>
                              <td className="npc-money">
                                <div>Gross: {money(line.grossInclVat ?? line.signedAmount)}</div>
                                <div>Expense after VAT: {money(line.netExpense)}</div>
                                <div>Input VAT 5%: {money(line.inputVatAmount)}</div>
                              </td>
                              <td>
                                {line.accountingPreview?.lines && line.accountingPreview.lines.length > 0 ? (
                                  <div className="npc-muted">
                                    {line.accountingPreview.lines.map((jl: { debitOrCredit?: string; accountName?: string; amount?: number }, i: number) => (
                                      <div key={`${idx}-${i}`}>
                                        {String(jl.debitOrCredit || '').toUpperCase()}: {String(jl.accountName || '—')}{' '}
                                        {money(jl.amount)}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>{line.mappingStatus === 'mapped' ? 'Ready' : 'Needs accounts'}</td>
                            </tr>
                          ))}
                          {(paymentPreview.unclearedReclassJournals || []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="npc-empty">
                                No uncleared commission/shipping to reclass.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <h3>Statement fee journals (Advertising etc.)</h3>
                    <div className="npc-table-wrap">
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Charge</th>
                            <th>Amount</th>
                            <th>Clearing detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(paymentPreview.statementLevelCharges || []).map((line, idx) => (
                            <tr key={`stmt-${idx}`}>
                              <td>
                                <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                                {line.accountingTreatment ? (
                                  <div className="npc-muted">{String(line.accountingTreatment)}</div>
                                ) : null}
                              </td>
                              <td className="npc-money">
                                {money(Number(line.signedAmount != null ? line.signedAmount : line.amount) || 0)}
                              </td>
                              <td>
                                {line.previewNote ? (
                                  <span className="npc-muted">{String(line.previewNote)}</span>
                                ) : (
                                  'Fee journal vs Undeposited Funds'
                                )}
                              </td>
                            </tr>
                          ))}
                          {(paymentPreview.statementLevelCharges || []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="npc-empty">
                                No statement fee journals.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {step.id === 11 && (
              <div className="npc-step-stack">
                {paymentPreview?.unclearedReclassJournals?.length ? (
                  <div className="npc-alert npc-approved-panel">
                    <strong>This post will also clear uncleared balances into expense + VAT</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem' }}>
                      {paymentPreview.unclearedReclassJournals.map((line, idx) => (
                        <li key={`will-reclass-${idx}`}>
                          {String(line.displayLabel || line.feeType)} — Gross {money(Number(line.amount) || 0)},
                          expense after VAT {money(Number(line.netExpense) || 0)}, Input VAT{' '}
                          {money(Number(line.inputVatAmount) || 0)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="npc-alert npc-alert--error">
                    No uncleared→expense reclass journals in the payment preview. Hard-refresh, then click{' '}
                    <strong>Generate payment preview</strong> on Step 10 again.
                  </div>
                )}
                <div className="npc-button-row">
                  <button
                    type="button"
                    className="ainv-btn"
                    disabled={!paymentPreview || loading || Boolean(paymentPreview.summary?.blocked)}
                    onClick={() => onPost(true)}
                  >
                    Dry run
                  </button>
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--danger"
                    disabled={
                      !paymentPreview || isPosted || loading || Boolean(paymentPreview.summary?.blocked)
                    }
                    onClick={() => onPost(false)}
                  >
                    {postingResult && postingResult.success === false ? 'Retry post to Zoho' : 'Post to Zoho'}
                  </button>
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--danger"
                    disabled={
                      !paymentPreview ||
                      loading ||
                      (!isApproved && !isPosted) ||
                      Boolean(paymentPreview.summary?.blocked)
                    }
                    onClick={onForceRepost}
                    title="Clears local already-posted flags and posts all three payment buckets again"
                  >
                    Force repost
                  </button>
                </div>
                <p className="npc-muted" style={{ marginTop: 8 }}>
                  Stuck because a payment or journal shows <strong>skipped</strong>? Void those Noon entries in
                  Zoho for this statement, then use <strong>Force repost</strong> (clears local already-posted
                  flags and posts all three payment buckets + journals again).
                </p>
                {postingResult ? (
                  <div
                    className={`npc-alert ${
                      postingResult.success === false || (postingResult.summary?.errors ?? 0) > 0
                        ? 'npc-alert--error'
                        : 'npc-approved-panel'
                    }`}
                    ref={postingResultRef}
                    role="status"
                  >
                    <div>
                      Status: <strong>{postingResult.status}</strong> {postingResult.dryRun ? '(dry run)' : ''}
                    </div>
                    {postingResult.message ? <div style={{ marginTop: 6 }}>{postingResult.message}</div> : null}
                    <div style={{ marginTop: 6 }}>
                      Payments: {postingResult.summary?.paymentsCreated ?? 0}
                      {postingResult.dryRun ? ' (preview)' : ' created'}, skipped:{' '}
                      {postingResult.summary?.paymentsSkipped ?? 0}, journals:{' '}
                      {postingResult.summary?.journalsCreated ?? 0}
                      {postingResult.dryRun ? ' (preview)' : ''}, errors:{' '}
                      {postingResult.summary?.errors ?? 0}
                    </div>
                    {Array.isArray((postingResult as { missingPaymentTypes?: string[] }).missingPaymentTypes) &&
                    ((postingResult as { missingPaymentTypes?: string[] }).missingPaymentTypes || []).length > 0 ? (
                      <div style={{ marginTop: 6 }}>
                        Missing payment types:{' '}
                        <strong>
                          {((postingResult as { missingPaymentTypes?: string[] }).missingPaymentTypes || []).join(', ')}
                        </strong>
                      </div>
                    ) : null}
                    {(postingResult.errors || []).length > 0 ? (
                      <div className="npc-alert npc-alert--error" style={{ marginTop: 8 }}>
                        <strong>Errors</strong>
                        <ul>
                          {(postingResult.errors || []).map((err, idx) => (
                            <li key={`err-${idx}`}>
                              {String(err.displayLabel || err.paymentType || err.feeType || 'item')}:{' '}
                              {String(err.error || 'failed')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {(postingResult.payments || []).length > 0 ? (
                      <div className="npc-table-wrap" style={{ marginTop: 12 }}>
                        <table className="npc-table">
                          <thead>
                            <tr>
                              <th>Payment type</th>
                              <th>Amount</th>
                              <th>Deposit account</th>
                              <th>Invoices</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {postingResult.payments.map((p, idx) => (
                              <tr key={`pay-${idx}`}>
                                <td>{String(p.paymentType || '')}</td>
                                <td className="npc-money">{money(p.amount as number)}</td>
                                <td>
                                  {String(p.accountName || '')}
                                  {p.accountCode ? ` (${String(p.accountCode)})` : ''}
                                </td>
                                <td>{Array.isArray(p.invoiceAllocations) ? p.invoiceAllocations.length : 0}</td>
                                <td>
                                  {String(p.status || '')}
                                  {p.reason ? <div className="npc-muted">{String(p.reason)}</div> : null}
                                  {p.error ? <div className="npc-muted">Error: {String(p.error)}</div> : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="npc-muted" style={{ marginTop: 8 }}>
                        No invoice payment groups in this dry run (missing Zoho invoice IDs or zero amounts).
                      </p>
                    )}
                    <h3 style={{ marginTop: 16 }}>Journals (advertising + uncleared → expense)</h3>
                    {(postingResult.journals || []).length > 0 ? (
                      <div className="npc-table-wrap">
                        <table className="npc-table">
                          <thead>
                            <tr>
                              <th>Journal</th>
                              <th>Lines</th>
                              <th>Gross</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {postingResult.journals.map((j, idx) => {
                              const lines =
                                (Array.isArray(j.zohoPayloadPreview?.line_items) &&
                                  j.zohoPayloadPreview.line_items) ||
                                (Array.isArray(j.lineItems) && j.lineItems) ||
                                (Array.isArray(j.accountingPreview?.lines) && j.accountingPreview.lines) ||
                                []
                              return (
                                <tr key={`j-${idx}`}>
                                  <td>
                                    <strong>{String(j.displayLabel || j.feeType || j.paymentType || '')}</strong>
                                    {j.isUnclearedReclass ? (
                                      <div className="npc-muted">Uncleared → expense + Input VAT</div>
                                    ) : null}
                                    {j.warning ? (
                                      <div className="npc-muted">Warning: {String(j.warning)}</div>
                                    ) : null}
                                    {j.error ? <div className="npc-muted">Error: {String(j.error)}</div> : null}
                                  </td>
                                  <td>
                                    {lines.length ? (
                                      <div className="npc-muted">
                                        {lines.map((jl: Record<string, unknown>, i: number) => (
                                          <div key={`${idx}-line-${i}`}>
                                            {String(
                                              jl.debit_or_credit || jl.debitOrCredit || ''
                                            ).toUpperCase()}
                                            : {String(jl.account_name || jl.accountName || '—')}
                                            {jl.account_code || jl.accountCode
                                              ? ` (${String(jl.account_code || jl.accountCode)})`
                                              : ''}{' '}
                                            {money(Number(jl.amount) || 0)}
                                          </div>
                                        ))}
                                      </div>
                                    ) : j.isUnclearedReclass ? (
                                      <div className="npc-muted">
                                        Exp {money(Number(j.netExpense) || 0)} + VAT{' '}
                                        {money(Number(j.inputVatAmount) || 0)} / Cr uncleared{' '}
                                        {money(Number(j.amount) || 0)}
                                      </div>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="npc-money">
                                    {money(Number(j.signedAmount != null ? j.signedAmount : j.amount) || 0)}
                                  </td>
                                  <td>
                                    {String(j.status || '')}
                                    {j.reason ? (
                                      <div className="npc-muted">{String(j.reason)}</div>
                                    ) : null}
                                    {j.zohoJournalId ? (
                                      <div className="npc-muted">Zoho #{String(j.zohoJournalId)}</div>
                                    ) : null}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="npc-muted">No journals in this dry run.</p>
                    )}
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

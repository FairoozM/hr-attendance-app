import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  approveNoonPaymentClearingBatch,
  excludeNoonOpenBalanceShortfalls,
  fetchNoonPaymentClearingBatch,
  fetchNoonReturnFeePlan,
  fetchNoonSavedBatches,
  fetchNoonZohoCustomers,
  forceRepostNoonPaymentClearing,
  generateNoonPaymentPreview,
  refreshNoonReturnMatching,
  type NoonPaymentClearingPreview,
  type NoonPaymentPreview,
  type NoonPostingResult,
  type NoonReturnFeePlan,
  type NoonSavedBatchSummary,
  postNoonPaymentClearingToZoho,
  previewNoonStatementUpload,
  reconcileNoonOpenBalances,
} from '../../../api/noonPaymentClearing'
import { CLEARING_STEPS, type StepStatus } from './clearingSteps'
import { ClearingStepper, StepPanel } from './components/ClearingStepper'
import { NoonFeeJournalMappingPanel } from './components/NoonFeeJournalMappingPanel'
import { NoonReturnClearingStep } from './components/NoonReturnClearingStep'
import { NoonReturnsStep } from './components/NoonReturnsStep'
import './NoonPaymentClearingPage.css'

const STEP_KEY_TO_ID = new Map(CLEARING_STEPS.map((s) => [s.key, s.id]))
const STEP_ID_TO_KEY = new Map(CLEARING_STEPS.map((s) => [s.id, s.key]))
const BASE = '/management/noon-payment-clearing'

function money(value: number | undefined | null) {
  const n = Number(value) || 0
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeError(err: unknown) {
  const msg =
    err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : 'Something went wrong'
  return msg
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
  const [returnFeePlan, setReturnFeePlan] = useState<NoonReturnFeePlan | null>(null)
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({})
  const [showSettlementAdjustmentDetail, setShowSettlementAdjustmentDetail] = useState(false)
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

  const returnRowCount = useMemo(
    () => preview?.refundReturnRows?.length ?? preview?.totals?.returnRowCount ?? 0,
    [preview?.refundReturnRows, preview?.totals?.returnRowCount]
  )
  const returnBlockerCount = useMemo(() => {
    const blocking = preview?.creditNoteBlockingRows?.length ?? 0
    const fromIssues = (preview?.blockingIssues || []).filter((i) =>
      String(i.code || '').startsWith('RETURN_')
    ).length
    return Math.max(blocking, fromIssues)
  }, [preview?.creditNoteBlockingRows, preview?.blockingIssues])

  // Same rules as backend validateBatchReadyForApproval — fee journal mapping is Step 10, not approval.
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
    for (const row of preview.creditNoteBlockingRows || []) {
      if (row.blockCode) {
        reasons.push(row.blockingReason || row.blockCode)
      }
    }
    for (const issue of preview.blockingIssues || []) {
      if (issue.code === 'UNEXPLAINED_OTHER') {
        reasons.push(issue.message || 'Unexplained transaction amount remains.')
      }
      if (issue.code === 'OPEN_BALANCE_SHORT') {
        reasons.push(issue.message || 'Invoice open balance is short — fix in Parent-Level Charges.')
      }
      if (String(issue.code || '').startsWith('RETURN_')) {
        reasons.push(issue.message || issue.code || 'Return credit note blocker.')
      }
    }
    if ((preview.openBalanceShortfalls || []).length > 0) {
      reasons.push(
        `${preview.openBalanceShortfalls!.length} invoice(s) lack open Zoho balance — go to Step 7 and exclude already-paid logistics.`
      )
    }
    if (!preview.openBalanceCheckedAt) {
      reasons.push('Run "Check open balances (Zoho)" in Step 7 before approving.')
    }
    return Array.from(new Set(reasons))
  }, [preview])

  // Blocking rows first, then the ones already excluded — excluded rows stay on screen.
  const openBalanceRows = useMemo(() => {
    const blocking = (preview?.openBalanceShortfalls || []).map((s) => ({ ...s, excluded: false }))
    const excludedKeys = new Set(blocking.map((s) => `${s.zohoInvoiceId}|${s.itemOrderId}`))
    const excluded = (preview?.openBalanceExcluded || [])
      .filter((s) => !excludedKeys.has(`${s.zohoInvoiceId}|${s.itemOrderId}`))
      .map((s) => ({ ...s, excluded: true }))
    return [...blocking, ...excluded]
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
    s[5] = !preview
      ? 'not_started'
      : returnRowCount === 0
        ? 'completed'
        : returnBlockerCount > 0
          ? 'blocked'
          : 'completed'
    s[6] = preview ? 'completed' : 'not_started'
    s[7] = !preview
      ? 'not_started'
      : (preview.openBalanceShortfalls || []).length > 0
        ? 'blocked'
        : 'completed'
    s[8] = !preview
      ? 'not_started'
      : preview.reconciliationSummary?.reconciliationStatus === 'mismatch'
        ? 'blocked'
        : 'completed'
    s[9] = !preview
      ? 'not_started'
      : isApproved || isPosted
        ? 'completed'
        : canApproveSettlement
          ? 'ready'
          : 'blocked'
    s[10] = !preview
      ? 'not_started'
      : (preview.feeJournalLines || []).some((l) => l.mappingStatus === 'needs_mapping')
        ? 'blocked'
        : 'ready'
    s[11] = !paymentPreview
      ? isApproved || isPosted
        ? 'ready'
        : 'not_started'
      : paymentPreview.summary?.blocked
        ? 'blocked'
        : 'completed'
    s[12] = isPosted
      ? 'completed'
      : paymentPreview
        ? paymentPreview.summary?.blocked
          ? 'blocked'
          : 'ready'
        : 'not_started'
    s[13] =
      returnRowCount === 0
        ? 'completed'
        : !isPosted
          ? 'not_started'
          : paymentPreview?.summary?.returnBlocked
            ? 'blocked'
            : returnFeePlan?.creditNoteApplyComplete && returnFeePlan?.returnFeePostComplete
              ? 'completed'
              : 'ready'
    return s
  }, [
    preview,
    isApproved,
    isPosted,
    canApproveSettlement,
    paymentPreview,
    returnRowCount,
    returnBlockerCount,
    returnFeePlan,
  ])

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
      goToStep(7)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onExcludeOpenBalanceShortfall(zohoInvoiceId: string, itemOrderId?: string) {
    if (!preview?.batchId || !(zohoInvoiceId || itemOrderId)) return
    setLoading(true)
    setError('')
    try {
      const data = await excludeNoonOpenBalanceShortfalls(preview.batchId, {
        zohoInvoiceIds: zohoInvoiceId ? [zohoInvoiceId] : [],
        itemOrderIds: itemOrderId ? [itemOrderId] : [],
      })
      setPreview(data)
      setNotice(`Excluded ${zohoInvoiceId || itemOrderId} from payment clearing.`)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onRestoreOpenBalanceShortfall(zohoInvoiceId: string, itemOrderId?: string) {
    if (!preview?.batchId || !(zohoInvoiceId || itemOrderId)) return
    setLoading(true)
    setError('')
    try {
      const data = await excludeNoonOpenBalanceShortfalls(preview.batchId, {
        zohoInvoiceIds: zohoInvoiceId ? [zohoInvoiceId] : [],
        itemOrderIds: itemOrderId ? [itemOrderId] : [],
        restore: true,
      })
      setPreview(data)
      setNotice(`Restored ${zohoInvoiceId || itemOrderId} into payment clearing.`)
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
      setNotice('Excluded shortfall invoices from payment clearing.')
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
      const data = await previewNoonStatementUpload(file, zohoCustomerName, {
        onProgress: (step) => setNotice(`Uploading… ${step}`),
      })
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
      goToStep(10)
      setNotice('Statement approved. Map fee journals, then generate payment preview.')
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      window.alert(`Approve failed\n\n${msg}`)
      await recoverFromOpenBalanceBlock(msg)
    } finally {
      setLoading(false)
    }
  }

  async function onGeneratePaymentPreview() {
    if (!preview?.batchId) return
    setLoading(true)
    setError('')
    setNotice('Generating payment preview in the background — keep this tab open…')
    try {
      const pp = await generateNoonPaymentPreview(preview.batchId)
      setPaymentPreview(pp)
      const refreshed = await fetchNoonPaymentClearingBatch(preview.batchId)
      setPreview(refreshed)
      setNotice('Payment preview ready.')
      goToStep(11)
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      setNotice('')
      window.alert(`Generate payment preview failed\n\n${msg}`)
      await recoverFromOpenBalanceBlock(msg)
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
            ? `FAILED / INCOMPLETE\n\n${headline}\n\nMissing: ${missing.join(', ') || 'n/a'}\nCheck Step 12 for error details.`
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
      const hasReturns = (paymentPreview?.returns?.length ?? returnRowCount) > 0
      goToStep(dryRun ? 12 : hasReturns && !missing.length && !errors && result.success !== false ? 13 : 12)
      requestAnimationFrame(() => {
        postingResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      window.alert(`Post failed\n\n${msg}`)
      await recoverFromOpenBalanceBlock(msg)
    } finally {
      setLoading(false)
    }
  }

  const refreshReturnFeePlan = useCallback(async (batchId: string | number) => {
    const plan = await fetchNoonReturnFeePlan(batchId)
    setReturnFeePlan(plan)
    return plan
  }, [])

  useEffect(() => {
    if (activeStep !== 13 || preview?.batchId == null) return
    if (returnRowCount === 0) {
      setReturnFeePlan(null)
      return
    }
    let cancelled = false
    refreshReturnFeePlan(preview.batchId).catch((err) => {
      if (!cancelled) setError(safeError(err))
    })
    return () => {
      cancelled = true
    }
  }, [activeStep, preview?.batchId, returnRowCount, refreshReturnFeePlan])

  useEffect(() => {
    if ((activeStep !== 10 && activeStep !== 11) || !preview?.batchId) return
    let cancelled = false
    refreshPreviewFromServer().catch((err) => {
      if (!cancelled) setError(safeError(err))
    })
    return () => {
      cancelled = true
    }
  }, [activeStep, preview?.batchId])

  /** Open-balance blocks are rectified in Step 7 — take the user there with fresh data. */
  async function recoverFromOpenBalanceBlock(msg: string) {
    const isBalanceIssue =
      msg.includes('open Zoho balance') ||
      msg.includes('open-balance check') ||
      msg.includes('Check open balances')
    if (!preview?.batchId || !isBalanceIssue) return
    try {
      const data = await fetchNoonPaymentClearingBatch(preview.batchId)
      setPreview(data)
      goToStep(7)
      setNotice('Blocked invoices are listed below — exclude the already-paid ones, or void their Zoho payments, then retry.')
    } catch {
      /* keep the alert error visible */
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
      goToStep(12)
      requestAnimationFrame(() => {
        postingResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      const msg = safeError(err)
      setError(msg)
      window.alert(`Force repost failed\n\n${msg}`)
      await recoverFromOpenBalanceBlock(msg)
    } finally {
      setLoading(false)
    }
  }

  async function onRefreshReturns() {
    if (!preview?.batchId) return
    setLoading(true)
    setError('')
    setNotice('Refreshing return credit note matching from Zoho…')
    try {
      const data = await refreshNoonReturnMatching(preview.batchId)
      setPreview(data)
      setNotice('Return matching refreshed.')
    } catch (err) {
      setError(safeError(err))
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
              step.id === 7 && (preview?.openBalanceShortfalls || []).length > 0
                ? `${preview!.openBalanceShortfalls!.length} invoice(s) lack open Zoho balance — exclude already-paid logistics.`
                : step.id === 5 && returnBlockerCount > 0
                  ? `${returnBlockerCount} return(s) need a matched Zoho Credit Note.`
                  : step.id === 9 && approvalBlockers.length
                    ? approvalBlockers[0]
                    : step.id === 10 &&
                        (preview?.feeJournalLines || []).some((l) => l.mappingStatus === 'needs_mapping')
                      ? 'Map statement fee expense accounts first (Advertising).'
                      : undefined
            }
            summary={
              collapsed && preview
                ? step.id === 4
                  ? `${preview.matchedOrders?.length || 0} matched · ${preview.unmatchedOrders?.length || 0} missing`
                  : step.id === 5
                    ? returnRowCount === 0
                      ? 'No returns'
                      : returnBlockerCount > 0
                        ? `${returnBlockerCount} blocker(s)`
                        : `${(preview.matchedReturns || []).filter((r) => r.status === 'matched').length} matched CN`
                  : step.id === 7
                    ? (preview.openBalanceShortfalls || []).length
                      ? `${preview.openBalanceShortfalls!.length} open-balance shortfall(s)`
                      : (preview.openBalanceExcluded || []).length
                        ? `${preview.openBalanceExcluded!.length} excluded from payment`
                        : preview.openBalanceCheckedAt
                          ? 'Open balances OK'
                          : 'Check open balances'
                  : step.id === 8
                    ? preview.reconciliationSummary?.reconciliationStatus
                    : step.id === 9
                      ? canApproveSettlement
                        ? isApproved || isPosted
                          ? 'Approved'
                          : 'Ready to approve'
                        : approvalBlockers[0]
                      : step.id === 13
                        ? returnRowCount === 0
                          ? 'N/A'
                          : returnFeePlan?.returnFeePostComplete
                            ? 'Complete'
                            : returnFeePlan?.creditNoteApplyComplete
                              ? 'CN refunds done'
                              : isPosted
                                ? 'Ready'
                                : 'After post'
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
              <NoonReturnsStep preview={preview} loading={loading} onRefresh={onRefreshReturns} />
            )}

            {step.id === 6 && preview && (
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

            {step.id === 7 && preview && (
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
                {openBalanceRows.length > 0 ? (
                  <div
                    className={
                      (preview.openBalanceShortfalls || []).length
                        ? 'npc-alert npc-alert--error'
                        : 'npc-alert'
                    }
                    role={(preview.openBalanceShortfalls || []).length ? 'alert' : undefined}
                  >
                    <strong>
                      {(preview.openBalanceShortfalls || []).length
                        ? `${(preview.openBalanceShortfalls || []).length} invoice(s) cannot clear — open balance too low`
                        : 'All open-balance issues excluded — nothing blocking'}
                    </strong>
                    {(preview.openBalanceExcluded || []).length ? (
                      <div className="npc-muted">
                        {(preview.openBalanceExcluded || []).length} excluded invoice(s) stay listed below — they
                        will not be posted as Record Payments.
                      </div>
                    ) : null}
                    <div className="npc-table-wrap" style={{ marginTop: 10 }}>
                      <table className="npc-table">
                        <thead>
                          <tr>
                            <th>Invoice</th>
                            <th>Item / logistics</th>
                            <th>Planned clearing</th>
                            <th>Open balance</th>
                            <th>Over by</th>
                            <th>Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openBalanceRows.map((s) => (
                            <tr
                              key={`${s.zohoInvoiceId}-${s.itemOrderId}`}
                              className={s.excluded ? 'npc-row-muted' : undefined}
                            >
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
                                {s.excluded ? (
                                  <span className="npc-badge npc-badge--muted">Excluded — not paid</span>
                                ) : (
                                  <span className="npc-badge npc-badge--error">Blocking</span>
                                )}
                              </td>
                              <td>
                                {s.excluded ? (
                                  <button
                                    type="button"
                                    className="ainv-btn"
                                    disabled={loading}
                                    onClick={() => onRestoreOpenBalanceShortfall(s.zohoInvoiceId, s.itemOrderId)}
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="ainv-btn"
                                    disabled={loading}
                                    onClick={() => onExcludeOpenBalanceShortfall(s.zohoInvoiceId, s.itemOrderId)}
                                  >
                                    Exclude from payment
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : preview.openBalanceCheckedAt ? (
                  preview.openBalanceCheckWarning ? (
                    <div className="npc-alert" role="alert">
                      Open balance check incomplete: {preview.openBalanceCheckWarning}
                    </div>
                  ) : (
                    <div className="npc-alert npc-approved-panel">
                      Open balances OK — planned clearings fit live Zoho balances.
                    </div>
                  )
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

            {step.id === 8 && preview && (
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

            {step.id === 9 && preview && (
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

            {step.id === 10 && preview && (
              <NoonFeeJournalMappingPanel preview={preview} onPreviewRefresh={refreshPreviewFromServer} />
            )}

            {step.id === 11 && (
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
                    Go to <strong>Step 9</strong> and click Approve settlement.
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
                      {paymentPreview.summary.targetUndeposited1066 != null ? (
                        <div className="ainv-summary-card">
                          <span>Undeposited target (1066, pre-advertising)</span>
                          <strong>{money(paymentPreview.summary.targetUndeposited1066)}</strong>
                          <div className="npc-muted">
                            planned {money(paymentPreview.summary.plannedUndeposited1066)}
                          </div>
                        </div>
                      ) : null}
                      {(paymentPreview.summary.settlementAdjustmentLineCount ?? 0) > 0 ? (
                        <div className="ainv-summary-card">
                          <span>Settlement adjustment journal (1066)</span>
                          <strong>{money(paymentPreview.summary.settlementAdjustment1066)}</strong>
                          <div className="npc-muted">
                            {paymentPreview.summary.settlementAdjustmentLineCount ?? 0} source row(s) · gross −
                            {money(paymentPreview.summary.settlementAdjustmentGrossNegative)} / +
                            {money(paymentPreview.summary.settlementAdjustmentGrossPositive)}
                          </div>
                        </div>
                      ) : null}
                      {(paymentPreview.summary.paidInvoiceSubsidyLineCount ?? 0) > 0 ? (
                        <div className="ainv-summary-card">
                          <span>Paid-invoice subsidies (in adjustment journal)</span>
                          <strong>{money(paymentPreview.summary.paidInvoiceSubsidy1066)}</strong>
                          <div className="npc-muted">
                            {paymentPreview.summary.paidInvoiceSubsidyLineCount ?? 0} line(s) · Dr 1066 / Cr expense
                          </div>
                        </div>
                      ) : null}
                      {(paymentPreview.summary.undepositedSettlementBridgeAmount ?? 0) > 0 ? (
                        <div className="ainv-summary-card">
                          <span>Settlement bridge Cr 1066</span>
                          <strong>{money(paymentPreview.summary.undepositedSettlementBridgeAmount)}</strong>
                          <div className="npc-muted">unexpected — cross-week charges should use adjustment journal</div>
                        </div>
                      ) : null}
                      {(paymentPreview.summary.inStatementShippingToUncleared ?? 0) > 0 ? (
                        <>
                          <div className="ainv-summary-card">
                            <span>In-statement shipping → 1068 (uncleared)</span>
                            <strong>{money(paymentPreview.summary.inStatementShippingToUncleared)}</strong>
                            <div className="npc-muted">
                              {paymentPreview.summary.inStatementShippingLineCount ?? 0} invoice line(s) · reclass
                              journal gross {money(paymentPreview.summary.shippingReclassJournalGross)}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                    {(paymentPreview.summary.returnRowCount ?? 0) > 0 ? (
                      <>
                        <h3>Returns &amp; return fee reversals</h3>
                        {paymentPreview.summary.returnBlocked ? (
                          <div className="npc-alert npc-alert--error" role="alert">
                            RETURN BLOCKED — matched Credit Note required before posting (
                            {(paymentPreview.creditNoteBlockingRows || [])[0]?.blockCode || 'RETURN_CREDIT_NOTE_MISSING'}
                            ).
                          </div>
                        ) : null}
                        <div className="npc-summary-grid">
                          <div className="ainv-summary-card">
                            <span>Product refund (CN → 1066)</span>
                            <strong>{money(paymentPreview.summary.returnPrincipal1066)}</strong>
                          </div>
                          <div className="ainv-summary-card">
                            <span>Commission reversal (1066)</span>
                            <strong>{money(paymentPreview.summary.returnFeeReversal1066)}</strong>
                          </div>
                        </div>
                        <div className="npc-table-wrap">
                          <table className="npc-table">
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Refund</th>
                                <th>Comm. gross</th>
                                <th>Comm. net</th>
                                <th>VAT</th>
                                <th>Net settlement</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(paymentPreview.returns || []).map((row) => (
                                <tr key={`pv-ret-${row.itemOrderId}`}>
                                  <td>
                                    <code className="npc-ref">{row.itemOrderId}</code>
                                  </td>
                                  <td className="npc-money">{money(row.productRefundAmount)}</td>
                                  <td className="npc-money">
                                    {money(
                                      paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                                        ?.commissionReversalGross
                                    )}
                                  </td>
                                  <td className="npc-money">
                                    {money(
                                      paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                                        ?.commissionReversalNet
                                    )}
                                  </td>
                                  <td className="npc-money">
                                    {money(
                                      paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                                        ?.commissionReversalVat
                                    )}
                                  </td>
                                  <td className="npc-money">{money(row.netSettlementEffect)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}
                    <h3>Invoice payments (Net 1066 / Commission 1067 / Shipping 1068)</h3>
                    <p className="npc-muted">
                      Noon CSV &quot;Net Proceeds&quot; is invoice gross. 1066 gets the residual after commission and
                      shipping (e.g. 759 − 119.54 − 33.60 = 605.86). Zoho gets exactly three grouped payments
                      (net / commission / shipping) — not one payment per invoice line.
                    </p>
                    {(paymentPreview.summary?.invoiceOverpaymentCount ?? 0) > 0 ? (
                      <div className="npc-alert npc-alert--error" role="alert">
                        Blocked: payment totals exceed Zoho invoice value on{' '}
                        {paymentPreview.summary.invoiceOverpaymentCount} invoice(s). Fix matching / logistics
                        before posting.
                      </div>
                    ) : null}
                    {paymentPreview.summary?.blocked &&
                    Math.abs(Number(paymentPreview.summary.undepositedPlanningDifference) || 0) >= 0.01 &&
                    (paymentPreview.summary.invoiceOverpaymentCount ?? 0) === 0 ? (
                      <div className="npc-alert npc-alert--error" role="alert">
                        Blocked: Noon undeposited reconciliation differs by AED{' '}
                        {money(Math.abs(Number(paymentPreview.summary.undepositedPlanningDifference) || 0))}. Target{' '}
                        {money(paymentPreview.summary.targetUndeposited1066)} vs planned{' '}
                        {money(paymentPreview.summary.plannedUndeposited1066)}.
                        {Array.isArray(paymentPreview.undepositedReconciliation?.nonZeroDeltas) &&
                        paymentPreview.undepositedReconciliation.nonZeroDeltas.length > 0 ? (
                          <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem' }}>
                            {paymentPreview.undepositedReconciliation.nonZeroDeltas.slice(0, 8).map((row) => (
                              <li key={`delta-${String(row.rowNumber)}`}>
                                Row {String(row.rowNumber)} · {String(row.itemOrderId || row.parentOrderId)} · delta{' '}
                                {money(Number(row.delta) || 0)} · {String(row.reason || '')}
                              </li>
                            ))}
                          </ul>
                        ) : null}
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
                                {p.parentLogisticsOrphanAddOn ? (
                                  <div className="npc-muted">
                                    incl. orphan logistics {money(p.parentLogisticsOrphanAddOn)}
                                  </div>
                                ) : null}
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
                    {paymentPreview.settlementAdjustmentJournal ? (
                      <>
                        <h3>Settlement adjustment journal (cross-week charges)</h3>
                        <p className="npc-muted">
                          Zero-sale shipping/logistics from prior weeks — not Record Payment. One journal per
                          statement with per-order expense/VAT detail; aggregated Cr/Dr 1066.
                        </p>
                        <div className="npc-table-wrap">
                          <table className="npc-table">
                            <thead>
                              <tr>
                                <th>Journal</th>
                                <th>Net 1066 impact</th>
                                <th>Summary</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>
                                  <strong>
                                    {String(
                                      paymentPreview.settlementAdjustmentJournal.displayLabel ||
                                        'Noon Settlement Adjustments'
                                    )}
                                  </strong>
                                  <div className="npc-muted">
                                    {String(paymentPreview.settlementAdjustmentJournal.accountingTreatment || '')}
                                  </div>
                                  {paymentPreview.settlementAdjustmentJournal.referenceNumber ? (
                                    <div className="npc-muted">
                                      Ref: {String(paymentPreview.settlementAdjustmentJournal.referenceNumber)}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="npc-money">
                                  {money(Number(paymentPreview.summary.settlementAdjustment1066) || 0)}
                                </td>
                                <td className="npc-muted">
                                  {paymentPreview.summary.settlementAdjustmentLineCount ?? 0} rows · expense{' '}
                                  {money(paymentPreview.summary.settlementAdjustmentNetExpense)} · VAT{' '}
                                  {money(paymentPreview.summary.settlementAdjustmentInputVat)}
                                  {paymentPreview.settlementAdjustmentJournal?.journalAudit ? (
                                    <div>
                                      Journal balance: debits{' '}
                                      {money(paymentPreview.settlementAdjustmentJournal.journalAudit.totalDebits)} · credits{' '}
                                      {money(paymentPreview.settlementAdjustmentJournal.journalAudit.totalCredits)} · diff{' '}
                                      {money(paymentPreview.settlementAdjustmentJournal.journalAudit.difference)}
                                      {paymentPreview.settlementAdjustmentJournal.journalAudit.balanced
                                        ? ' ✓'
                                        : ' — blocked'}
                                    </div>
                                  ) : null}
                                  <div>{String(paymentPreview.settlementAdjustmentJournal.previewNote || '')}</div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          className="npc-btn npc-btn--ghost"
                          onClick={() => setShowSettlementAdjustmentDetail((v) => !v)}
                        >
                          {showSettlementAdjustmentDetail ? 'Hide' : 'View'} source order detail (
                          {paymentPreview.settlementAdjustmentLines?.length ??
                            paymentPreview.settlementAdjustmentJournal.sourceLineCount ??
                            0}
                          )
                        </button>
                        {showSettlementAdjustmentDetail ? (
                          <div className="npc-table-wrap">
                            <table className="npc-table">
                              <thead>
                                <tr>
                                  <th>Row</th>
                                  <th>Parent / Item order</th>
                                  <th>Type</th>
                                  <th>Gross</th>
                                  <th>Net expense</th>
                                  <th>VAT</th>
                                  <th>Expense acct</th>
                                  <th>Related invoice</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(paymentPreview.settlementAdjustmentLines ||
                                  paymentPreview.settlementAdjustmentJournal.sourceLines ||
                                  []).map((line, idx) => (
                                  <tr key={`adj-${line.rowNumber ?? idx}-${line.assignedItemOrderId ?? line.parentOrderId ?? idx}`}>
                                    <td>{line.rowNumber ?? '—'}</td>
                                    <td>
                                      <code className="npc-ref">{line.parentOrderId || '—'}</code>
                                      {line.assignedItemOrderId ? (
                                        <div className="npc-muted">→ {line.assignedItemOrderId}</div>
                                      ) : line.itemOrderId ? (
                                        <div className="npc-muted">{line.itemOrderId}</div>
                                      ) : null}
                                    </td>
                                    <td>
                                      {String(line.displayLabel || 'Adjustment')}
                                      {line.paidInvoiceSubsidy ? (
                                        <div className="npc-muted">paid-invoice subsidy</div>
                                      ) : null}
                                    </td>
                                    <td className="npc-money">{money(line.signedGrossAmount ?? line.grossAmount)}</td>
                                    <td className="npc-money">{money(line.netExpenseAmount)}</td>
                                    <td className="npc-money">{money(line.vatAmount)}</td>
                                    <td>
                                      {line.expenseAccountCode || line.expenseAccountName || '—'}
                                    </td>
                                    <td>
                                      {line.assignedZohoInvoiceNumber || line.assignedZohoInvoiceId || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </>
                    ) : null}
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

            {step.id === 12 && (
              <div className="npc-step-stack">
                <p className="npc-muted">
                  Post grouped Record Payments, advertising fee journals, and uncleared→expense reclass journals.
                  Return credit note refunds and fee reversals are in Step 13 after this post completes.
                </p>
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
                    <strong>Generate payment preview</strong> on Step 11 again.
                  </div>
                )}
                <div className="npc-button-row">
                  <button
                    type="button"
                    className="ainv-btn"
                    disabled={!paymentPreview || loading || Boolean(paymentPreview.summary?.blocked)}
                    onClick={() => onPost(true)}
                  >
                    Dry run — sales & settlement journals
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

            {step.id === 13 && preview && (
              <NoonReturnClearingStep
                preview={preview}
                paymentPreview={paymentPreview}
                isPosted={isPosted}
                loading={loading}
                onPlanChange={setReturnFeePlan}
                onNotice={setNotice}
                onError={setError}
              />
            )}

            {!preview && step.id > 1 ? <p className="npc-muted">Upload or open a statement in step 1 first.</p> : null}
          </StepPanel>
        )
      })}
    </div>
  )
}

export default NoonPaymentClearingPage

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  approveKsaPaymentClearingBatch,
  fetchKsaCreditNoteApplyPlan,
  fetchKsaReturnFeePlan,
  fetchKsaPaymentClearingBatch,
  fetchKsaSavedBatches,
  fetchKsaSettlementReports,
  forceRepostKsaPaymentClearing,
  generateKsaPaymentClearingPaymentPreview,
  type PaymentClearingPaymentPreview,
  type PaymentClearingPreview,
  type PaymentPostingResult,
  postKsaPaymentClearingToZoho,
  postKsaReturnFeeJournals,
  previewKsaSettlementReport,
  reclassifyKsaAccountLevelFees,
  type SavedBatchSummary,
  type SettlementReport,
} from '../../../api/amazonPaymentClearing'
import { safeError } from './clearingShared'
import { CLEARING_STEPS, type StepStatus } from './clearingSteps'
import { ClearingStepper, StepPanel } from './components/ClearingStepper'
import { ForceRepostModal } from './components/ForceRepostModal'
import { useClearingSearch } from './hooks/useClearingSearch'
import type { ClearingContext } from './steps/clearingContext'
import { Step1SelectSettlement } from './steps/Step1SelectSettlement'
import { Step2ParsedRows } from './steps/Step2ParsedRows'
import { Step3MatchSales } from './steps/Step3MatchSales'
import { Step4Returns } from './steps/Step4Returns'
import { Step5Reconcile } from './steps/Step5Reconcile'
import { Step6Approve } from './steps/Step6Approve'
import { Step7AmazonFeeJournalMapping } from './steps/Step7AmazonFeeJournalMapping'
import { Step8ApplyCreditNotes } from './steps/Step8ApplyCreditNotes'
import { Step9ReturnFeeClearing } from './steps/Step9ReturnFeeClearing'
import { Step7Preview as Step10PaymentPreview } from './steps/Step7Preview'
import { Step8Post as Step11Post } from './steps/Step8Post'
import './AmazonPaymentClearingPage.css'

const BASE_PATH = '/management/amazon-payment-clearing'
const STEP_KEY_TO_ID = new Map(CLEARING_STEPS.map((step) => [step.key, step.id]))
const STEP_ID_TO_KEY = new Map(CLEARING_STEPS.map((step) => [step.id, step.key]))

function clearingPath(stepId: number, batchId?: string | number | null) {
  const key = STEP_ID_TO_KEY.get(stepId) || 'select'
  const bid = batchId == null ? '' : String(batchId).trim()
  return bid ? `${BASE_PATH}/batch/${bid}/${key}` : `${BASE_PATH}/${key}`
}

export function AmazonPaymentClearingPage() {
  const navigate = useNavigate()
  const params = useParams()
  const routeBatchId = params.batchId ? String(params.batchId) : ''
  const routeStepKey = params.stepKey || ''
  const [reportId, setReportId] = useState('')
  const [reportDocumentId, setReportDocumentId] = useState('')
  const [batchIdToOpen, setBatchIdToOpen] = useState('')
  const [reports, setReports] = useState<SettlementReport[]>([])
  const [savedBatches, setSavedBatches] = useState<SavedBatchSummary[]>([])
  const [preview, setPreview] = useState<PaymentClearingPreview | null>(null)
  const [paymentPreview, setPaymentPreview] = useState<PaymentClearingPaymentPreview | null>(null)
  const [postingResult, setPostingResult] = useState<PaymentPostingResult | null>(null)

  const [loadingReports, setLoadingReports] = useState(false)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [approving, setApproving] = useState(false)
  const [generatingPaymentPreview, setGeneratingPaymentPreview] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postingReturnFees, setPostingReturnFees] = useState(false)

  const [forceRepostOpen, setForceRepostOpen] = useState(false)
  const [creditNoteApplyComplete, setCreditNoteApplyComplete] = useState(false)
  const [returnFeeBlockerCount, setReturnFeeBlockerCount] = useState(0)
  const [returnFeePostComplete, setReturnFeePostComplete] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const search = useClearingSearch(preview?.allRows || [])

  const loadedBatchId = preview?.batch?.batchId != null ? String(preview.batch.batchId) : ''

  // Active step comes from the URL. Until a settlement is loaded only the
  // "Select" step is meaningful, so fall back to it; once a batch is loaded
  // an URL without an explicit step lands on the parsed rows.
  const stepFromKey = STEP_KEY_TO_ID.get(routeStepKey)
  const activeStep = preview ? (stepFromKey ?? 2) : 1

  const goToStep = useCallback(
    (stepId: number) => {
      navigate(clearingPath(stepId, loadedBatchId || routeBatchId || null))
    },
    [navigate, loadedBatchId, routeBatchId]
  )

  const isPosted = preview?.status === 'posted' || preview?.batch?.status === 'posted' || preview?.postedToZoho === true
  const isApproved = !isPosted && (preview?.status === 'approved' || preview?.batch?.status === 'approved')
  const creditNoteBlockingRows = preview?.creditNoteBlockingRows || []
  const netNegativeReturnOrders = preview?.netNegativeReturnOrders || []
  const feeJournalMappings = preview?.nonOrderLinkedAmazonFeeMappings || []
  const unmappedFeeJournalCount = feeJournalMappings.filter((row) => row.mappingStatus === 'needs_mapping').length
  const paymentPreviewFeeJournalBlockerCount =
    paymentPreview?.amazonFeeJournalLines?.filter((row) => row.mappingStatus === 'needs_mapping').length || 0
  const isCleanForApproval = Boolean(
    preview &&
      preview.reconciliationSummary?.reconciliationStatus === 'reconciled' &&
      preview.unmatchedOrders.length === 0 &&
      creditNoteBlockingRows.length === 0
  )
  const canGeneratePaymentPreview = Boolean(
    preview?.batch?.batchId &&
      (isApproved || isPosted) &&
      Math.abs(Number(preview?.reconciliationSummary?.reconciliationDifference) || 0) <= 0.01 &&
      (preview?.unmatchedOrders.length || 0) === 0 &&
      creditNoteBlockingRows.length === 0
  )
  const canPostToZoho = Boolean(
    canGeneratePaymentPreview &&
      paymentPreview &&
      paymentPreviewFeeJournalBlockerCount === 0
  )
  const canPostReturnFeeJournals = Boolean(
    isPosted &&
      creditNoteApplyComplete &&
      returnFeeBlockerCount === 0
  )

  const refreshPostClearingStepStatus = useCallback(async (batchId?: string | number) => {
    const id = batchId ?? preview?.batch?.batchId
    if (!id || !isPosted) {
      setCreditNoteApplyComplete(false)
      setReturnFeeBlockerCount(0)
      setReturnFeePostComplete(false)
      return
    }
    try {
      const [cnPlan, feePlan] = await Promise.all([
        fetchKsaCreditNoteApplyPlan(id),
        fetchKsaReturnFeePlan(id),
      ])
      setCreditNoteApplyComplete(Boolean(cnPlan.summary?.isComplete))
      setReturnFeeBlockerCount(feePlan.summary?.varianceBlockerCount || 0)
      setReturnFeePostComplete(Boolean(feePlan.returnFeePostComplete))
    } catch {
      setCreditNoteApplyComplete(false)
      setReturnFeeBlockerCount(0)
      setReturnFeePostComplete(false)
    }
  }, [isPosted, preview?.batch?.batchId])

  useEffect(() => {
    void refreshPostClearingStepStatus()
  }, [refreshPostClearingStepStatus])

  const loadSavedBatches = useCallback(async () => {
    setLoadingBatches(true)
    try {
      const json = await fetchKsaSavedBatches()
      setSavedBatches(Array.isArray(json.batches) ? json.batches : [])
    } catch (e) {
      setError(safeError(e))
    } finally {
      setLoadingBatches(false)
    }
  }, [])

  useEffect(() => {
    void loadSavedBatches()
  }, [loadSavedBatches])

  const onFetchReports = useCallback(async () => {
    setLoadingReports(true)
    setError('')
    try {
      const json = await fetchKsaSettlementReports()
      const rows = Array.isArray(json.reports) ? json.reports : []
      setReports(rows)
      if (rows[0]) {
        setReportId(rows[0].reportId || '')
        setReportDocumentId(rows[0].reportDocumentId || '')
      }
      await loadSavedBatches()
    } catch (e) {
      setError(safeError(e))
    } finally {
      setLoadingReports(false)
    }
  }, [loadSavedBatches])

  const applyPreview = useCallback((json: PaymentClearingPreview) => {
    setPreview(json)
    setPaymentPreview(json.paymentPreview ?? null)
    setPostingResult(null)
    search.reset()
  }, [search])

  const runPreview = useCallback(
    async (forceRefresh: boolean) => {
      setPreviewing(true)
      setError('')
      setNotice('')
      try {
        const json = await previewKsaSettlementReport({
          reportId: reportId.trim() || undefined,
          reportDocumentId: reportDocumentId.trim() || undefined,
          daysBack: 365,
          forceRefresh,
        })
        applyPreview(json)
        navigate(clearingPath(2, json.batch?.batchId))
        setNotice(
          json.refreshedFromAmazon
            ? 'Re-fetched from Amazon. Parsed rows and reconciliation were replaced.'
            : json.fromCache
              ? 'Loaded saved settlement batch from the database (no Amazon call).'
              : 'Settlement previewed and saved.'
        )
        await loadSavedBatches()
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPreviewing(false)
      }
    },
    [applyPreview, loadSavedBatches, navigate, reportDocumentId, reportId]
  )

  const onRefreshFromAmazon = useCallback(() => {
    const ok = window.confirm(
      'Refresh from Amazon will re-download the raw settlement report and replace the saved parsed rows and reconciliation for this report. Continue?'
    )
    if (ok) void runPreview(true)
  }, [runPreview])

  const openBatch = useCallback(
    async (id: string | number, opts: { navigate?: boolean } = {}) => {
      const value = String(id).trim()
      if (!value) return
      setReopening(true)
      setError('')
      setNotice('')
      try {
        const json = await fetchKsaPaymentClearingBatch(value)
        applyPreview(json)
        setBatchIdToOpen(value)
        if (opts.navigate !== false) {
          navigate(clearingPath(2, json.batch?.batchId || value))
        }
        setNotice(
          json.rematchedZoho
            ? `Loaded batch ${value} and re-matched Zoho invoices (late invoices are now included).`
            : `Loaded saved settlement batch ${value} from the database.`
        )
      } catch (e) {
        setError(safeError(e))
      } finally {
        setReopening(false)
      }
    },
    [applyPreview, navigate]
  )

  // Deep link: load the batch named in the URL when it is not already loaded.
  useEffect(() => {
    if (!routeBatchId || reopening) return
    if (loadedBatchId === routeBatchId) return
    void openBatch(routeBatchId, { navigate: false })
  }, [routeBatchId, loadedBatchId, reopening, openBatch])

  const onApprove = useCallback(async () => {
    const batchId = preview?.batch?.batchId
    if (!batchId || isApproved || isPosted) return
    setApproving(true)
    setError('')
    setNotice('')
    try {
      const json = await approveKsaPaymentClearingBatch(batchId)
      setPreview(json)
      setPaymentPreview(null)
      setPostingResult(null)
      setNotice(json.message || 'Settlement approved and saved.')
      navigate(clearingPath(7, json.batch?.batchId || batchId))
      await loadSavedBatches()
    } catch (e) {
      setError(safeError(e))
    } finally {
      setApproving(false)
    }
  }, [isApproved, isPosted, loadSavedBatches, navigate, preview?.batch?.batchId])

  const onGeneratePaymentPreview = useCallback(async () => {
    const batchId = preview?.batch?.batchId
    if (!batchId || !canGeneratePaymentPreview) return
    setGeneratingPaymentPreview(true)
    setError('')
    setNotice('')
    try {
      const json = await generateKsaPaymentClearingPaymentPreview(batchId)
      setPaymentPreview(json)
      setPostingResult(null)
      setNotice('Payment clearing preview generated. No Zoho payments have been created.')
      navigate(clearingPath(8, batchId))
    } catch (e) {
      setError(safeError(e))
    } finally {
      setGeneratingPaymentPreview(false)
    }
  }, [canGeneratePaymentPreview, navigate, preview?.batch?.batchId])

  const onRunPosting = useCallback(
    async (dryRun: boolean) => {
      const batchId = preview?.batch?.batchId
      if (!batchId) return
      if (!dryRun) {
        const ok = window.confirm(
          `You are about to create 3 grouped Zoho Record Payments.\n\nSettlement batch: ${batchId}\n\nThis action cannot be automatically reversed.`
        )
        if (!ok) return
      }
      setPosting(true)
      setError('')
      setNotice('')
      try {
        const json = await postKsaPaymentClearingToZoho(batchId, dryRun)
        setPostingResult(json)
        setNotice(dryRun ? 'Dry run completed. No Zoho payments were created.' : 'Zoho posting completed.')
        if (!dryRun && json.summary.errors === 0) {
          const refreshed = await fetchKsaPaymentClearingBatch(batchId)
          setPreview(refreshed)
          await loadSavedBatches()
          await refreshPostClearingStepStatus(batchId)
        }
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPosting(false)
      }
    },
    [loadSavedBatches, preview?.batch?.batchId, refreshPostClearingStepStatus]
  )

  const onPostReturnFeeJournals = useCallback(
    async (dryRun: boolean) => {
      const batchId = preview?.batch?.batchId
      if (!batchId) return
      if (!dryRun) {
        const ok = window.confirm('Post return fee clearing journals to Zoho for this settlement?')
        if (!ok) return
      }
      setPostingReturnFees(true)
      setError('')
      setNotice('')
      try {
        const json = await postKsaReturnFeeJournals(batchId, dryRun)
        setPostingResult(json)
        setNotice(dryRun ? 'Return fee journal dry run completed.' : 'Return fee journals posted to Zoho.')
        if (!dryRun && json.summary.errors === 0) {
          const refreshed = await fetchKsaPaymentClearingBatch(batchId)
          setPreview(refreshed)
          const feePlan = await fetchKsaReturnFeePlan(batchId)
          setReturnFeePostComplete(Boolean(feePlan.returnFeePostComplete))
          setReturnFeeBlockerCount(feePlan.summary?.varianceBlockerCount || 0)
          await refreshPostClearingStepStatus(batchId)
        }
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPostingReturnFees(false)
      }
    },
    [preview?.batch?.batchId, refreshPostClearingStepStatus]
  )

  const onConfirmForceRepost = useCallback(
    async (reason: string) => {
      const batchId = preview?.batch?.batchId
      if (!batchId || reason.length < 4) return
      setPosting(true)
      setError('')
      setNotice('')
      try {
        const json = await forceRepostKsaPaymentClearing(batchId, { reason, dryRun: false })
        setPostingResult(json)
        setForceRepostOpen(false)
        setNotice('Force repost completed and logged to the audit trail.')
        if (json.summary.errors === 0) {
          const refreshed = await fetchKsaPaymentClearingBatch(batchId)
          setPreview(refreshed)
          await loadSavedBatches()
        }
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPosting(false)
      }
    },
    [loadSavedBatches, preview?.batch?.batchId]
  )

  const onMarkAccountLevelFee = useCallback(
    async (rowNumber: number) => {
      const batchId = preview?.batch?.batchId
      if (!batchId) return
      setError('')
      setNotice('')
      try {
        const refreshed = await reclassifyKsaAccountLevelFees(batchId, [rowNumber])
        setPreview(refreshed)
        setNotice(refreshed.message || `Row ${rowNumber} marked as account-level fee.`)
      } catch (e) {
        setError(safeError(e))
      }
    },
    [preview?.batch?.batchId]
  )

  const ctx: ClearingContext = {
    preview,
    paymentPreview,
    postingResult,
    reports,
    savedBatches,
    reportId,
    reportDocumentId,
    batchIdToOpen,
    loadingReports,
    loadingBatches,
    previewing,
    reopening,
    approving,
    generatingPaymentPreview,
    posting,
    postingReturnFees,
    search,
    isPosted,
    isApproved,
    isCleanForApproval,
    canGeneratePaymentPreview,
    canPostToZoho,
    canPostReturnFeeJournals,
    creditNoteApplyComplete,
    returnFeePostComplete,
    setReportId,
    setReportDocumentId,
    setBatchIdToOpen,
    onFetchReports,
    onPreview: () => void runPreview(false),
    onRefreshFromAmazon,
    onOpenBatchId: () => void openBatch(batchIdToOpen),
    onOpenSavedBatch: (id) => void openBatch(id),
    onApprove,
    onGeneratePaymentPreview,
    onRunPosting,
    onPostReturnFeeJournals,
    onOpenForceRepost: () => setForceRepostOpen(true),
    onReloadCurrentBatch: async () => {
      const id = preview?.batch?.batchId || routeBatchId || loadedBatchId
      if (id) await openBatch(id, { navigate: false })
    },
    onMarkAccountLevelFee,
    refreshPostClearingStepStatus,
    goToStep,
    setNotice,
  }

  const stepStatuses = useMemo<Record<number, StepStatus>>(() => {
    const statuses: Record<number, StepStatus> = {
      1: preview ? 'completed' : 'in_progress',
      2: 'not_started',
      3: 'not_started',
      4: 'not_started',
      5: 'not_started',
      6: 'not_started',
      7: 'not_started',
      8: 'not_started',
      9: 'not_started',
      10: 'not_started',
      11: 'not_started',
    }
    if (!preview) return statuses
    statuses[2] = 'completed'
    statuses[3] = preview.unmatchedOrders.length > 0 || (preview.allRows || []).some((row) => row.status === 'missing_order_id')
      ? 'blocked'
      : 'completed'
    statuses[4] = creditNoteBlockingRows.length > 0 ? 'blocked' : 'completed'
    statuses[5] = preview.reconciliationSummary?.reconciliationStatus === 'mismatch' ? 'blocked' : 'completed'
    statuses[6] = isApproved || isPosted ? 'completed' : isCleanForApproval ? 'ready' : 'blocked'
    statuses[7] = unmappedFeeJournalCount > 0 ? 'blocked' : 'completed'
    statuses[8] = paymentPreview ? 'completed' : isApproved || isPosted ? 'ready' : 'not_started'
    statuses[9] = isPosted ? 'completed' : canPostToZoho && paymentPreview ? 'ready' : 'not_started'
    statuses[10] = creditNoteApplyComplete ? 'completed' : isPosted ? 'ready' : 'not_started'
    statuses[11] = returnFeePostComplete
      ? 'completed'
      : returnFeeBlockerCount > 0
        ? 'blocked'
        : isPosted && creditNoteApplyComplete
          ? 'ready'
          : 'not_started'
    return statuses
  }, [canPostToZoho, creditNoteApplyComplete, creditNoteBlockingRows.length, isApproved, isCleanForApproval, isPosted, paymentPreview, preview, returnFeeBlockerCount, returnFeePostComplete, unmappedFeeJournalCount])

  const stepBodies: Record<number, ReactNode> = {
    1: <Step1SelectSettlement ctx={ctx} />,
    2: <Step2ParsedRows ctx={ctx} />,
    3: <Step3MatchSales ctx={ctx} />,
    4: <Step4Returns ctx={ctx} />,
    5: <Step5Reconcile ctx={ctx} />,
    6: <Step6Approve ctx={ctx} />,
    7: <Step7AmazonFeeJournalMapping ctx={ctx} />,
    8: <Step10PaymentPreview ctx={ctx} />,
    9: <Step11Post ctx={ctx} />,
    10: <Step8ApplyCreditNotes ctx={ctx} />,
    11: <Step9ReturnFeeClearing ctx={ctx} />,
  }

  const stepSummaries: Record<number, string> = {
    1: preview ? `Batch #${preview.batch?.batchId ?? '-'} · ${preview.report.settlementId || 'settlement'}` : 'No settlement loaded',
    2: preview ? `${preview.rawRowCount} parsed rows` : '',
    3: preview ? `${preview.matchedOrders.length} matched · ${preview.unmatchedOrders.length} unmatched` : '',
    4: preview ? `${creditNoteBlockingRows.length} blocker(s) · ${(preview.matchedReturns || []).filter((r) => r.status === 'ready_to_create').length} will create` : '',
    5: preview ? `Difference ${preview.reconciliationSummary?.reconciliationDifference ?? 0}` : '',
    6: isPosted ? 'Posted' : isApproved ? 'Approved' : isCleanForApproval ? 'Ready to approve' : 'Blocked',
    7: preview ? `${feeJournalMappings.length} fee journal group(s) · ${unmappedFeeJournalCount} unmapped` : '',
    8: paymentPreview ? `${paymentPreview.paymentPlanSummary.invoiceCount} invoices planned` : 'Not generated',
    9: isPosted ? 'Sales payments posted' : 'Not posted',
    10: creditNoteApplyComplete ? 'Credit notes refunded' : isPosted ? 'Refund pending' : 'After sales post',
    11: returnFeePostComplete ? 'Return fees posted' : preview ? `${returnFeeBlockerCount} variance blocker(s)` : '',
  }

  return (
    <div className="ainv-page apc-page">
      <section className="ainv-page__header">
        <div className="ainv-page__eyebrow ainv-page__eyebrow--amber">Management · Amazon · KSA</div>
        <h1 className="ainv-page__title">Amazon KSA Payment Clearing</h1>
        <p className="ainv-page__lead">
          Fetch once, reconcile sales and returns against Zoho, and post grouped Record Payments — with every warning
          traceable to the exact settlement rows.
        </p>
        <div className="ainv-callout-emerald">
          <strong>Zoho posting guarded.</strong> Sales payments post in step 9 after reconciliation is clean. Return
          credit notes and refund journals run in steps 10–11 only after payments land in Zoho.
        </div>
      </section>

      <ClearingStepper activeStep={activeStep} stepStatuses={stepStatuses} onStepClick={goToStep} />

      {error ? <div className="apc-alert apc-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="apc-alert" role="status">{notice}</div> : null}

      {CLEARING_STEPS.map((step) => {
        const status = stepStatuses[step.id]
        const isAccessible = step.id === 1 || Boolean(preview)
        if (!isAccessible && status === 'not_started') return null
        return (
          <StepPanel
            key={step.id}
            id={`apc-step-${step.id}`}
            step={step}
            status={status}
            collapsed={activeStep !== step.id}
            onExpand={() => goToStep(step.id)}
            summary={stepSummaries[step.id]}
            blocker={status === 'blocked' ? (step.id === 11 ? 'Resolve return fee variance blockers before posting journals.' : 'Resolve the blocking items before continuing.') : undefined}
          >
            {stepBodies[step.id]}
          </StepPanel>
        )
      })}

      <ForceRepostModal
        open={forceRepostOpen}
        postingSummary={preview?.postingSummary || preview?.batch?.postingSummary}
        busy={posting}
        onCancel={() => setForceRepostOpen(false)}
        onConfirm={onConfirmForceRepost}
      />
    </div>
  )
}

export default AmazonPaymentClearingPage

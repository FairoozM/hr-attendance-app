import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  approvePaymentClearingBatch,
  fetchCreditNoteApplyPlan,
  fetchReturnFeePlan,
  fetchPaymentClearingBatch,
  fetchPostingStatus,
  fetchSavedBatches,
  fetchSettlementReports,
  fetchZohoCustomers,
  forceRepostPaymentClearing,
  generatePaymentClearingPaymentPreview,
  type KsaZohoCustomerOption,
  type PaymentClearingPaymentPreview,
  type PaymentClearingPreview,
  type PaymentPostingResult,
  type PostingGroupKey,
  type PostingJobProgress,
  type PostingStatus,
  postPaymentClearingToZoho,
  postReturnFeeJournals,
  previewSettlementReport,
  previewSettlementUpload,
  reclassifyAccountLevelFees,
  type SavedBatchSummary,
  type SettlementReport,
} from '../../../api/amazonPaymentClearing'
import {
  clearingBasePath,
  clearingPageTitle,
  defaultCurrency,
  defaultZohoCustomerName,
  marketplaceFromPathname,
} from './marketplaceConfig'
import { isSettlementReconciliationAcceptable, legacySettlementMismatchBlocksClearing, previewCurrency, safeError } from './clearingShared'
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
import { StepReturnsNotReceived } from './steps/StepReturnsNotReceived'
import { StepUnclearedClearing } from './steps/StepUnclearedClearing'
import { Step7Preview as Step10PaymentPreview } from './steps/Step7Preview'
import { Step8Post as Step11Post } from './steps/Step8Post'
import './AmazonPaymentClearingPage.css'

function postingOutcomeMessage(result: PaymentPostingResult, label = 'Zoho posting'): { ok: boolean; message: string } {
  const summary = result.summary || { errors: 0, verificationRequired: 0 }
  const verification = summary.verificationRequired || 0
  const errors = summary.errors || 0
  if (result.success && verification === 0 && errors === 0) {
    return { ok: true, message: `${label} completed. Every entry is posted and recorded.` }
  }
  const parts: string[] = []
  if (verification) parts.push(`${verification} entr${verification === 1 ? 'y needs' : 'ies need'} verification in Zoho`)
  if (errors) parts.push(`${errors} entr${errors === 1 ? 'y' : 'ies'} failed`)
  const state = result.status === 'verification_required' ? 'needs verification' : 'is only partially posted'
  return {
    ok: false,
    message: `${label} ${state}: ${parts.join(', ') || 'not every entry was confirmed'}. Each entry's reason is in the posting status below.`,
  }
}

const STEP_KEY_TO_ID = new Map(CLEARING_STEPS.map((step) => [step.key, step.id]))
const STEP_ID_TO_KEY = new Map(CLEARING_STEPS.map((step) => [step.id, step.key]))

export function AmazonPaymentClearingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const marketplace = marketplaceFromPathname(location.pathname)
  const basePath = clearingBasePath(marketplace)
  const params = useParams()
  const routeBatchId = params.batchId ? String(params.batchId) : ''
  const routeStepKey = params.stepKey || ''

  function clearingPath(stepId: number, batchId?: string | number | null) {
    const key = STEP_ID_TO_KEY.get(stepId) || 'select'
    const bid = batchId == null ? '' : String(batchId).trim()
    return bid ? `${basePath}/batch/${bid}/${key}` : `${basePath}/${key}`
  }

  const [reportId, setReportId] = useState('')
  const [reportDocumentId, setReportDocumentId] = useState('')
  const [batchIdToOpen, setBatchIdToOpen] = useState('')
  const [zohoCustomerName, setZohoCustomerName] = useState(() => defaultZohoCustomerName(marketplace))
  const [zohoCustomers, setZohoCustomers] = useState<KsaZohoCustomerOption[]>([])
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
  const [postingProgress, setPostingProgress] = useState<PostingJobProgress | null>(null)
  const [postingStartedAt, setPostingStartedAt] = useState<number | null>(null)
  const [salesPostingMessage, setSalesPostingMessage] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null)
  const [postingReturnFees, setPostingReturnFees] = useState(false)

  const [forceRepostOpen, setForceRepostOpen] = useState(false)
  const [creditNoteApplyComplete, setCreditNoteApplyComplete] = useState(false)
  const [returnFeeBlockerCount, setReturnFeeBlockerCount] = useState(0)
  const [returnFeePostComplete, setReturnFeePostComplete] = useState(false)
  const [notReceivedCount, setNotReceivedCount] = useState(0)
  const [notReceivedPostComplete, setNotReceivedPostComplete] = useState(false)
  const [postingStatus, setPostingStatus] = useState<PostingStatus | null>(null)
  const [postingStatusLoading, setPostingStatusLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setZohoCustomerName(defaultZohoCustomerName(marketplace))
    setPreview(null)
    setPaymentPreview(null)
    setPostingResult(null)
    setPostingStatus(null)
    setReports([])
    setSavedBatches([])
  }, [marketplace])

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
    [navigate, loadedBatchId, routeBatchId, basePath]
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
      isSettlementReconciliationAcceptable(preview) &&
      preview.unmatchedOrders.length === 0 &&
      creditNoteBlockingRows.length === 0
  )
  const canGeneratePaymentPreview = Boolean(
    preview?.batch?.batchId &&
      (isApproved || isPosted) &&
      isSettlementReconciliationAcceptable(preview) &&
      (preview?.unmatchedOrders.length || 0) === 0 &&
      creditNoteBlockingRows.length === 0
  )
  const canPostToZoho = Boolean(
    canGeneratePaymentPreview &&
      paymentPreview &&
      paymentPreviewFeeJournalBlockerCount === 0
  )
  const postingGroup = (key: PostingGroupKey) => postingStatus?.groups.find((group) => group.key === key)
  const salesGroups = [postingGroup('sales_payment'), postingGroup('fee_journal')]
  const salesComplete = Boolean(isPosted && (postingStatus ? postingStatus.salesComplete : true))
  const salesPostingNeedsAttention = salesGroups.some(
    (group) => group?.status === 'verification_required' || group?.status === 'failed'
  )
  const salesPostingStarted = salesGroups.some((group) => group?.status === 'partially_posted' || group?.status === 'posted')
  const creditNotesNeedAttention = postingGroup('credit_note')?.status === 'verification_required'
  const notReceivedNeedsAttention = ['verification_required', 'failed'].includes(postingGroup('return_not_received')?.status || '')
  const canPostReturnFeeJournals = Boolean(
    salesComplete &&
      creditNoteApplyComplete &&
      notReceivedPostComplete &&
      returnFeeBlockerCount === 0
  )

  const refreshPostingStatus = useCallback(
    async (batchId?: string | number) => {
      const id = batchId ?? preview?.batch?.batchId
      if (!id || (!isPosted && !isApproved)) {
        setPostingStatus(null)
        return null
      }
      setPostingStatusLoading(true)
      try {
        const status = await fetchPostingStatus(marketplace, id)
        setPostingStatus(status)
        return status
      } catch (e) {
        setPostingStatus(null)
        setError(`Could not load Zoho posting status: ${safeError(e)}`)
        return null
      } finally {
        setPostingStatusLoading(false)
      }
    },
    [isApproved, isPosted, marketplace, preview?.batch?.batchId]
  )

  const refreshPostClearingStepStatus = useCallback(async (batchId?: string | number) => {
    const id = batchId ?? preview?.batch?.batchId
    void refreshPostingStatus(id)
    if (!id || !isPosted) {
      setCreditNoteApplyComplete(false)
      setReturnFeeBlockerCount(0)
      setReturnFeePostComplete(false)
      setNotReceivedCount(0)
      setNotReceivedPostComplete(false)
      return
    }
    try {
      const [cnPlan, feePlan] = await Promise.all([
        fetchCreditNoteApplyPlan(marketplace, id),
        fetchReturnFeePlan(marketplace, id),
      ])
      setCreditNoteApplyComplete(Boolean(cnPlan.summary?.isComplete))
      setNotReceivedCount((cnPlan.returnDispositions || []).filter((row) => row.disposition === 'not_received').length)
      setNotReceivedPostComplete(feePlan.notReceivedPostComplete !== false)
      setReturnFeeBlockerCount(feePlan.summary?.varianceBlockerCount || 0)
      setReturnFeePostComplete(Boolean(feePlan.returnFeePostComplete))
    } catch {
      setCreditNoteApplyComplete(false)
      setNotReceivedCount(0)
      setNotReceivedPostComplete(false)
      setReturnFeeBlockerCount(0)
      setReturnFeePostComplete(false)
    }
  }, [isPosted, preview?.batch?.batchId, marketplace, refreshPostingStatus])

  useEffect(() => {
    void refreshPostClearingStepStatus()
  }, [refreshPostClearingStepStatus])

  const loadSavedBatches = useCallback(async () => {
    setLoadingBatches(true)
    try {
      const json = await fetchSavedBatches(marketplace, 50)
      setSavedBatches(Array.isArray(json.batches) ? json.batches : [])
    } catch (e) {
      setError(safeError(e))
    } finally {
      setLoadingBatches(false)
    }
  }, [marketplace])

  useEffect(() => {
    void loadSavedBatches()
  }, [loadSavedBatches])

  useEffect(() => {
    void (async () => {
      try {
        const json = await fetchZohoCustomers(marketplace)
        setZohoCustomers(Array.isArray(json.customers) ? json.customers : [])
      } catch {
        setZohoCustomers([])
      }
    })()
  }, [marketplace])

  const onFetchReports = useCallback(async () => {
    setLoadingReports(true)
    setError('')
    try {
      const json = await fetchSettlementReports(marketplace, 90)
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
    setSalesPostingMessage(null)
    if (json.zohoCustomerName || json.batch?.zohoCustomerName) {
      setZohoCustomerName(json.zohoCustomerName || json.batch?.zohoCustomerName || defaultZohoCustomerName(marketplace))
    }
    search.reset()
  }, [search, marketplace])

  const selectedZohoCustomer = useMemo(
    () => zohoCustomers.find((row) => row.name === zohoCustomerName) || null,
    [zohoCustomerName, zohoCustomers]
  )

  const runPreview = useCallback(
    async (forceRefresh: boolean) => {
      setPreviewing(true)
      setError('')
      setNotice('')
      try {
        const json = await previewSettlementReport(marketplace, {
          reportId: reportId.trim() || undefined,
          reportDocumentId: reportDocumentId.trim() || undefined,
          daysBack: 90,
          forceRefresh,
          zohoCustomerId: selectedZohoCustomer?.customerId || undefined,
          zohoCustomerName: zohoCustomerName || undefined,
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
    [applyPreview, loadSavedBatches, marketplace, navigate, reportDocumentId, reportId, selectedZohoCustomer, zohoCustomerName]
  )

  const onRefreshFromAmazon = useCallback(() => {
    const ok = window.confirm(
      'Refresh from Amazon will re-download the raw settlement report and replace the saved parsed rows and reconciliation for this report. Continue?'
    )
    if (ok) void runPreview(true)
  }, [runPreview])

  const onUploadSettlementFile = useCallback(
    async (file: File, forceRefresh = false) => {
      setPreviewing(true)
      setError('')
      setNotice('')
      try {
        const json = await previewSettlementUpload(marketplace, file, {
          forceRefresh,
          zohoCustomerId: selectedZohoCustomer?.customerId || undefined,
          zohoCustomerName: zohoCustomerName || undefined,
        })
        applyPreview(json)
        navigate(clearingPath(2, json.batch?.batchId))
        setNotice(
          json.refreshedFromUpload
            ? 'Re-imported uploaded settlement. Parsed rows and reconciliation were replaced.'
            : json.fromCache
              ? 'Loaded saved settlement batch from the database (no Amazon call).'
              : 'Uploaded settlement parsed and saved.'
        )
        await loadSavedBatches()
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPreviewing(false)
      }
    },
    [applyPreview, loadSavedBatches, navigate, selectedZohoCustomer, zohoCustomerName]
  )

  const openBatch = useCallback(
    async (id: string | number, opts: { navigate?: boolean } = {}) => {
      const value = String(id).trim()
      if (!value) return
      setReopening(true)
      setError('')
      setNotice('')
      try {
        const json = await fetchPaymentClearingBatch(marketplace, value)
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
      const json = await approvePaymentClearingBatch(marketplace, batchId)
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
  }, [isApproved, isPosted, loadSavedBatches, marketplace, navigate, preview?.batch?.batchId])

  const onGeneratePaymentPreview = useCallback(async () => {
    const batchId = preview?.batch?.batchId
    if (!batchId || !canGeneratePaymentPreview) return
    setGeneratingPaymentPreview(true)
    setError('')
    setNotice('')
    try {
      const json = await generatePaymentClearingPaymentPreview(marketplace, batchId)
      setPaymentPreview(json)
      setPostingResult(null)
      setNotice('Payment clearing preview generated. No Zoho payments have been created.')
      navigate(clearingPath(8, batchId))
    } catch (e) {
      setError(safeError(e))
    } finally {
      setGeneratingPaymentPreview(false)
    }
  }, [canGeneratePaymentPreview, marketplace, navigate, preview?.batch?.batchId])

  const onRunPosting = useCallback(
    async (dryRun: boolean) => {
      const batchId = preview?.batch?.batchId
      if (!batchId) return
      if (!dryRun) {
        const ok = window.confirm(
          `You are about to post the grouped Zoho Record Payments and fee journals for settlement batch ${batchId}.\n\nEntries already recorded as posted are re-checked in Zoho and not sent again.\n\nThis action cannot be automatically reversed.`
        )
        if (!ok) return
      }
      setPosting(true)
      setError('')
      setNotice('')
      setSalesPostingMessage(null)
      setPostingResult(null)
      setPostingProgress(null)
      setPostingStartedAt(Date.now())
      const report = (kind: 'error' | 'notice', text: string) => {
        setSalesPostingMessage({ kind, text })
        if (kind === 'error') setError(text)
        else setNotice(text)
      }
      try {
        const json = await postPaymentClearingToZoho(marketplace, batchId, dryRun, setPostingProgress)
        setPostingResult(json)
        if (dryRun) {
          const errors = json.summary?.errors || 0
          const verification = json.summary?.verificationRequired || 0
          if (errors || verification) {
            report(
              'error',
              `Dry run found problems: ${[
                errors ? `${errors} entr${errors === 1 ? 'y' : 'ies'} with errors` : '',
                verification ? `${verification} entr${verification === 1 ? 'y needs' : 'ies need'} verification` : '',
              ].filter(Boolean).join(', ')}. See the details below. No Zoho payments were created.`
            )
          } else {
            report('notice', 'Dry run completed. No Zoho payments were created.')
          }
        } else {
          const outcome = postingOutcomeMessage(json)
          report(outcome.ok ? 'notice' : 'error', outcome.message)
          const refreshed = await fetchPaymentClearingBatch(marketplace, batchId)
          setPreview(refreshed)
          setPostingResult(json)
          await loadSavedBatches()
        }
      } catch (e) {
        report('error', `${dryRun ? 'Dry run' : 'POST TO ZOHO'} failed: ${safeError(e)}`)
      } finally {
        setPosting(false)
        setPostingStartedAt(null)
        setPostingProgress(null)
        if (!dryRun) await refreshPostClearingStepStatus(batchId)
      }
    },
    [loadSavedBatches, marketplace, preview?.batch?.batchId, refreshPostClearingStepStatus]
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
        const json = await postReturnFeeJournals(marketplace, batchId, dryRun)
        setPostingResult(json)
        if (dryRun) {
          setNotice('Return fee journal dry run completed.')
        } else {
          const outcome = postingOutcomeMessage(json, 'Return fee journals')
          if (outcome.ok) setNotice(outcome.message)
          else setError(outcome.message)
          await refreshPostClearingStepStatus(batchId)
        }
        if (!dryRun && json.success) {
          const refreshed = await fetchPaymentClearingBatch(marketplace, batchId)
          setPreview(refreshed)
          const feePlan = await fetchReturnFeePlan(marketplace, batchId)
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
    [marketplace, preview?.batch?.batchId, refreshPostClearingStepStatus]
  )

  const onConfirmForceRepost = useCallback(
    async (reason: string) => {
      const batchId = preview?.batch?.batchId
      if (!batchId || reason.length < 4) return
      setPosting(true)
      setError('')
      setNotice('')
      setPostingProgress(null)
      setPostingStartedAt(Date.now())
      try {
        const json = await forceRepostPaymentClearing(marketplace, batchId, { reason, dryRun: false }, setPostingProgress)
        setPostingResult(json)
        setForceRepostOpen(false)
        const outcome = postingOutcomeMessage(json, 'Force repost')
        if (outcome.ok) setNotice(`${outcome.message} Logged to the audit trail.`)
        else setError(outcome.message)
        const refreshed = await fetchPaymentClearingBatch(marketplace, batchId)
        setPreview(refreshed)
        setPostingResult(json)
        await refreshPostingStatus(batchId)
        await loadSavedBatches()
      } catch (e) {
        setError(safeError(e))
      } finally {
        setPosting(false)
        setPostingStartedAt(null)
        setPostingProgress(null)
        await refreshPostClearingStepStatus(batchId)
      }
    },
    [loadSavedBatches, marketplace, preview?.batch?.batchId, refreshPostClearingStepStatus, refreshPostingStatus]
  )

  const onMarkAccountLevelFee = useCallback(
    async (rowNumber: number) => {
      const batchId = preview?.batch?.batchId
      if (!batchId) return
      setError('')
      setNotice('')
      try {
        const refreshed = await reclassifyAccountLevelFees(marketplace, batchId, [rowNumber])
        setPreview(refreshed)
        setNotice(refreshed.message || `Row ${rowNumber} marked as account-level fee.`)
      } catch (e) {
        setError(safeError(e))
      }
    },
    [marketplace, preview?.batch?.batchId]
  )

  const ctx: ClearingContext = {
    marketplace,
    currency: previewCurrency(preview, marketplace) || defaultCurrency(marketplace),
    preview,
    paymentPreview,
    postingResult,
    reports,
    savedBatches,
    zohoCustomers,
    zohoCustomerName,
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
    postingProgress,
    postingStartedAt,
    salesPostingMessage,
    postingReturnFees,
    search,
    isPosted,
    isApproved,
    isCleanForApproval,
    canGeneratePaymentPreview,
    canPostToZoho,
    canPostReturnFeeJournals,
    creditNoteApplyComplete,
    notReceivedCount,
    notReceivedComplete: notReceivedPostComplete,
    returnFeePostComplete,
    returnFeeBlockerCount,
    salesComplete,
    postingStatus,
    postingStatusLoading,
    refreshPostingStatus: async (batchId, message) => {
      await refreshPostClearingStepStatus(batchId)
      if (message) setNotice(message)
    },
    setReportId,
    setReportDocumentId,
    setBatchIdToOpen,
    setZohoCustomerName,
    onFetchReports,
    onPreview: () => void runPreview(false),
    onRefreshFromAmazon,
    onUploadSettlementFile: (file, forceRefresh) => void onUploadSettlementFile(file, forceRefresh),
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
      12: 'not_started',
    }
    if (!preview) return statuses
    statuses[2] = 'completed'
    statuses[3] = preview.unmatchedOrders.length > 0 || (preview.allRows || []).some((row) => row.status === 'missing_order_id')
      ? 'blocked'
      : 'completed'
    statuses[4] = creditNoteBlockingRows.length > 0 ? 'blocked' : 'completed'
    statuses[5] = legacySettlementMismatchBlocksClearing(preview) ? 'blocked' : 'completed'
    statuses[6] = isApproved || isPosted ? 'completed' : isCleanForApproval ? 'ready' : 'blocked'
    statuses[7] = unmappedFeeJournalCount > 0 ? 'blocked' : 'completed'
    statuses[8] = paymentPreview ? 'completed' : isApproved || isPosted ? 'ready' : 'not_started'
    statuses[9] = salesComplete
      ? 'completed'
      : salesPostingNeedsAttention
        ? 'blocked'
        : salesPostingStarted
          ? 'in_progress'
          : canPostToZoho && paymentPreview
            ? 'ready'
            : 'not_started'
    statuses[10] = creditNoteApplyComplete
      ? 'completed'
      : creditNotesNeedAttention
        ? 'blocked'
        : salesComplete
          ? 'ready'
          : 'not_started'
    statuses[11] = notReceivedCount === 0
      ? creditNoteApplyComplete
        ? 'completed'
        : 'not_started'
      : notReceivedPostComplete
        ? 'completed'
        : notReceivedNeedsAttention
          ? 'blocked'
          : salesComplete
            ? 'ready'
            : 'not_started'
    statuses[12] = returnFeePostComplete
      ? 'completed'
      : returnFeeBlockerCount > 0
        ? 'blocked'
        : salesComplete && creditNoteApplyComplete && notReceivedPostComplete
          ? 'ready'
          : 'not_started'
    const clearingStatus = postingStatus?.groups.find((group) => group.key === 'uncleared_clearing')?.status
    statuses[13] = clearingStatus === 'posted' || (clearingStatus === 'not_required' && returnFeePostComplete)
      ? 'completed'
      : clearingStatus === 'verification_required' || clearingStatus === 'failed'
        ? 'blocked'
        : salesComplete && returnFeePostComplete
          ? 'ready'
          : 'not_started'
    return statuses
  }, [postingStatus, canPostToZoho, creditNoteApplyComplete, creditNoteBlockingRows.length, creditNotesNeedAttention, isApproved, isCleanForApproval, isPosted, notReceivedCount, notReceivedNeedsAttention, notReceivedPostComplete, paymentPreview, preview, returnFeeBlockerCount, returnFeePostComplete, salesComplete, salesPostingNeedsAttention, salesPostingStarted, unmappedFeeJournalCount])

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
    11: <StepReturnsNotReceived ctx={ctx} />,
    12: <Step9ReturnFeeClearing ctx={ctx} />,
    13: <StepUnclearedClearing ctx={ctx} />,
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
    9: salesComplete
      ? 'Sales payments & fee journals posted'
      : salesPostingNeedsAttention
        ? 'Verification required'
        : salesPostingStarted
          ? 'Partially posted'
          : 'Not posted',
    10: creditNoteApplyComplete
      ? 'Credit notes refunded'
      : creditNotesNeedAttention
        ? 'Verification required'
        : salesComplete
          ? 'Refund pending'
          : 'After sales post',
    11: notReceivedCount === 0
      ? 'No returns marked not received'
      : notReceivedPostComplete
        ? `${notReceivedCount} not-received return(s) posted`
        : notReceivedNeedsAttention
          ? 'Verification required'
          : `${notReceivedCount} return(s) waiting to post`,
    12: returnFeePostComplete
      ? 'Return fees posted'
      : preview
        ? `${returnFeeBlockerCount} variance blocker(s)`
        : '',
    13: postingGroup('uncleared_clearing')?.status === 'posted'
      ? postingStatus?.settlementComplete
        ? 'Commission & shipping cleared · settlement complete'
        : 'Commission & shipping cleared'
      : returnFeePostComplete
        ? 'Ready to clear'
        : 'After return fees',
  }

  return (
    <div className="ainv-page apc-page">
      <section className="ainv-page__header">
        <div className="ainv-page__eyebrow ainv-page__eyebrow--amber">Management · Amazon · {marketplace}</div>
        <h1 className="ainv-page__title">{clearingPageTitle(marketplace)}</h1>
        <p className="ainv-page__lead">
          Fetch once, reconcile sales and returns against Zoho, and post grouped Record Payments — with every warning
          traceable to the exact settlement rows.
        </p>
        <div className="ainv-callout-emerald">
          <strong>Zoho posting guarded.</strong> Sales payments post in step 9 after reconciliation is clean. Return
          credit notes, returns not received and return fee journals run in steps 10–12, and commission &amp; shipping clearing in step 13, only after payments land in Zoho.
        </div>
      </section>

      <ClearingStepper
        marketplace={marketplace}
        activeStep={activeStep}
        stepStatuses={stepStatuses}
        onStepClick={goToStep}
      />

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
            blocker={status === 'blocked' ? (step.id === 13 ? 'Re-check the commission & shipping clearing journals in Zoho before continuing.' : step.id === 12 ? 'Resolve return fee variance blockers before posting journals.' : step.id === 11 ? 'Re-check the returns-not-received journal in Zoho before continuing.' : 'Resolve the blocking items before continuing.') : undefined}
          >
            {stepBodies[step.id]}
          </StepPanel>
        )
      })}

      <ForceRepostModal
        open={forceRepostOpen}
        postingSummary={preview?.postingSummary || preview?.batch?.postingSummary}
        busy={posting}
        progress={postingProgress}
        startedAt={postingStartedAt}
        onCancel={() => setForceRepostOpen(false)}
        onConfirm={onConfirmForceRepost}
      />
    </div>
  )
}

export default AmazonPaymentClearingPage

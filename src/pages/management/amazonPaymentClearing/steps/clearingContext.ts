import type {
  PaymentClearingPaymentPreview,
  PaymentClearingPreview,
  PaymentPostingResult,
  PostingJobProgress,
  PostingStatus,
  SavedBatchSummary,
  SettlementReport,
  KsaZohoCustomerOption,
} from '../../../../api/amazonPaymentClearing'
import type { useClearingSearch } from '../hooks/useClearingSearch'

export interface ClearingContext {
  marketplace: 'KSA' | 'UAE'
  currency: string
  preview: PaymentClearingPreview | null
  paymentPreview: PaymentClearingPaymentPreview | null
  postingResult: PaymentPostingResult | null

  reports: SettlementReport[]
  savedBatches: SavedBatchSummary[]
  zohoCustomers: KsaZohoCustomerOption[]
  zohoCustomerName: string
  reportId: string
  reportDocumentId: string
  batchIdToOpen: string

  loadingReports: boolean
  loadingBatches: boolean
  previewing: boolean
  reopening: boolean
  approving: boolean
  generatingPaymentPreview: boolean
  posting: boolean
  postingProgress: PostingJobProgress | null
  postingStartedAt: number | null
  /** Outcome of the last step 9 Dry Run / POST TO ZOHO, shown next to those buttons. */
  salesPostingMessage: { kind: 'error' | 'notice'; text: string } | null
  postingReturnFees: boolean

  search: ReturnType<typeof useClearingSearch>

  isPosted: boolean
  isApproved: boolean
  isCleanForApproval: boolean
  canGeneratePaymentPreview: boolean
  canPostToZoho: boolean
  canPostReturnFeeJournals: boolean
  creditNoteApplyComplete: boolean
  /** Returns marked "not received" in step 10 (expensed by the step 11 journal). */
  notReceivedCount: number
  /** True when nothing is marked not received, or the step 11 journal is posted. */
  notReceivedComplete: boolean
  returnFeePostComplete: boolean
  returnFeeBlockerCount: number
  /** Every sales payment and fee journal is posted and verified (not the whole settlement). */
  salesComplete: boolean
  postingStatus: PostingStatus | null
  postingStatusLoading: boolean
  refreshPostingStatus: (batchId?: string | number, message?: string) => Promise<void>

  setReportId: (value: string) => void
  setReportDocumentId: (value: string) => void
  setBatchIdToOpen: (value: string) => void
  setZohoCustomerName: (value: string) => void

  onFetchReports: () => void
  onPreview: () => void
  onRefreshFromAmazon: () => void
  onUploadSettlementFile: (file: File, forceRefresh?: boolean) => void
  onOpenBatchId: () => void
  onOpenSavedBatch: (batchId: number) => void
  onApprove: () => void
  onGeneratePaymentPreview: () => void
  onRunPosting: (dryRun: boolean) => void
  onPostReturnFeeJournals: (dryRun: boolean) => void
  onOpenForceRepost: () => void
  onReloadCurrentBatch: () => Promise<void>
  onMarkAccountLevelFee: (rowNumber: number) => Promise<void>
  refreshPostClearingStepStatus: (batchId?: string | number) => Promise<void>
  goToStep: (stepId: number) => void
  setNotice: (value: string) => void
}

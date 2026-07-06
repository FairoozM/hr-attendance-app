import type {
  PaymentClearingPaymentPreview,
  PaymentClearingPreview,
  PaymentPostingResult,
  SavedBatchSummary,
  SettlementReport,
  KsaZohoCustomerOption,
} from '../../../../api/amazonPaymentClearing'
import type { useClearingSearch } from '../hooks/useClearingSearch'

export interface ClearingContext {
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
  postingReturnFees: boolean

  search: ReturnType<typeof useClearingSearch>

  isPosted: boolean
  isApproved: boolean
  isCleanForApproval: boolean
  canGeneratePaymentPreview: boolean
  canPostToZoho: boolean
  canPostReturnFeeJournals: boolean
  creditNoteApplyComplete: boolean
  returnFeePostComplete: boolean

  setReportId: (value: string) => void
  setReportDocumentId: (value: string) => void
  setBatchIdToOpen: (value: string) => void
  setZohoCustomerName: (value: string) => void

  onFetchReports: () => void
  onPreview: () => void
  onRefreshFromAmazon: () => void
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

import { api, downloadBlob, postBinary } from './client'

/** Generous timeout: a 300-column template with hundreds of rows is a large upload. */
const PIPELINE_TIMEOUT_MS = 180_000

export type CatalogHealth = {
  configured: boolean
  reachable?: boolean
  readOnly?: boolean | null
  role?: string | null
  database?: string | null
  host?: string
  tls?: string
  applicationName?: string
  error?: string
}

export type InitialDraftHealth = {
  success: boolean
  catalog: CatalogHealth
  uploadLimitBytes: number
  acceptedExtensions: string[]
}

export type RowStatus = 'matched' | 'unmatched' | 'ambiguous' | 'skipped-no-sku'

export type CandidateSummary = {
  matchSource: string
  productId: number | null
  variantId: number | null
  itemCode: string
  productName: string
  status: string | null
}

export type PreviewRow = {
  rowNumber: number
  sku: string
  status: RowStatus
  reason: string | null
  duplicateSkuInUpload?: boolean
  productName: string | null
  matchSource: string | null
  /** How the SKU resolved: exactly, or only once letter case was ignored. */
  matchKind: 'exact' | 'case-insensitive' | null
  catalogItemCode: string | null
  candidates: CandidateSummary[]
  counts: { populated: number; preserved: number; conflicts: number; missing: number; images?: number }
}

export type PreviewSummary = {
  fileName: string
  sheetName: string
  headerRow: number
  firstDataRow: number
  firstDataRowBasis: string
  skuColumn: string
  templateColumns: number
  dataRowsInSheet: number
  rowsWithSku: number
  matched: number
  matchedIgnoringCase: number
  unmatched: number
  ambiguous: number
  duplicateSkuRows: number
  populatedCells: number
  preservedCells: number
  conflictCells: number
  missingCells: number
  notApplicableCells?: number
  gtinTransformationCount?: number
  surplusListValueCount: number
  ignoredColumnCount: number
  additionalSlotColumnCount: number
  neverWriteColumnCount: number
  imageColumnCount?: number
  imageCellsPopulated?: number
  imageCellConflicts?: number
  notice: string
}

/** Every state one approved source file can end up in. */
export type ImageStatus =
  | 'ready'
  | 'unmatched-filename'
  | 'ambiguous-sku'
  | 'duplicate-position'
  | 'unsupported-position'
  | 'unsupported-file'
  | 'delivery-copy-failed'
  | 'public-url-unreachable'

export type ImageRecord = {
  sourceKey: string
  filename: string
  sku: string
  detectedSku: string
  detectedPosition: string
  positionSlot: string
  positionNumber: number | null
  classification: 'main' | 'secondary' | ''
  matchStatus: string
  status: ImageStatus
  populationStatus: string
  publicUrl: string
  deliveryKey: string
  deliveryAction: string
  sourceSize: number
  width: number | null
  height: number | null
  httpStatus: number | null
  contentType: string
  existingExcelValue: string
  candidates: string[]
  warning: string
}

export type ImageSkuGroup = {
  sku: string
  productName: string
  main: ImageRecord | null
  secondary: ImageRecord[]
  problems: ImageRecord[]
  hasMainImage: boolean
}

export type ImageSummary = {
  sourceFiles: number
  matchedFiles: number
  matchedSkus: number
  skusWithMainImage: number
  skusMissingMainImage: number
  secondaryImages: number
  unmatchedFiles: number
  ambiguousFiles: number
  duplicatePositions: number
  unsupportedPositions: number
  unsupportedFiles: number
  deliveryFailures: number
  brokenUrls: number
  workbookSkusWithoutImages: number
}

export type ImagePreview = {
  enabled: boolean
  configured: boolean
  error: string | null
  batchPrefix: string
  retentionNote: string
  publicBaseUrl: string
  sourceBucket: string
  sourceTruncated: boolean
  urlChecksSkipped: number
  imageColumns: {
    mainColumn: string | null
    secondaryPositions: number[]
    outOfScope: Array<{ column: string; technicalHeader: string; reason: string }>
  } | null
  summary: ImageSummary
  skus: ImageSkuGroup[]
  unassigned: ImageRecord[]
}

/** An approved batch folder inside the configured source prefix. */
export type ImageBatch = {
  prefix: string
  label: string
  root: string
  available: boolean
  reason: string | null
}

export type ImageBatchesResponse = {
  success: boolean
  configuration: {
    sourceBucket: string
    sourceRoots: string[]
    deliveryBucket: string
    deliveryPrefix: string
    publicBaseUrl: string
    region: string
    problem: string | null
  }
  batches: ImageBatch[]
  error?: string
}

export type CellRecord = {
  rowNumber: number
  sku: string
  column: string
  technicalHeader: string
  displayLabel: string
  group?: string
  value?: string
  source?: string
  isConstant?: boolean
  existingValue?: string
  databaseValue?: string
  reason?: string
  rawValue?: string | null
}

export type GtinTransformationRecord = {
  rowNumber: number
  sku: string
  /** Zoho item name the seller SKU matched; the barcode comes from that item's SKU field. */
  matchedZohoItem?: string
  originalZohoBarcode: string
  finalAmazonGtin: string
  leadingZeroAdded: string
  gtinLength: number | string
  checkDigitStatus: string
  duplicateStatus?: string
  populationStatus: string
  warningOrConflict: string
}

export type ColumnRecord = {
  column: string
  technicalHeader: string
  displayLabel: string
  group?: string
  note?: string | null
  reason?: string
}

export type ReportOnlyField = {
  rowNumber: number
  sku: string
  field: string
  value: string
  note?: string
}

/** A website feature the template has no column left to hold. */
export type SurplusListValue = ReportOnlyField

export type Truncated<T> = { items: T[]; total: number; truncated: boolean }

export type InitialDraftPreview = {
  success: boolean
  notice: string
  summary: PreviewSummary
  sheets: Array<{ name: string; state: string }>
  rows: PreviewRow[]
  populated: Truncated<CellRecord>
  conflicts: Truncated<CellRecord>
  preservedIdentical: Truncated<CellRecord>
  missingValues: Truncated<CellRecord>
  notApplicable?: Truncated<CellRecord>
  gtinTransformations?: Truncated<GtinTransformationRecord>
  surplusListValues: Truncated<SurplusListValue>
  ignoredColumns: Truncated<ColumnRecord>
  additionalSlotColumns: Truncated<ColumnRecord>
  neverWriteColumns: Truncated<ColumnRecord>
  reportOnlyFields: Truncated<ReportOnlyField>
  images?: ImagePreview
}

/**
 * The batch folder is the only image input the browser sends. The backend confines it to
 * the configured bucket and approved root prefixes.
 */
function formDataFor(file: File, imageBatch?: string): FormData {
  const form = new FormData()
  form.append('file', file)
  if (imageBatch) form.append('imageBatch', imageBatch)
  return form
}

export function getInitialDraftHealth(): Promise<InitialDraftHealth> {
  return api.get('/api/amazon-initial-draft/health') as Promise<InitialDraftHealth>
}

export function getImageBatches(): Promise<ImageBatchesResponse> {
  return api.get('/api/amazon-initial-draft/image-batches') as Promise<ImageBatchesResponse>
}

export function previewInitialDraft(file: File, imageBatch?: string): Promise<InitialDraftPreview> {
  return api.postForm('/api/amazon-initial-draft/preview', formDataFor(file, imageBatch), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  }) as Promise<InitialDraftPreview>
}

/** Downloads the patched Amazon workbook, keeping the uploaded file's own extension. */
export async function downloadInitialDraft(file: File, imageBatch?: string): Promise<string> {
  const { blob, filename } = await postBinary('/api/amazon-initial-draft/draft', formDataFor(file, imageBatch), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  })
  const fallback = file.name.replace(/\.(xlsm|xlsx)$/i, '-initial-draft.$1')
  const name = filename || fallback
  downloadBlob(blob, name)
  return name
}

export async function downloadInitialDraftReport(file: File, imageBatch?: string): Promise<string> {
  const { blob, filename } = await postBinary('/api/amazon-initial-draft/report', formDataFor(file, imageBatch), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  })
  const name = filename || 'amazon-uae-initial-draft-report.xlsx'
  downloadBlob(blob, name)
  return name
}

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
  counts: { populated: number; preserved: number; conflicts: number; missing: number }
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
  surplusListValueCount: number
  ignoredColumnCount: number
  additionalSlotColumnCount: number
  neverWriteColumnCount: number
  notice: string
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
  surplusListValues: Truncated<SurplusListValue>
  ignoredColumns: Truncated<ColumnRecord>
  additionalSlotColumns: Truncated<ColumnRecord>
  neverWriteColumns: Truncated<ColumnRecord>
  reportOnlyFields: Truncated<ReportOnlyField>
}

function formDataFor(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  return form
}

export function getInitialDraftHealth(): Promise<InitialDraftHealth> {
  return api.get('/api/amazon-initial-draft/health') as Promise<InitialDraftHealth>
}

export function previewInitialDraft(file: File): Promise<InitialDraftPreview> {
  return api.postForm('/api/amazon-initial-draft/preview', formDataFor(file), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  }) as Promise<InitialDraftPreview>
}

/** Downloads the patched Amazon workbook, keeping the uploaded file's own extension. */
export async function downloadInitialDraft(file: File): Promise<string> {
  const { blob, filename } = await postBinary('/api/amazon-initial-draft/draft', formDataFor(file), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  })
  const fallback = file.name.replace(/\.(xlsm|xlsx)$/i, '-initial-draft.$1')
  const name = filename || fallback
  downloadBlob(blob, name)
  return name
}

export async function downloadInitialDraftReport(file: File): Promise<string> {
  const { blob, filename } = await postBinary('/api/amazon-initial-draft/report', formDataFor(file), {
    timeoutMs: PIPELINE_TIMEOUT_MS,
  })
  const name = filename || 'amazon-uae-initial-draft-report.xlsx'
  downloadBlob(blob, name)
  return name
}

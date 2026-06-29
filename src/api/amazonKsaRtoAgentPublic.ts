import { api } from './client'

const PREFIX = '/api/public/amazon/ksa-rto-labeling'

export type AgentRowStatus = 'not_checked' | 'checked' | 'issue'
export type AgentBatchStatus = 'pending' | 'in_progress' | 'completed'

export interface PublicKsaRtoFile {
  fileName: string
  downloadUrl: string
  mimeType: string
  fileSize: number
}

export interface PublicKsaRtoRow {
  id: number
  productCode: string
  productTitle: string
  companyCode: string
  fnskuNo: string
  quantity: number
  status: string
  productImage: PublicKsaRtoFile | null
  labelPdf: PublicKsaRtoFile | null
  agentRowStatus: AgentRowStatus
  agentRowNote: string
  agentCheckedAt?: string | null
}

export interface PublicKsaRtoBatch {
  id: number
  batchTitle: string
  referenceNo: string
  destination: string
  notes: string
  agentStatus: AgentBatchStatus
  agentNotes: string
  agentCompletedAt?: string | null
  agentCompletedByName: string
  shareExpiresAt?: string | null
  summary: {
    totalLines: number
    totalQuantity: number
    ready: number
    missingFnsku: number
    missingImage: number
    missingPdf: number
    checked: number
    issues: number
    notChecked: number
  }
  rows: PublicKsaRtoRow[]
}

export async function getPublicKsaRtoBatch(shareToken: string) {
  return api.get(`${PREFIX}/${encodeURIComponent(shareToken)}`) as Promise<{ batch: PublicKsaRtoBatch }>
}

export async function updatePublicKsaRtoRowStatus(
  shareToken: string,
  rowId: number | string,
  payload: { agentRowStatus: AgentRowStatus; agentRowNote?: string }
) {
  return api.post(`${PREFIX}/${encodeURIComponent(shareToken)}/rows/${rowId}/status`, payload) as Promise<{ batch: PublicKsaRtoBatch }>
}

export async function completePublicKsaRtoBatch(
  shareToken: string,
  payload: { agentNotes?: string; completedByName?: string }
) {
  return api.post(`${PREFIX}/${encodeURIComponent(shareToken)}/complete`, payload) as Promise<{ batch: PublicKsaRtoBatch }>
}

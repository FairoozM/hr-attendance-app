/** Shared ISO & QMS domain types (camelCase, matching API responses). */

export type IsoDocumentStatus =
  | 'Draft'
  | 'Under Review'
  | 'Approved'
  | 'Current'
  | 'Superseded'
  | 'Obsolete'
  | 'Archived'
  | 'Expired'

export type IsoDocumentType =
  | 'Quality Manual'
  | 'Policy'
  | 'Procedure'
  | 'Work Instruction'
  | 'Annexure'
  | 'Form Template'
  | 'Completed Form'
  | 'Register'
  | 'Audit Record'
  | 'Management Review Record'
  | 'Corrective Action'
  | 'Risk Record'
  | 'Objective/KPI Record'
  | 'Supplier Record'
  | 'Training Record'
  | 'Calibration Record'
  | 'Maintenance Record'
  | 'Certificate'
  | 'External Document'
  | 'Other Evidence'

export type IsoExtractionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_warning'
  | 'failed'

export type IsoConfidentiality = 'public' | 'internal' | 'confidential' | 'restricted'

export interface IsoCategory {
  id: number
  code: string
  name: string
  description?: string | null
}

export interface IsoClause {
  id: number
  clauseNumber: string
  title: string
  parentClauseNumber?: string | null
  sortOrder?: number
}

export interface IsoDocumentVersion {
  id: number
  documentId: number
  revisionNumber: string
  status: IsoDocumentStatus
  originalFilename: string
  fileType: string
  fileSize: number
  storageKey: string
  checksumSha256?: string | null
  extractionStatus?: IsoExtractionStatus | null
  extractedTextPreview?: string | null
  revisionComments?: string | null
  uploadedBy?: number | null
  uploadedByName?: string | null
  uploadedAt?: string | null
  createdAt?: string | null
}

export interface IsoDocument {
  id: number
  title: string
  documentCode: string
  documentType: IsoDocumentType | string
  categoryId?: number | null
  categoryName?: string | null
  categoryCode?: string | null
  department?: string | null
  revision?: string | null
  issueDate?: string | null
  revisionDate?: string | null
  reviewDate?: string | null
  expiryDate?: string | null
  preparedBy?: string | null
  reviewedBy?: string | null
  approvedBy?: string | null
  owner?: string | null
  status: IsoDocumentStatus | string
  originalFilename?: string | null
  fileType?: string | null
  fileSize?: number | null
  tags?: string[]
  description?: string | null
  retentionPeriod?: string | null
  masterCopyLocation?: string | null
  distribution?: string | null
  confidentiality?: IsoConfidentiality | string | null
  publishToAuditorRoom?: boolean
  auditorDownloadAllowed?: boolean
  currentVersionId?: number | null
  currentVersion?: IsoDocumentVersion | null
  clauses?: IsoClause[]
  obsoleteDate?: string | null
  obsoleteReason?: string | null
  uploadedBy?: number | null
  uploadedByName?: string | null
  uploadedAt?: string | null
  updatedAt?: string | null
  createdAt?: string | null
}

export interface IsoDocumentListResponse {
  items: IsoDocument[]
  total: number
  page?: number
  pageSize?: number
}

export interface IsoDocumentFilters {
  search?: string
  status?: string
  documentType?: string
  categoryId?: string | number
  category?: string
  department?: string
  clause?: string
  auditYear?: string
  publishToAuditorRoom?: boolean | string
  currentOnly?: boolean | string
  includeObsolete?: boolean | string
  fileType?: string
  reviewDue?: boolean | string
  expired?: boolean | string
  page?: number
  pageSize?: number
  sort?: string
}

export interface IsoDashboardChecklistItem {
  key: string
  label: string
  current: number
  required: number
  filterPath?: string
}

export interface IsoDashboardStats {
  totalControlledDocuments: number
  currentApprovedDocuments: number
  draftOrPendingDocuments: number
  obsoleteDocuments: number
  totalQmsRecords: number
  documentsRequiringReview: number
  expiredExternalCertificates: number
  openAuditFindings: number
  overdueCorrectiveActions: number
  openRisksRequiringAction: number
  upcomingCalibrationDates: number
  upcomingManagementReviews: number
  upcomingAudits: number
  checklist?: IsoDashboardChecklistItem[]
  recentUploads?: IsoDocument[]
  recentlyRevised?: IsoDocument[]
  awaitingApproval?: IsoDocument[]
  correctiveActionsDue?: IsoCorrectiveAction[]
  expiredCertificates?: IsoExternalCertificate[]
  calibrationsDue?: IsoCalibration[]
  recentActivity?: IsoActivityLogEntry[]
}

export interface IsoSearchResult {
  id: string | number
  entityType: string
  title: string
  documentCode?: string | null
  revision?: string | null
  status?: string | null
  category?: string | null
  department?: string | null
  clause?: string | null
  snippet?: string | null
  isObsolete?: boolean
  score?: number
  documentId?: number | null
  versionId?: number | null
  canDownload?: boolean
}

export interface IsoSearchResponse {
  items: IsoSearchResult[]
  total: number
  page?: number
  pageSize?: number
}

export interface IsoMasterDocumentRow {
  serialNumber: number
  internalExternal: string
  category: string
  documentNumber: string
  documentTitle: string
  revisionNumber: string
  issueDate?: string | null
  revisionDate?: string | null
  preparedBy?: string | null
  reviewedBy?: string | null
  approvedBy?: string | null
  masterCopyLocation?: string | null
  distribution?: string | null
  status: string
  remarks?: string | null
  documentId?: number | null
}

export interface IsoMasterRecordRow {
  formatReference: string
  formatDescription: string
  department?: string | null
  medium?: string | null
  issueDate?: string | null
  revision?: string | null
  revisionDate?: string | null
  retentionPeriod?: string | null
  custodian?: string | null
  location?: string | null
  recordStatus?: string | null
  evidenceCount: number
  latestRecordDate?: string | null
  remarks?: string | null
}

export type IsoAuditType =
  | 'Internal'
  | 'Surveillance'
  | 'Recertification'
  | 'Supplier'
  | 'Other External'

export type IsoAuditStatus =
  | 'Draft'
  | 'Planned'
  | 'In Progress'
  | 'Awaiting Response'
  | 'Under Closure Review'
  | 'Closed'
  | 'Cancelled'

export interface IsoAudit {
  id: number
  auditReference: string
  auditType: IsoAuditType | string
  auditYear?: number | null
  status: IsoAuditStatus | string
  standard?: string | null
  scope?: string | null
  location?: string | null
  plannedDate?: string | null
  actualDate?: string | null
  leadAuditor?: string | null
  additionalAuditors?: string | null
  auditees?: string | null
  departments?: string | null
  applicableClauses?: string | null
  openingMeetingAt?: string | null
  closingMeetingAt?: string | null
  objective?: string | null
  criteria?: string | null
  notes?: string | null
  accessStartAt?: string | null
  accessEndAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  sections?: IsoAuditSection[]
  checklistItems?: IsoAuditChecklistItem[]
}

export interface IsoAuditSection {
  id: number
  auditId: number
  title: string
  clauseNumber?: string | null
  sortOrder?: number
}

export interface IsoAuditChecklistItem {
  id: number
  auditId: number
  sectionId?: number | null
  question: string
  clauseNumber?: string | null
  processDepartment?: string | null
  auditorNote?: string | null
  outcome?: string | null
  responsiblePerson?: string | null
  findingId?: number | null
  updatedAt?: string | null
}

export type IsoFindingClassification =
  | 'Major Nonconformity'
  | 'Minor Nonconformity'
  | 'Observation'
  | 'Opportunity for Improvement'

export interface IsoFinding {
  id: number
  ncNumber: string
  findingDate?: string | null
  source?: string | null
  auditId?: number | null
  auditReference?: string | null
  department?: string | null
  clauseNumber?: string | null
  description?: string | null
  evidence?: string | null
  classification?: IsoFindingClassification | string | null
  immediateCorrection?: string | null
  responsibleOwner?: string | null
  status?: string | null
  createdAt?: string | null
  correctiveActions?: IsoCorrectiveAction[]
}

export type IsoCaStatus =
  | 'Open'
  | 'Root Cause Required'
  | 'Action Planned'
  | 'In Progress'
  | 'Awaiting Evidence'
  | 'Effectiveness Review'
  | 'Closed'
  | 'Rejected/Reopened'

export interface IsoCorrectiveAction {
  id: number
  caNumber: string
  findingId?: number | null
  ncNumber?: string | null
  description?: string | null
  immediateCorrection?: string | null
  rootCause?: string | null
  correctiveActionDetails?: string | null
  responsiblePerson?: string | null
  targetDate?: string | null
  evidence?: string | null
  effectivenessReview?: string | null
  closureDetails?: string | null
  verifiedBy?: string | null
  verificationDate?: string | null
  closedDate?: string | null
  status: IsoCaStatus | string
  createdAt?: string | null
  updatedAt?: string | null
}

export interface IsoManagementReview {
  id: number
  mrmReference: string
  meetingDate?: string | null
  venue?: string | null
  chairperson?: string | null
  participants?: string | null
  status?: string | null
  nextMeetingDate?: string | null
  createdAt?: string | null
}

export interface IsoRisk {
  id: number
  riskNumber: string
  reviewDate?: string | null
  nextReviewDate?: string | null
  department?: string | null
  process?: string | null
  potentialFailure?: string | null
  potentialEffect?: string | null
  existingControls?: string | null
  severity?: number | null
  likelihood?: number | null
  rating?: number | null
  significant?: boolean
  recommendedAction?: string | null
  responsiblePerson?: string | null
  targetDate?: string | null
  actionResult?: string | null
  status?: string | null
}

export interface IsoQualityObjective {
  id: number
  year: number
  objective: string
  target?: string | null
  measurementMethod?: string | null
  responsibleDepartment?: string | null
  responsiblePerson?: string | null
  reviewFrequency?: string | null
  currentResult?: string | null
  status?: string | null
}

export interface IsoSupplier {
  id: number
  name: string
  contactPerson?: string | null
  email?: string | null
  telephone?: string | null
  address?: string | null
  materialService?: string | null
  approvalDate?: string | null
  approvalMethod?: string | null
  status?: string | null
  isoCertified?: boolean
  notes?: string | null
}

export interface IsoEquipment {
  id: number
  equipmentNumber: string
  name: string
  brand?: string | null
  model?: string | null
  serialNumber?: string | null
  capacityRange?: string | null
  department?: string | null
  owner?: string | null
  status?: string | null
  calibrationRequired?: boolean
  maintenanceFrequency?: string | null
  currentCondition?: string | null
}

export interface IsoMaintenanceLog {
  id: number
  equipmentId?: number | null
  equipmentNumber?: string | null
  logDate?: string | null
  natureOfProblem?: string | null
  actionTaken?: string | null
  spareParts?: string | null
  maintenanceType?: string | null
  serviceProvider?: string | null
  cost?: number | null
  completedBy?: string | null
  reviewedBy?: string | null
  remarks?: string | null
}

export interface IsoCalibration {
  id: number
  equipmentId?: number | null
  equipmentNumber?: string | null
  equipmentName?: string | null
  certificateNumber?: string | null
  calibrationProvider?: string | null
  calibrationDate?: string | null
  dueDate?: string | null
  range?: string | null
  resolution?: string | null
  results?: string | null
  traceabilityStandard?: string | null
  status?: string | null
}

export interface IsoExternalCertificate {
  id: number
  title: string
  certificateType?: string | null
  standard?: string | null
  certificateNumber?: string | null
  issuingBody?: string | null
  issueDate?: string | null
  expiryDate?: string | null
  status?: string | null
  documentId?: number | null
}

export interface IsoActivityLogEntry {
  id: number
  action: string
  entityType?: string | null
  entityId?: number | string | null
  message?: string | null
  userId?: number | null
  userName?: string | null
  createdAt?: string | null
}

export interface IsoAuditorAssignment {
  id: number
  userId: number
  userName?: string | null
  auditId?: number | null
  auditReference?: string | null
  accessStartAt?: string | null
  accessEndAt?: string | null
  revokedAt?: string | null
  canCreateFindings?: boolean
  canAddComments?: boolean
  lastLoginAt?: string | null
  lastActivityAt?: string | null
  active?: boolean
}

export interface IsoSettings {
  companyName?: string | null
  certificationScope?: string | null
  certificationBody?: string | null
  certificateNumber?: string | null
  standard?: string | null
  qualityManager?: string | null
  auditorViewDefault?: boolean
  notes?: string | null
  [key: string]: unknown
}

export interface IsoAuditorRoomSection {
  key: string
  title: string
  clauseNumber?: string | null
  procedureCode?: string | null
  procedureTitle?: string | null
  evidenceCount: number
  latestDocument?: IsoDocument | null
}

export interface IsoAuditorRoomResponse {
  sections: IsoAuditorRoomSection[]
  settings?: IsoSettings | null
  auditorView?: boolean
}

export interface IsoPresignRequest {
  filename: string
  contentType: string
  fileSize: number
}

export interface IsoPresignResponse {
  uploadUrl: string
  storageKey: string
  headers?: Record<string, string>
  expiresIn?: number
}

export interface IsoConfirmUploadPayload {
  storageKey: string
  originalFilename: string
  contentType: string
  fileSize: number
  checksumSha256?: string
  title?: string
  documentCode?: string
  documentType?: string
  categoryId?: number | null
  department?: string
  confidentiality?: string
  description?: string
  tags?: string[]
  clauses?: string[]
  revision?: string
  issueDate?: string | null
  reviewDate?: string | null
  publishToAuditorRoom?: boolean
  auditorDownloadAllowed?: boolean
  documentId?: number | null
  revisionComments?: string
}

export interface FilenameSuggestion {
  title: string
  documentCode: string | null
  documentType: string | null
  categoryHint: string | null
  revision: string | null
  auditYear: string | null
}

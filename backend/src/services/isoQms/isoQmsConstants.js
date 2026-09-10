/** ISO & QMS shared constants (no copyrighted ISO standard text). */

const DOCUMENT_TYPES = [
  'Quality Manual',
  'Policy',
  'Procedure',
  'Work Instruction',
  'Annexure',
  'Form Template',
  'Completed Form',
  'Register',
  'Audit Record',
  'Management Review Record',
  'Corrective Action',
  'Risk Record',
  'Objective/KPI Record',
  'Supplier Record',
  'Training Record',
  'Calibration Record',
  'Maintenance Record',
  'Certificate',
  'External Document',
  'Other Evidence',
]

const DOCUMENT_STATUSES = [
  'Draft',
  'Under Review',
  'Approved',
  'Current',
  'Superseded',
  'Obsolete',
  'Archived',
  'Expired',
]

const CURRENT_LIKE_STATUSES = ['Approved', 'Current']

const AUDITOR_VISIBLE_STATUSES = ['Approved', 'Current']

const AUDIT_TYPES = [
  'Internal',
  'Surveillance',
  'Recertification',
  'Supplier',
  'External',
  'Other',
]

const AUDIT_STATUSES = [
  'Draft',
  'Planned',
  'In Progress',
  'Awaiting Response',
  'Under Closure Review',
  'Closed',
  'Cancelled',
]

const FINDING_CLASSIFICATIONS = [
  'Major Nonconformity',
  'Minor Nonconformity',
  'Observation',
  'Opportunity for Improvement',
]

const FINDING_SOURCES = [
  'Internal audit',
  'External audit',
  'Customer complaint',
  'Supplier issue',
  'Warehouse inspection',
  'Management review',
  'Other',
]

const FINDING_STATUSES = ['Open', 'In Progress', 'Closed', 'Cancelled']

const CA_STATUSES = [
  'Open',
  'In Progress',
  'Pending Verification',
  'Closed',
  'Cancelled',
]

const CHECKLIST_OUTCOMES = [
  'Conforming',
  'Opportunity for Improvement',
  'Observation',
  'Minor Nonconformity',
  'Major Nonconformity',
  'Not Applicable',
  'Not Reviewed',
]

const CONFIDENTIALITY_LEVELS = [
  'Public',
  'Internal',
  'Confidential',
  'Restricted HR',
]

const EXTRACTION_STATUSES = [
  'Pending',
  'Processing',
  'Completed',
  'Completed with warning',
  'Failed',
]

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]

/** Expected controlled document codes for audit-readiness checklist (live counts only). */
const REQUIRED_CONTROLLED_DOCUMENT_CODES = [
  'LIF-QMS-M-01',
  'LIF-QMS-M-ANX-01A',
  'LIF-QMS-M-ANX-01B',
  'LIF-QMS-M-ANX-01C',
  'LIF-QMS-M-ANX-01D',
  'LIF-QMS-M-ANX-01E',
  'LIF-QMS-PR-01',
  'LIF-QMS-PR-02',
  'LIF-QMS-PR-03',
  'LIF-QMS-PR-04',
  'LIF-QMS-PR-05',
  'LIF-QMS-PR-06',
  'LIF-QMS-PR-07',
  'LIF-QMS-PR-08',
  'LIF-QMS-PR-09',
  'LIF-QMS-PR-10',
  'LIF-QMS-PR-11',
  'LIF-QMS-PR-12',
  'LIF-QMS-PR-13',
]

/**
 * Auditor Room sections → primary ISO clause numbers (internal mapping only).
 * Evidence is resolved from live published documents / linked records.
 */
const AUDITOR_ROOM_SECTIONS = [
  { id: 'overview', title: 'Company and QMS overview', clauses: ['4', '4.3', '4.4'] },
  { id: 'scope', title: 'Certification scope', clauses: ['4.3'] },
  { id: 'quality_manual', title: 'Quality Manual', clauses: ['4.4', '7.5'] },
  { id: 'quality_policy', title: 'Quality Policy', clauses: ['5.2'] },
  { id: 'quality_objectives', title: 'Quality Objectives', clauses: ['6.2'] },
  { id: 'org_chart', title: 'Organization Chart', clauses: ['5.3'] },
  { id: 'process_interaction', title: 'Process interaction', clauses: ['4.4'] },
  { id: 'procedures', title: 'Controlled procedures', clauses: ['7.5', '8.1'] },
  { id: 'master_documents', title: 'Master List of Documents', clauses: ['7.5'] },
  { id: 'master_records', title: 'Master List of Records', clauses: ['7.5'] },
  { id: 'internal_audits', title: 'Internal audits', clauses: ['9.2'] },
  { id: 'management_reviews', title: 'Management Review Meetings', clauses: ['9.3'] },
  { id: 'risks', title: 'Risks and opportunities', clauses: ['6.1'] },
  { id: 'corrective_actions', title: 'Nonconformities and corrective actions', clauses: ['10.2'] },
  { id: 'suppliers', title: 'Supplier controls', clauses: ['8.4'] },
  { id: 'customer', title: 'Customer complaints and satisfaction', clauses: ['9.1', '8.2'] },
  { id: 'hr', title: 'HR competence and training', clauses: ['7.2', '7.3'] },
  { id: 'warehouse', title: 'Warehouse and operational controls', clauses: ['8.5', '8.6'] },
  { id: 'maintenance', title: 'Maintenance and calibration', clauses: ['7.1.5'] },
  { id: 'certificates', title: 'External certificates and compliance evidence', clauses: ['4.2', '7.5'] },
  { id: 'current_audit', title: 'Current audit workspace', clauses: ['9.2'] },
]

const CONTROLLED_METADATA_FIELDS = [
  'title',
  'document_code',
  'document_type',
  'category_id',
  'department',
  'revision',
  'issue_date',
  'revision_date',
  'review_date',
  'expiry_date',
  'prepared_by',
  'reviewed_by',
  'approved_by',
  'owner_name',
  'retention_period',
  'master_copy_location',
  'distribution',
  'confidentiality',
]

const ISO_QMS_PERMISSION_MODULE = 'iso_qms'

const ISO_QMS_ACTIONS = [
  'view',
  'add',
  'edit',
  'delete',
  'approve',
  'manage_audits',
  'settings',
]

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  CURRENT_LIKE_STATUSES,
  AUDITOR_VISIBLE_STATUSES,
  AUDIT_TYPES,
  AUDIT_STATUSES,
  FINDING_CLASSIFICATIONS,
  FINDING_SOURCES,
  FINDING_STATUSES,
  CA_STATUSES,
  CHECKLIST_OUTCOMES,
  CONFIDENTIALITY_LEVELS,
  EXTRACTION_STATUSES,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  REQUIRED_CONTROLLED_DOCUMENT_CODES,
  AUDITOR_ROOM_SECTIONS,
  CONTROLLED_METADATA_FIELDS,
  ISO_QMS_PERMISSION_MODULE,
  ISO_QMS_ACTIONS,
}

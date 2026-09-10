const ExcelJS = require('exceljs')
const { query } = require('../../db')

/**
 * Master List of Documents (FO-01A shape) from live iso_documents metadata.
 */
async function getMasterDocuments(filters = {}) {
  const params = []
  const where = [`d.soft_deleted_at IS NULL`]
  if (filters.status) {
    params.push(filters.status)
    where.push(`d.status = $${params.length}`)
  } else {
    where.push(`d.status NOT IN ('Archived')`)
  }
  if (filters.department) {
    params.push(filters.department)
    where.push(`d.department ILIKE $${params.length}`)
  }
  if (filters.categoryId) {
    params.push(Number(filters.categoryId))
    where.push(`d.category_id = $${params.length}`)
  }

  const result = await query(
    `SELECT d.*, c.name AS category_name
     FROM iso_documents d
     LEFT JOIN iso_categories c ON c.id = d.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY d.document_code NULLS LAST, d.title`,
    params
  )

  return result.rows.map((r, idx) => ({
    serialNumber: idx + 1,
    internalExternal: r.is_external ? 'External' : 'Internal',
    category: r.category_name || null,
    documentNumber: r.document_code,
    documentTitle: r.title,
    revisionNumber: r.revision,
    issueDate: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
    revisionDate: r.revision_date ? String(r.revision_date).slice(0, 10) : null,
    preparedBy: r.prepared_by,
    reviewedBy: r.reviewed_by,
    approvedBy: r.approved_by,
    masterCopyLocation: r.master_copy_location,
    distribution: r.distribution,
    status: r.status,
    remarks: r.remarks,
    documentId: Number(r.id),
  }))
}

/**
 * Master List of Records (FO-02A) from iso_record_types + live evidence counts.
 */
async function getMasterRecords(filters = {}) {
  const params = []
  const where = []
  if (filters.department) {
    params.push(filters.department)
    where.push(`rt.department ILIKE $${params.length}`)
  }
  if (filters.recordStatus) {
    params.push(filters.recordStatus)
    where.push(`rt.record_status = $${params.length}`)
  }

  const result = await query(
    `SELECT rt.*,
            (
              SELECT COUNT(*)::int FROM iso_documents d
              WHERE d.soft_deleted_at IS NULL
                AND (
                  UPPER(COALESCE(d.document_code,'')) LIKE '%' || UPPER(rt.format_code) || '%'
                  OR d.title ILIKE '%' || rt.format_description || '%'
                )
            ) AS evidence_count,
            (
              SELECT MAX(COALESCE(d.revision_date, d.issue_date, d.updated_at::date))
              FROM iso_documents d
              WHERE d.soft_deleted_at IS NULL
                AND UPPER(COALESCE(d.document_code,'')) LIKE '%' || UPPER(rt.format_code) || '%'
            ) AS latest_record_date
     FROM iso_record_types rt
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY rt.sort_order, rt.format_code`,
    params
  )

  return result.rows.map((r) => ({
    formatReference: r.format_code,
    formatDescription: r.format_description,
    department: r.department,
    medium: r.medium,
    issueDate: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
    revision: r.revision,
    revisionDate: r.revision_date ? String(r.revision_date).slice(0, 10) : null,
    retentionPeriod: r.retention_period,
    custodian: r.custodian,
    location: r.location,
    recordStatus: r.record_status,
    evidenceCount: Number(r.evidence_count || 0),
    latestRecordDate: r.latest_record_date ? String(r.latest_record_date).slice(0, 10) : null,
    remarks: r.remarks,
    id: Number(r.id),
  }))
}

async function exportMasterDocumentsExcel(filters = {}) {
  const rows = await getMasterDocuments(filters)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Life Smile QMS'
  const sheet = workbook.addWorksheet('Master List of Documents')
  sheet.columns = [
    { header: 'S/N', key: 'serialNumber', width: 6 },
    { header: 'Internal/External', key: 'internalExternal', width: 14 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Document Number', key: 'documentNumber', width: 20 },
    { header: 'Document Title', key: 'documentTitle', width: 40 },
    { header: 'Revision', key: 'revisionNumber', width: 10 },
    { header: 'Issue Date', key: 'issueDate', width: 12 },
    { header: 'Revision Date', key: 'revisionDate', width: 12 },
    { header: 'Prepared By', key: 'preparedBy', width: 16 },
    { header: 'Reviewed By', key: 'reviewedBy', width: 16 },
    { header: 'Approved By', key: 'approvedBy', width: 16 },
    { header: 'Master Copy Location', key: 'masterCopyLocation', width: 22 },
    { header: 'Distribution', key: 'distribution', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 24 },
  ]
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(1).font = { bold: true }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

async function exportMasterRecordsExcel(filters = {}) {
  const rows = await getMasterRecords(filters)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Life Smile QMS'
  const sheet = workbook.addWorksheet('Master List of Records')
  sheet.columns = [
    { header: 'Format Reference', key: 'formatReference', width: 14 },
    { header: 'Format Description', key: 'formatDescription', width: 40 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Medium', key: 'medium', width: 12 },
    { header: 'Issue Date', key: 'issueDate', width: 12 },
    { header: 'Revision', key: 'revision', width: 10 },
    { header: 'Revision Date', key: 'revisionDate', width: 12 },
    { header: 'Retention', key: 'retentionPeriod', width: 14 },
    { header: 'Custodian', key: 'custodian', width: 16 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Status', key: 'recordStatus', width: 12 },
    { header: 'Evidence Count', key: 'evidenceCount', width: 14 },
    { header: 'Latest Record Date', key: 'latestRecordDate', width: 16 },
    { header: 'Remarks', key: 'remarks', width: 24 },
  ]
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(1).font = { bold: true }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

async function exportSimpleSheet(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Life Smile QMS'
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(1).font = { bold: true }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function exportFindingsExcel(filters = {}) {
  const findingsService = require('./isoFindingsService')
  const items = await findingsService.listFindings(filters)
  return exportSimpleSheet(
    'Findings',
    [
      { header: 'NC Number', key: 'ncNumber', width: 14 },
      { header: 'Date', key: 'findingDate', width: 12 },
      { header: 'Source', key: 'source', width: 16 },
      { header: 'Department', key: 'department', width: 16 },
      { header: 'Clause', key: 'isoClause', width: 10 },
      { header: 'Classification', key: 'classification', width: 18 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Description', key: 'description', width: 48 },
    ],
    items
  )
}

async function exportCorrectiveActionsExcel(filters = {}) {
  const findingsService = require('./isoFindingsService')
  const items = await findingsService.listCorrectiveActions(filters)
  return exportSimpleSheet(
    'Corrective Actions',
    [
      { header: 'CA Number', key: 'caNumber', width: 12 },
      { header: 'Related NC', key: 'relatedNcNumber', width: 14 },
      { header: 'Responsible', key: 'responsiblePerson', width: 18 },
      { header: 'Target Date', key: 'targetDate', width: 12 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Root Cause', key: 'rootCause', width: 36 },
      { header: 'Corrective Action', key: 'correctiveActionDetails', width: 36 },
      { header: 'Verified By', key: 'verifierName', width: 16 },
      { header: 'Closed Date', key: 'closedDate', width: 12 },
    ],
    items
  )
}

module.exports = {
  getMasterDocuments,
  getMasterRecords,
  exportMasterDocumentsExcel,
  exportMasterRecordsExcel,
  exportFindingsExcel,
  exportCorrectiveActionsExcel,
}

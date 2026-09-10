const { query } = require('../../db')
const { logActivity } = require('./isoActivityLogService')
const { AUDIT_STATUSES, AUDIT_TYPES, CHECKLIST_OUTCOMES } = require('./isoQmsConstants')

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function mapAudit(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    auditReference: row.audit_reference,
    auditType: row.audit_type,
    auditYear: row.audit_year != null ? Number(row.audit_year) : null,
    status: row.status,
    standard: row.standard,
    scope: row.scope,
    location: row.location,
    plannedDate: row.planned_date ? String(row.planned_date).slice(0, 10) : null,
    actualDate: row.actual_date ? String(row.actual_date).slice(0, 10) : null,
    leadAuditor: row.lead_auditor,
    additionalAuditors: row.additional_auditors,
    auditees: row.auditees,
    departments: row.departments,
    applicableClauses: row.applicable_clauses,
    openingMeetingAt: row.opening_meeting_at ? new Date(row.opening_meeting_at).toISOString() : null,
    closingMeetingAt: row.closing_meeting_at ? new Date(row.closing_meeting_at).toISOString() : null,
    openingMeetingNotes: row.opening_meeting_notes,
    closingMeetingNotes: row.closing_meeting_notes,
    auditObjective: row.audit_objective,
    auditCriteria: row.audit_criteria,
    notes: row.notes,
    accessStartDate: row.access_start_date ? String(row.access_start_date).slice(0, 10) : null,
    accessEndDate: row.access_end_date ? String(row.access_end_date).slice(0, 10) : null,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapSection(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    auditId: Number(row.audit_id),
    title: row.title,
    clauseNumber: row.clause_number,
    processName: row.process_name,
    department: row.department,
    sortOrder: Number(row.sort_order || 0),
    notes: row.notes,
  }
}

function mapChecklistItem(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    auditId: Number(row.audit_id),
    sectionId: row.section_id != null ? Number(row.section_id) : null,
    question: row.question,
    clauseNumber: row.clause_number,
    processName: row.process_name,
    department: row.department,
    auditorNote: row.auditor_note,
    outcome: row.outcome,
    responsiblePerson: row.responsible_person,
    auditorUserId: row.auditor_user_id != null ? Number(row.auditor_user_id) : null,
    sortOrder: Number(row.sort_order || 0),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  }
}

function mapEvidence(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    auditId: Number(row.audit_id),
    checklistItemId: row.checklist_item_id != null ? Number(row.checklist_item_id) : null,
    documentId: row.document_id != null ? Number(row.document_id) : null,
    versionId: row.version_id != null ? Number(row.version_id) : null,
    notes: row.notes,
    linkedBy: row.linked_by != null ? Number(row.linked_by) : null,
    documentTitle: row.document_title || null,
    documentCode: row.document_code || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function listAudits(filters = {}) {
  const params = []
  const where = []
  if (filters.status) {
    params.push(filters.status)
    where.push(`status = $${params.length}`)
  }
  if (filters.auditYear) {
    params.push(Number(filters.auditYear))
    where.push(`audit_year = $${params.length}`)
  }
  if (filters.auditType) {
    params.push(filters.auditType)
    where.push(`audit_type = $${params.length}`)
  }
  const result = await query(
    `SELECT * FROM iso_audits
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY planned_date DESC NULLS LAST, id DESC`,
    params
  )
  return result.rows.map(mapAudit)
}

async function getAudit(id) {
  const result = await query(`SELECT * FROM iso_audits WHERE id = $1`, [Number(id)])
  const audit = mapAudit(result.rows[0])
  if (!audit) return null
  const sections = await query(
    `SELECT * FROM iso_audit_sections WHERE audit_id = $1 ORDER BY sort_order, id`,
    [Number(id)]
  )
  const items = await query(
    `SELECT * FROM iso_audit_checklist_items WHERE audit_id = $1 ORDER BY sort_order, id`,
    [Number(id)]
  )
  const evidence = await query(
    `SELECT e.*, d.title AS document_title, d.document_code
     FROM iso_audit_evidence e
     LEFT JOIN iso_documents d ON d.id = e.document_id
     WHERE e.audit_id = $1
     ORDER BY e.id`,
    [Number(id)]
  )
  audit.sections = sections.rows.map(mapSection)
  audit.checklistItems = items.rows.map(mapChecklistItem)
  audit.evidence = evidence.rows.map(mapEvidence)
  return audit
}

async function createAudit(data, userId) {
  if (data.auditType && !AUDIT_TYPES.includes(data.auditType)) {
    throw httpError(400, `Invalid audit type`)
  }
  const status = data.status && AUDIT_STATUSES.includes(data.status) ? data.status : 'Draft'
  const result = await query(
    `INSERT INTO iso_audits (
       audit_reference, audit_type, audit_year, status, standard, scope, location,
       planned_date, actual_date, lead_auditor, additional_auditors, auditees, departments,
       applicable_clauses, opening_meeting_at, closing_meeting_at, opening_meeting_notes,
       closing_meeting_notes, audit_objective, audit_criteria, notes,
       access_start_date, access_end_date, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24
     ) RETURNING *`,
    [
      data.auditReference || null,
      data.auditType || 'Internal',
      data.auditYear != null ? Number(data.auditYear) : new Date().getFullYear(),
      status,
      data.standard || 'ISO 9001:2015',
      data.scope || null,
      data.location || null,
      data.plannedDate || null,
      data.actualDate || null,
      data.leadAuditor || null,
      data.additionalAuditors || null,
      data.auditees || null,
      data.departments || null,
      data.applicableClauses || null,
      data.openingMeetingAt || null,
      data.closingMeetingAt || null,
      data.openingMeetingNotes || null,
      data.closingMeetingNotes || null,
      data.auditObjective || null,
      data.auditCriteria || null,
      data.notes || null,
      data.accessStartDate || null,
      data.accessEndDate || null,
      userId != null ? Number(userId) : null,
    ]
  )
  await logActivity({
    userId,
    action: 'audit.create',
    entityType: 'iso_audit',
    entityId: Number(result.rows[0].id),
    newValue: { auditReference: data.auditReference },
  })
  return mapAudit(result.rows[0])
}

async function updateAudit(id, patch, userId) {
  const existing = await getAudit(id)
  if (!existing) throw httpError(404, 'Audit not found')
  const fields = {
    auditReference: 'audit_reference',
    auditType: 'audit_type',
    auditYear: 'audit_year',
    status: 'status',
    standard: 'standard',
    scope: 'scope',
    location: 'location',
    plannedDate: 'planned_date',
    actualDate: 'actual_date',
    leadAuditor: 'lead_auditor',
    additionalAuditors: 'additional_auditors',
    auditees: 'auditees',
    departments: 'departments',
    applicableClauses: 'applicable_clauses',
    openingMeetingAt: 'opening_meeting_at',
    closingMeetingAt: 'closing_meeting_at',
    openingMeetingNotes: 'opening_meeting_notes',
    closingMeetingNotes: 'closing_meeting_notes',
    auditObjective: 'audit_objective',
    auditCriteria: 'audit_criteria',
    notes: 'notes',
    accessStartDate: 'access_start_date',
    accessEndDate: 'access_end_date',
  }
  const sets = []
  const params = []
  for (const [camel, col] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    if (camel === 'status' && patch.status && !AUDIT_STATUSES.includes(patch.status)) {
      throw httpError(400, 'Invalid audit status')
    }
    params.push(patch[camel])
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return existing
  params.push(userId != null ? Number(userId) : null)
  params.push(Number(id))
  await query(
    `UPDATE iso_audits SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
     WHERE id = $${params.length}`,
    params
  )
  await logActivity({
    userId,
    action: 'audit.update',
    entityType: 'iso_audit',
    entityId: Number(id),
    newValue: patch,
  })
  return getAudit(id)
}

async function addSection(auditId, data) {
  const result = await query(
    `INSERT INTO iso_audit_sections (audit_id, title, clause_number, process_name, department, sort_order, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      Number(auditId),
      data.title || 'Section',
      data.clauseNumber || null,
      data.processName || null,
      data.department || null,
      data.sortOrder != null ? Number(data.sortOrder) : 0,
      data.notes || null,
    ]
  )
  return mapSection(result.rows[0])
}

async function addChecklistItem(auditId, data, userId) {
  if (data.outcome && !CHECKLIST_OUTCOMES.includes(data.outcome)) {
    throw httpError(400, 'Invalid checklist outcome')
  }
  const result = await query(
    `INSERT INTO iso_audit_checklist_items (
       audit_id, section_id, question, clause_number, process_name, department,
       auditor_note, outcome, responsible_person, auditor_user_id, sort_order, reviewed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      Number(auditId),
      data.sectionId != null ? Number(data.sectionId) : null,
      data.question || '',
      data.clauseNumber || null,
      data.processName || null,
      data.department || null,
      data.auditorNote || null,
      data.outcome || 'Not Reviewed',
      data.responsiblePerson || null,
      userId != null ? Number(userId) : null,
      data.sortOrder != null ? Number(data.sortOrder) : 0,
      data.outcome && data.outcome !== 'Not Reviewed' ? new Date() : null,
    ]
  )
  return mapChecklistItem(result.rows[0])
}

async function updateChecklistItem(itemId, patch, userId) {
  if (patch.outcome && !CHECKLIST_OUTCOMES.includes(patch.outcome)) {
    throw httpError(400, 'Invalid checklist outcome')
  }
  const fields = {
    question: 'question',
    clauseNumber: 'clause_number',
    processName: 'process_name',
    department: 'department',
    auditorNote: 'auditor_note',
    outcome: 'outcome',
    responsiblePerson: 'responsible_person',
    sectionId: 'section_id',
    sortOrder: 'sort_order',
  }
  const sets = []
  const params = []
  for (const [camel, col] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    params.push(patch[camel])
    sets.push(`${col} = $${params.length}`)
  }
  if (patch.outcome && patch.outcome !== 'Not Reviewed') {
    sets.push(`reviewed_at = NOW()`)
  }
  if (userId != null) {
    params.push(Number(userId))
    sets.push(`auditor_user_id = $${params.length}`)
  }
  if (!sets.length) {
    const cur = await query(`SELECT * FROM iso_audit_checklist_items WHERE id = $1`, [Number(itemId)])
    return mapChecklistItem(cur.rows[0])
  }
  params.push(Number(itemId))
  const result = await query(
    `UPDATE iso_audit_checklist_items SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} RETURNING *`,
    params
  )
  return mapChecklistItem(result.rows[0])
}

async function linkEvidence({ auditId, checklistItemId, documentId, versionId, notes, userId }) {
  if (!documentId && !versionId) throw httpError(400, 'documentId or versionId required')
  const result = await query(
    `INSERT INTO iso_audit_evidence (audit_id, checklist_item_id, document_id, version_id, notes, linked_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      Number(auditId),
      checklistItemId != null ? Number(checklistItemId) : null,
      documentId != null ? Number(documentId) : null,
      versionId != null ? Number(versionId) : null,
      notes || null,
      userId != null ? Number(userId) : null,
    ]
  )
  await logActivity({
    userId,
    action: 'audit.link_evidence',
    entityType: 'iso_audit',
    entityId: Number(auditId),
    newValue: { documentId, versionId, checklistItemId },
  })
  return mapEvidence(result.rows[0])
}

async function deleteEvidence(evidenceId) {
  await query(`DELETE FROM iso_audit_evidence WHERE id = $1`, [Number(evidenceId)])
  return { success: true }
}

/**
 * Build report data objects from live audit rows — no invented narrative.
 */
async function generateReportData(auditId) {
  const audit = await getAudit(auditId)
  if (!audit) throw httpError(404, 'Audit not found')

  const findings = await query(
    `SELECT * FROM iso_findings WHERE audit_id = $1 ORDER BY id`,
    [Number(auditId)]
  )

  const outcomeCounts = {}
  for (const item of audit.checklistItems || []) {
    const key = item.outcome || 'Not Reviewed'
    outcomeCounts[key] = (outcomeCounts[key] || 0) + 1
  }

  return {
    generatedAt: new Date().toISOString(),
    audit,
    plan: {
      reference: audit.auditReference,
      type: audit.auditType,
      year: audit.auditYear,
      plannedDate: audit.plannedDate,
      scope: audit.scope,
      leadAuditor: audit.leadAuditor,
      departments: audit.departments,
      objective: audit.auditObjective,
      criteria: audit.auditCriteria,
    },
    schedule: {
      plannedDate: audit.plannedDate,
      actualDate: audit.actualDate,
      openingMeetingAt: audit.openingMeetingAt,
      closingMeetingAt: audit.closingMeetingAt,
      sections: (audit.sections || []).map((s) => ({
        title: s.title,
        clauseNumber: s.clauseNumber,
        processName: s.processName,
        department: s.department,
      })),
    },
    conformance: {
      outcomeCounts,
      checklistItems: audit.checklistItems || [],
      evidenceCount: (audit.evidence || []).length,
    },
    findings: findings.rows.map((r) => ({
      id: Number(r.id),
      ncNumber: r.nc_number,
      classification: r.classification,
      description: r.description,
      status: r.status,
      clauseNumber: r.clause_number,
      department: r.department,
    })),
    summary: {
      status: audit.status,
      openingMeetingNotes: audit.openingMeetingNotes,
      closingMeetingNotes: audit.closingMeetingNotes,
      notes: audit.notes,
      findingsCount: findings.rows.length,
      openFindings: findings.rows.filter((r) => r.status === 'Open').length,
    },
  }
}

module.exports = {
  listAudits,
  getAudit,
  createAudit,
  updateAudit,
  addSection,
  addChecklistItem,
  updateChecklistItem,
  linkEvidence,
  deleteEvidence,
  generateReportData,
  mapAudit,
  mapChecklistItem,
  mapEvidence,
}

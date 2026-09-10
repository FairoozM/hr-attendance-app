const { query } = require('../../db')
const { logActivity } = require('./isoActivityLogService')
const { auditorAccessActive } = require('./isoPermissions')

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function toIsoDate(v) {
  if (v == null || v === '') return null
  return String(v).slice(0, 10)
}

function mapDates(row, keys) {
  const out = { ...row }
  for (const k of keys) {
    if (out[k] != null) out[k] = toIsoDate(out[k])
  }
  return out
}

/** Generic list helper */
async function listTable(table, { orderBy = 'id DESC', filters = {}, filterMap = {} } = {}) {
  const params = []
  const where = []
  for (const [key, col] of Object.entries(filterMap)) {
    if (filters[key] == null || filters[key] === '') continue
    params.push(filters[key])
    where.push(`${col} = $${params.length}`)
  }
  const result = await query(
    `SELECT * FROM ${table}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy}`,
    params
  )
  return result.rows
}

// ── Management reviews ──────────────────────────────────────────────────────

async function listManagementReviews(filters = {}) {
  const rows = await listTable('iso_management_reviews', {
    orderBy: 'meeting_date DESC NULLS LAST, id DESC',
    filters,
    filterMap: { status: 'status' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    reference: r.reference,
    meetingDate: toIsoDate(r.meeting_date),
    location: r.location,
    chairperson: r.chairperson,
    attendees: r.attendees,
    status: r.status,
    summary: r.summary,
    nextReviewDate: toIsoDate(r.next_review_date),
    documentId: r.document_id != null ? Number(r.document_id) : null,
  }))
}

async function createManagementReview(data, userId) {
  const result = await query(
    `INSERT INTO iso_management_reviews (
       reference, meeting_date, location, chairperson, attendees, status, summary,
       next_review_date, document_id, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [
      data.reference || null,
      data.meetingDate || null,
      data.location || null,
      data.chairperson || null,
      data.attendees || null,
      data.status || 'Draft',
      data.summary || null,
      data.nextReviewDate || null,
      data.documentId != null ? Number(data.documentId) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listManagementReviews()).find((r) => r.id === Number(result.rows[0].id))
}

async function addManagementReviewItem(reviewId, data) {
  const result = await query(
    `INSERT INTO iso_management_review_items (
       management_review_id, agenda_item, discussion, decision, action_owner, due_date, status, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      Number(reviewId),
      data.agendaItem || data.agenda_item || '',
      data.discussion || null,
      data.decision || null,
      data.actionOwner || null,
      data.dueDate || null,
      data.status || 'Open',
      data.sortOrder != null ? Number(data.sortOrder) : 0,
    ]
  )
  const r = result.rows[0]
  return {
    id: Number(r.id),
    managementReviewId: Number(r.management_review_id),
    agendaItem: r.agenda_item,
    discussion: r.discussion,
    decision: r.decision,
    actionOwner: r.action_owner,
    dueDate: toIsoDate(r.due_date),
    status: r.status,
  }
}

// ── Risks ───────────────────────────────────────────────────────────────────

async function listRiskAssessments() {
  const rows = await listTable('iso_risk_assessments', { orderBy: 'assessment_date DESC NULLS LAST, id DESC' })
  return rows.map((r) => ({
    id: Number(r.id),
    reference: r.reference,
    title: r.title,
    assessmentDate: toIsoDate(r.assessment_date),
    status: r.status,
    notes: r.notes,
    documentId: r.document_id != null ? Number(r.document_id) : null,
  }))
}

async function createRiskAssessment(data, userId) {
  if (!data.title) throw httpError(400, 'title is required')
  const result = await query(
    `INSERT INTO iso_risk_assessments (reference, title, assessment_date, status, notes, document_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
    [
      data.reference || null,
      data.title,
      data.assessmentDate || null,
      data.status || 'Active',
      data.notes || null,
      data.documentId != null ? Number(data.documentId) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  return { id: Number(result.rows[0].id) }
}

async function listRisks(filters = {}) {
  const rows = await listTable('iso_risks', {
    orderBy: 'score DESC NULLS LAST, id DESC',
    filters,
    filterMap: { status: 'status', riskAssessmentId: 'risk_assessment_id' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    riskAssessmentId: r.risk_assessment_id != null ? Number(r.risk_assessment_id) : null,
    riskNumber: r.risk_number,
    description: r.description,
    category: r.category,
    likelihood: r.likelihood != null ? Number(r.likelihood) : null,
    impact: r.impact != null ? Number(r.impact) : null,
    score: r.score != null ? Number(r.score) : null,
    treatment: r.treatment,
    ownerName: r.owner_name,
    dueDate: toIsoDate(r.due_date),
    status: r.status,
    clauseNumber: r.clause_number,
  }))
}

async function createRisk(data) {
  if (!data.description) throw httpError(400, 'description is required')
  const likelihood = data.likelihood != null ? Number(data.likelihood) : null
  const impact = data.impact != null ? Number(data.impact) : null
  const score = data.score != null ? Number(data.score) : (likelihood != null && impact != null ? likelihood * impact : null)
  const result = await query(
    `INSERT INTO iso_risks (
       risk_assessment_id, risk_number, description, category, likelihood, impact, score,
       treatment, owner_name, due_date, status, clause_number
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      data.riskAssessmentId != null ? Number(data.riskAssessmentId) : null,
      data.riskNumber || null,
      data.description,
      data.category || null,
      likelihood,
      impact,
      score,
      data.treatment || null,
      data.ownerName || null,
      data.dueDate || null,
      data.status || 'Open',
      data.clauseNumber || null,
    ]
  )
  return (await listRisks()).find((r) => r.id === Number(result.rows[0].id))
}

async function updateRisk(id, patch) {
  const fields = {
    description: 'description',
    category: 'category',
    likelihood: 'likelihood',
    impact: 'impact',
    score: 'score',
    treatment: 'treatment',
    ownerName: 'owner_name',
    dueDate: 'due_date',
    status: 'status',
    clauseNumber: 'clause_number',
    riskNumber: 'risk_number',
  }
  const sets = []
  const params = []
  for (const [camel, col] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    params.push(patch[camel])
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) throw httpError(400, 'No fields to update')
  params.push(Number(id))
  await query(`UPDATE iso_risks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params)
  const rows = await listRisks()
  return rows.find((r) => r.id === Number(id)) || null
}

// ── Objectives ──────────────────────────────────────────────────────────────

async function listObjectives(filters = {}) {
  const rows = await listTable('iso_quality_objectives', {
    orderBy: 'id DESC',
    filters,
    filterMap: { status: 'status', department: 'department' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    objectiveCode: r.objective_code,
    title: r.title,
    description: r.description,
    department: r.department,
    targetValue: r.target_value,
    unit: r.unit,
    period: r.period,
    ownerName: r.owner_name,
    status: r.status,
    dueDate: toIsoDate(r.due_date),
    documentId: r.document_id != null ? Number(r.document_id) : null,
  }))
}

async function createObjective(data, userId) {
  if (!data.title) throw httpError(400, 'title is required')
  const result = await query(
    `INSERT INTO iso_quality_objectives (
       objective_code, title, description, department, target_value, unit, period,
       owner_name, status, due_date, document_id, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
    [
      data.objectiveCode || null,
      data.title,
      data.description || null,
      data.department || null,
      data.targetValue || null,
      data.unit || null,
      data.period || null,
      data.ownerName || null,
      data.status || 'Active',
      data.dueDate || null,
      data.documentId != null ? Number(data.documentId) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listObjectives()).find((r) => r.id === Number(result.rows[0].id))
}

async function addObjectiveUpdate(objectiveId, data, userId) {
  const result = await query(
    `INSERT INTO iso_objective_updates (objective_id, update_date, actual_value, notes, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      Number(objectiveId),
      data.updateDate || new Date().toISOString().slice(0, 10),
      data.actualValue || null,
      data.notes || null,
      userId != null ? Number(userId) : null,
    ]
  )
  const r = result.rows[0]
  return {
    id: Number(r.id),
    objectiveId: Number(r.objective_id),
    updateDate: toIsoDate(r.update_date),
    actualValue: r.actual_value,
    notes: r.notes,
  }
}

// ── Suppliers ───────────────────────────────────────────────────────────────

async function listSuppliers(filters = {}) {
  const rows = await listTable('iso_suppliers', {
    orderBy: 'name ASC',
    filters,
    filterMap: { status: 'status' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    supplierCode: r.supplier_code,
    name: r.name,
    category: r.category,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    status: r.status,
    approvedDate: toIsoDate(r.approved_date),
    nextEvaluationDate: toIsoDate(r.next_evaluation_date),
    notes: r.notes,
    documentId: r.document_id != null ? Number(r.document_id) : null,
  }))
}

async function createSupplier(data, userId) {
  if (!data.name) throw httpError(400, 'name is required')
  const result = await query(
    `INSERT INTO iso_suppliers (
       supplier_code, name, category, contact_name, contact_email, contact_phone,
       status, approved_date, next_evaluation_date, notes, document_id, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
    [
      data.supplierCode || null,
      data.name,
      data.category || null,
      data.contactName || null,
      data.contactEmail || null,
      data.contactPhone || null,
      data.status || 'Approved',
      data.approvedDate || null,
      data.nextEvaluationDate || null,
      data.notes || null,
      data.documentId != null ? Number(data.documentId) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listSuppliers()).find((r) => r.id === Number(result.rows[0].id))
}

async function addSupplierQualification(supplierId, data) {
  const result = await query(
    `INSERT INTO iso_supplier_qualifications (supplier_id, qualification_date, result, notes, document_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      Number(supplierId),
      data.qualificationDate || null,
      data.result || null,
      data.notes || null,
      data.documentId != null ? Number(data.documentId) : null,
    ]
  )
  return result.rows[0]
}

async function addSupplierEvaluation(supplierId, data) {
  const result = await query(
    `INSERT INTO iso_supplier_evaluations (
       supplier_id, evaluation_date, score, result, notes, document_id, next_evaluation_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      Number(supplierId),
      data.evaluationDate || null,
      data.score != null ? Number(data.score) : null,
      data.result || null,
      data.notes || null,
      data.documentId != null ? Number(data.documentId) : null,
      data.nextEvaluationDate || null,
    ]
  )
  return result.rows[0]
}

// ── Equipment / maintenance / calibration ───────────────────────────────────

async function listEquipment(filters = {}) {
  const rows = await listTable('iso_equipment', {
    orderBy: 'equipment_number NULLS LAST, name',
    filters,
    filterMap: { status: 'status' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    equipmentNumber: r.equipment_number,
    name: r.name,
    category: r.category,
    location: r.location,
    manufacturer: r.manufacturer,
    model: r.model,
    serialNumber: r.serial_number,
    status: r.status,
    purchaseDate: toIsoDate(r.purchase_date),
    notes: r.notes,
    documentId: r.document_id != null ? Number(r.document_id) : null,
  }))
}

async function createEquipment(data, userId) {
  if (!data.name) throw httpError(400, 'name is required')
  const result = await query(
    `INSERT INTO iso_equipment (
       equipment_number, name, category, location, manufacturer, model, serial_number,
       status, purchase_date, notes, document_id, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
    [
      data.equipmentNumber || null,
      data.name,
      data.category || null,
      data.location || null,
      data.manufacturer || null,
      data.model || null,
      data.serialNumber || null,
      data.status || 'Active',
      data.purchaseDate || null,
      data.notes || null,
      data.documentId != null ? Number(data.documentId) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listEquipment()).find((r) => r.id === Number(result.rows[0].id))
}

async function addMaintenanceLog(equipmentId, data) {
  const result = await query(
    `INSERT INTO iso_maintenance_logs (
       equipment_id, maintenance_date, maintenance_type, description, performed_by, next_due_date, document_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      Number(equipmentId),
      data.maintenanceDate || null,
      data.maintenanceType || null,
      data.description || null,
      data.performedBy || null,
      data.nextDueDate || null,
      data.documentId != null ? Number(data.documentId) : null,
    ]
  )
  return result.rows[0]
}

async function listCalibrations(filters = {}) {
  const rows = await listTable('iso_calibrations', {
    orderBy: 'next_due_date NULLS LAST, id DESC',
    filters,
    filterMap: { status: 'status', equipmentId: 'equipment_id' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    equipmentId: r.equipment_id != null ? Number(r.equipment_id) : null,
    calibrationDate: toIsoDate(r.calibration_date),
    nextDueDate: toIsoDate(r.next_due_date),
    result: r.result,
    certificateNumber: r.certificate_number,
    performedBy: r.performed_by,
    status: r.status,
    documentId: r.document_id != null ? Number(r.document_id) : null,
    notes: r.notes,
  }))
}

async function createCalibration(data, userId) {
  const result = await query(
    `INSERT INTO iso_calibrations (
       equipment_id, calibration_date, next_due_date, result, certificate_number,
       performed_by, status, document_id, notes, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
    [
      data.equipmentId != null ? Number(data.equipmentId) : null,
      data.calibrationDate || null,
      data.nextDueDate || null,
      data.result || null,
      data.certificateNumber || null,
      data.performedBy || null,
      data.status || 'Scheduled',
      data.documentId != null ? Number(data.documentId) : null,
      data.notes || null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listCalibrations()).find((r) => r.id === Number(result.rows[0].id))
}

// ── External certificates ───────────────────────────────────────────────────

async function listCertificates(filters = {}) {
  const rows = await listTable('iso_external_certificates', {
    orderBy: 'expiry_date NULLS LAST, id DESC',
    filters,
    filterMap: { status: 'status' },
  })
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    certificateNumber: r.certificate_number,
    issuer: r.issuer,
    issueDate: toIsoDate(r.issue_date),
    expiryDate: toIsoDate(r.expiry_date),
    status: r.status,
    documentId: r.document_id != null ? Number(r.document_id) : null,
    notes: r.notes,
  }))
}

async function createCertificate(data, userId) {
  if (!data.title) throw httpError(400, 'title is required')
  const result = await query(
    `INSERT INTO iso_external_certificates (
       title, certificate_number, issuer, issue_date, expiry_date, status, document_id, notes, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [
      data.title,
      data.certificateNumber || null,
      data.issuer || null,
      data.issueDate || null,
      data.expiryDate || null,
      data.status || 'Active',
      data.documentId != null ? Number(data.documentId) : null,
      data.notes || null,
      userId != null ? Number(userId) : null,
    ]
  )
  return (await listCertificates()).find((r) => r.id === Number(result.rows[0].id))
}

/**
 * HR / warehouse evidence: link existing documents by category — no duplicate employees.
 */
async function listEvidenceByCategory(categoryCodes = []) {
  const result = await query(
    `SELECT d.id, d.title, d.document_code, d.status, d.document_type, d.department,
            d.confidentiality, d.publish_to_auditor_room, c.code AS category_code, c.name AS category_name
     FROM iso_documents d
     JOIN iso_categories c ON c.id = d.category_id
     WHERE d.soft_deleted_at IS NULL
       AND c.code = ANY($1::text[])
       AND d.confidentiality <> 'Restricted HR'
     ORDER BY c.sort_order, d.title`,
    [categoryCodes]
  )
  return result.rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    documentCode: r.document_code,
    status: r.status,
    documentType: r.document_type,
    department: r.department,
    confidentiality: r.confidentiality,
    publishToAuditorRoom: Boolean(r.publish_to_auditor_room),
    categoryCode: r.category_code,
    categoryName: r.category_name,
  }))
}

async function listHrEvidence() {
  return listEvidenceByCategory(['hr_competence'])
}

async function listWarehouseEvidence() {
  return listEvidenceByCategory(['warehouse_ops'])
}

// ── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await query(`SELECT setting_key, setting_value, updated_at FROM iso_settings ORDER BY setting_key`)
  const out = {}
  for (const row of result.rows) {
    out[row.setting_key] = row.setting_value
  }
  return out
}

async function putSettings(values, userId) {
  if (!values || typeof values !== 'object') throw httpError(400, 'settings object required')
  for (const [key, value] of Object.entries(values)) {
    await query(
      `INSERT INTO iso_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (setting_key) DO UPDATE
         SET setting_value = EXCLUDED.setting_value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [String(key).slice(0, 128), JSON.stringify(value ?? {}), userId != null ? Number(userId) : null]
    )
  }
  await logActivity({
    userId,
    action: 'settings.update',
    entityType: 'iso_settings',
    entityId: null,
    newValue: values,
  })
  return getSettings()
}

// ── Auditor assignments ─────────────────────────────────────────────────────

function mapAssignment(row) {
  if (!row) return null
  const accessStartDate = toIsoDate(row.access_start_date)
  const accessExpiryDate = toIsoDate(row.access_expiry_date)
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    username: row.username || null,
    userName: row.username || null,
    auditId: row.audit_id != null ? Number(row.audit_id) : null,
    accessStartDate,
    accessExpiryDate,
    // Frontend aliases
    accessStartAt: accessStartDate,
    accessEndAt: accessExpiryDate,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    revokedBy: row.revoked_by != null ? Number(row.revoked_by) : null,
    canCreateFindings: Boolean(row.can_create_findings),
    canAddComments: Boolean(row.can_add_comments),
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : null,
    notes: row.notes,
    active: auditorAccessActive(row),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function listAuditorAssignments() {
  const result = await query(
    `SELECT a.*, u.username
     FROM iso_auditor_assignments a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC`
  )
  return result.rows.map(mapAssignment)
}

async function createAuditorAssignment(data, createdBy) {
  if (!data.userId) throw httpError(400, 'userId is required')
  const userRes = await query(`SELECT id, role, username FROM users WHERE id = $1`, [Number(data.userId)])
  if (!userRes.rows[0]) throw httpError(404, 'User not found')
  if (String(userRes.rows[0].role) !== 'auditor') {
    throw httpError(400, 'Assignments require a user with role = auditor')
  }
  const start = data.accessStartDate || data.accessStartAt || null
  const expiry = data.accessExpiryDate || data.accessEndAt || null
  const result = await query(
    `INSERT INTO iso_auditor_assignments (
       user_id, audit_id, access_start_date, access_expiry_date,
       can_create_findings, can_add_comments, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      Number(data.userId),
      data.auditId != null ? Number(data.auditId) : null,
      start,
      expiry,
      Boolean(data.canCreateFindings),
      data.canAddComments !== false,
      data.notes || null,
      createdBy != null ? Number(createdBy) : null,
    ]
  )
  await logActivity({
    userId: createdBy,
    action: 'auditor_assignment.create',
    entityType: 'iso_auditor_assignment',
    entityId: Number(result.rows[0].id),
    newValue: { userId: data.userId },
  })
  const mapped = mapAssignment({ ...result.rows[0], username: userRes.rows[0].username })
  return mapped
}

/**
 * Create a named auditor portal account (role=auditor) with iso_qms.view
 * and optionally an access assignment window.
 */
async function createAuditorAccount(data, createdBy) {
  const usersService = require('../usersService')
  const email = String(data.email || data.username || '').trim().toLowerCase()
  const password = String(data.password || '')
  if (!email || !password) throw httpError(400, 'email and password are required')
  if (password.length < 8) throw httpError(400, 'password must be at least 8 characters')

  let user
  try {
    user = await usersService.createUser({
      username: email,
      password,
      role: 'auditor',
      employee_id: null,
    })
  } catch (err) {
    const msg = err?.message || 'Failed to create auditor account'
    throw httpError(400, msg)
  }

  await query(
    `UPDATE users SET permissions = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [user.id, JSON.stringify({ iso_qms: { view: true, manage_audits: Boolean(data.canCreateFindings) } })]
  )

  let assignment = null
  if (data.assignAccess !== false) {
    assignment = await createAuditorAssignment(
      {
        userId: user.id,
        auditId: data.auditId,
        accessStartDate: data.accessStartDate || data.accessStartAt || new Date().toISOString().slice(0, 10),
        accessExpiryDate: data.accessExpiryDate || data.accessEndAt || null,
        canCreateFindings: Boolean(data.canCreateFindings),
        canAddComments: data.canAddComments !== false,
        notes: data.notes || null,
      },
      createdBy
    )
  }

  await logActivity({
    userId: createdBy,
    action: 'auditor_account.create',
    entityType: 'user',
    entityId: Number(user.id),
    newValue: { username: email, role: 'auditor' },
  })

  return {
    user: { id: Number(user.id), username: user.username, role: user.role },
    assignment,
  }
}

async function revokeAuditorAssignment(id, revokedBy) {
  const result = await query(
    `UPDATE iso_auditor_assignments
     SET revoked_at = NOW(), revoked_by = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [revokedBy != null ? Number(revokedBy) : null, Number(id)]
  )
  if (!result.rows[0]) throw httpError(404, 'Assignment not found')
  await logActivity({
    userId: revokedBy,
    action: 'auditor_assignment.revoke',
    entityType: 'iso_auditor_assignment',
    entityId: Number(id),
  })
  return mapAssignment(result.rows[0])
}

async function touchAuditorActivity(userId) {
  await query(
    `UPDATE iso_auditor_assignments
     SET last_activity_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [Number(userId)]
  )
}

async function getActiveAssignmentForUser(userId) {
  const result = await query(
    `SELECT * FROM iso_auditor_assignments
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY id DESC`,
    [Number(userId)]
  )
  const active = result.rows.find((r) => auditorAccessActive(r))
  return mapAssignment(active || null)
}

module.exports = {
  listManagementReviews,
  createManagementReview,
  addManagementReviewItem,
  listRiskAssessments,
  createRiskAssessment,
  listRisks,
  createRisk,
  updateRisk,
  listObjectives,
  createObjective,
  addObjectiveUpdate,
  listSuppliers,
  createSupplier,
  addSupplierQualification,
  addSupplierEvaluation,
  listEquipment,
  createEquipment,
  addMaintenanceLog,
  listCalibrations,
  createCalibration,
  listCertificates,
  createCertificate,
  listHrEvidence,
  listWarehouseEvidence,
  getSettings,
  putSettings,
  listAuditorAssignments,
  createAuditorAssignment,
  createAuditorAccount,
  revokeAuditorAssignment,
  touchAuditorActivity,
  getActiveAssignmentForUser,
  mapDates,
}

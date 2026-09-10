const { query } = require('../../db')
const { logActivity } = require('./isoActivityLogService')
const {
  CA_STATUSES,
  FINDING_CLASSIFICATIONS,
  FINDING_SOURCES,
  FINDING_STATUSES,
} = require('./isoQmsConstants')

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function mapFinding(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    ncNumber: row.nc_number,
    findingDate: row.finding_date ? String(row.finding_date).slice(0, 10) : null,
    source: row.source,
    auditId: row.audit_id != null ? Number(row.audit_id) : null,
    checklistItemId: row.checklist_item_id != null ? Number(row.checklist_item_id) : null,
    department: row.department,
    customerSupplier: row.customer_supplier,
    orderReference: row.order_reference,
    productSku: row.product_sku,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    stageOfOperation: row.stage_of_operation,
    clauseNumber: row.clause_number,
    description: row.description,
    evidence: row.evidence,
    classification: row.classification,
    immediateCorrection: row.immediate_correction,
    responsibleOwner: row.responsible_owner,
    status: row.status,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapCa(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    caNumber: row.ca_number,
    findingId: row.finding_id != null ? Number(row.finding_id) : null,
    description: row.description,
    immediateCorrection: row.immediate_correction,
    rootCause: row.root_cause,
    correctiveActionDetails: row.corrective_action_details,
    evidenceNotes: row.evidence_notes,
    effectivenessReview: row.effectiveness_review,
    responsiblePerson: row.responsible_person,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    status: row.status,
    verifierName: row.verifier_name,
    verifiedAt: row.verified_at ? String(row.verified_at).slice(0, 10) : null,
    closedAt: row.closed_at ? String(row.closed_at).slice(0, 10) : null,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapCaUpdate(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    correctiveActionId: Number(row.corrective_action_id),
    updateText: row.update_text,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

/**
 * Closure requires: root cause, CA details, evidence/notes, effectiveness,
 * verifier name + verified date.
 */
function validateClosureFields(ca) {
  const missing = []
  if (!String(ca.rootCause || ca.root_cause || '').trim()) missing.push('rootCause')
  if (!String(ca.correctiveActionDetails || ca.corrective_action_details || '').trim()) {
    missing.push('correctiveActionDetails')
  }
  if (!String(ca.evidenceNotes || ca.evidence_notes || '').trim()) missing.push('evidenceNotes')
  if (!String(ca.effectivenessReview || ca.effectiveness_review || '').trim()) {
    missing.push('effectivenessReview')
  }
  if (!String(ca.verifierName || ca.verifier_name || '').trim()) missing.push('verifierName')
  if (!(ca.verifiedAt || ca.verified_at)) missing.push('verifiedAt')
  return missing
}

async function listFindings(filters = {}) {
  const params = []
  const where = []
  if (filters.status) {
    params.push(filters.status)
    where.push(`status = $${params.length}`)
  }
  if (filters.auditId) {
    params.push(Number(filters.auditId))
    where.push(`audit_id = $${params.length}`)
  }
  const result = await query(
    `SELECT * FROM iso_findings
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY finding_date DESC NULLS LAST, id DESC`,
    params
  )
  return result.rows.map(mapFinding)
}

async function getFinding(id) {
  const result = await query(`SELECT * FROM iso_findings WHERE id = $1`, [Number(id)])
  const finding = mapFinding(result.rows[0])
  if (!finding) return null
  const cas = await query(
    `SELECT * FROM iso_corrective_actions WHERE finding_id = $1 ORDER BY id`,
    [Number(id)]
  )
  finding.correctiveActions = cas.rows.map(mapCa)
  return finding
}

async function createFinding(data, userId) {
  if (!data.description) throw httpError(400, 'description is required')
  if (data.classification && !FINDING_CLASSIFICATIONS.includes(data.classification)) {
    throw httpError(400, 'Invalid classification')
  }
  if (data.source && !FINDING_SOURCES.includes(data.source)) {
    throw httpError(400, 'Invalid source')
  }
  const status = data.status && FINDING_STATUSES.includes(data.status) ? data.status : 'Open'
  const result = await query(
    `INSERT INTO iso_findings (
       nc_number, finding_date, source, audit_id, checklist_item_id, department,
       customer_supplier, order_reference, product_sku, quantity, stage_of_operation,
       clause_number, description, evidence, classification, immediate_correction,
       responsible_owner, status, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19
     ) RETURNING *`,
    [
      data.ncNumber || null,
      data.findingDate || new Date().toISOString().slice(0, 10),
      data.source || null,
      data.auditId != null ? Number(data.auditId) : null,
      data.checklistItemId != null ? Number(data.checklistItemId) : null,
      data.department || null,
      data.customerSupplier || null,
      data.orderReference || null,
      data.productSku || null,
      data.quantity != null ? Number(data.quantity) : null,
      data.stageOfOperation || null,
      data.clauseNumber || null,
      data.description,
      data.evidence || null,
      data.classification || null,
      data.immediateCorrection || null,
      data.responsibleOwner || null,
      status,
      userId != null ? Number(userId) : null,
    ]
  )
  await logActivity({
    userId,
    action: 'finding.create',
    entityType: 'iso_finding',
    entityId: Number(result.rows[0].id),
    newValue: { ncNumber: data.ncNumber, classification: data.classification },
  })
  return mapFinding(result.rows[0])
}

async function updateFinding(id, patch, userId) {
  const existing = await getFinding(id)
  if (!existing) throw httpError(404, 'Finding not found')
  const fields = {
    ncNumber: 'nc_number',
    findingDate: 'finding_date',
    source: 'source',
    auditId: 'audit_id',
    checklistItemId: 'checklist_item_id',
    department: 'department',
    customerSupplier: 'customer_supplier',
    orderReference: 'order_reference',
    productSku: 'product_sku',
    quantity: 'quantity',
    stageOfOperation: 'stage_of_operation',
    clauseNumber: 'clause_number',
    description: 'description',
    evidence: 'evidence',
    classification: 'classification',
    immediateCorrection: 'immediate_correction',
    responsibleOwner: 'responsible_owner',
    status: 'status',
  }
  const sets = []
  const params = []
  for (const [camel, col] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    params.push(patch[camel])
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return existing
  params.push(userId != null ? Number(userId) : null)
  params.push(Number(id))
  await query(
    `UPDATE iso_findings SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
     WHERE id = $${params.length}`,
    params
  )
  return getFinding(id)
}

async function listCorrectiveActions(filters = {}) {
  const params = []
  const where = []
  if (filters.status) {
    params.push(filters.status)
    where.push(`status = $${params.length}`)
  }
  if (filters.findingId) {
    params.push(Number(filters.findingId))
    where.push(`finding_id = $${params.length}`)
  }
  if (filters.overdue) {
    where.push(`due_date < CURRENT_DATE AND status NOT IN ('Closed', 'Cancelled')`)
  }
  const result = await query(
    `SELECT * FROM iso_corrective_actions
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY due_date NULLS LAST, id DESC`,
    params
  )
  return result.rows.map(mapCa)
}

async function getCorrectiveAction(id) {
  const result = await query(`SELECT * FROM iso_corrective_actions WHERE id = $1`, [Number(id)])
  const ca = mapCa(result.rows[0])
  if (!ca) return null
  const updates = await query(
    `SELECT * FROM iso_corrective_action_updates WHERE corrective_action_id = $1 ORDER BY id`,
    [Number(id)]
  )
  ca.updates = updates.rows.map(mapCaUpdate)
  return ca
}

async function createCorrectiveAction(data, userId) {
  const status = data.status && CA_STATUSES.includes(data.status) ? data.status : 'Open'
  if (status === 'Closed') {
    const missing = validateClosureFields(data)
    if (missing.length) {
      throw httpError(400, `Cannot close CA without: ${missing.join(', ')}`)
    }
  }
  const result = await query(
    `INSERT INTO iso_corrective_actions (
       ca_number, finding_id, description, immediate_correction, root_cause,
       corrective_action_details, evidence_notes, effectiveness_review,
       responsible_person, due_date, status, verifier_name, verified_at, closed_at,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15
     ) RETURNING *`,
    [
      data.caNumber || null,
      data.findingId != null ? Number(data.findingId) : null,
      data.description || null,
      data.immediateCorrection || null,
      data.rootCause || null,
      data.correctiveActionDetails || null,
      data.evidenceNotes || null,
      data.effectivenessReview || null,
      data.responsiblePerson || null,
      data.dueDate || null,
      status,
      data.verifierName || null,
      data.verifiedAt || null,
      status === 'Closed' ? data.closedAt || new Date().toISOString().slice(0, 10) : null,
      userId != null ? Number(userId) : null,
    ]
  )
  await logActivity({
    userId,
    action: 'corrective_action.create',
    entityType: 'iso_corrective_action',
    entityId: Number(result.rows[0].id),
  })
  return mapCa(result.rows[0])
}

async function updateCorrectiveAction(id, patch, userId) {
  const existing = await getCorrectiveAction(id)
  if (!existing) throw httpError(404, 'Corrective action not found')

  const merged = { ...existing, ...patch }
  const nextStatus = patch.status != null ? patch.status : existing.status
  if (nextStatus === 'Closed') {
    const missing = validateClosureFields(merged)
    if (missing.length) {
      throw httpError(400, `Cannot close CA without: ${missing.join(', ')}`)
    }
  }
  if (nextStatus && !CA_STATUSES.includes(nextStatus)) {
    throw httpError(400, 'Invalid CA status')
  }

  const fields = {
    caNumber: 'ca_number',
    findingId: 'finding_id',
    description: 'description',
    immediateCorrection: 'immediate_correction',
    rootCause: 'root_cause',
    correctiveActionDetails: 'corrective_action_details',
    evidenceNotes: 'evidence_notes',
    effectivenessReview: 'effectiveness_review',
    responsiblePerson: 'responsible_person',
    dueDate: 'due_date',
    status: 'status',
    verifierName: 'verifier_name',
    verifiedAt: 'verified_at',
    closedAt: 'closed_at',
  }
  const sets = []
  const params = []
  for (const [camel, col] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    params.push(patch[camel])
    sets.push(`${col} = $${params.length}`)
  }
  if (nextStatus === 'Closed' && !patch.closedAt && !existing.closedAt) {
    params.push(new Date().toISOString().slice(0, 10))
    sets.push(`closed_at = $${params.length}`)
  }
  if (!sets.length && !patch.updateText) return existing

  if (sets.length) {
    params.push(userId != null ? Number(userId) : null)
    params.push(Number(id))
    await query(
      `UPDATE iso_corrective_actions
       SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    )
  }

  const updateText = patch.updateText || (patch.status && patch.status !== existing.status
    ? `Status changed to ${patch.status}`
    : null)
  if (updateText) {
    await query(
      `INSERT INTO iso_corrective_action_updates (
         corrective_action_id, update_text, previous_status, new_status, created_by
       ) VALUES ($1,$2,$3,$4,$5)`,
      [Number(id), updateText, existing.status, nextStatus, userId != null ? Number(userId) : null]
    )
  }

  await logActivity({
    userId,
    action: 'corrective_action.update',
    entityType: 'iso_corrective_action',
    entityId: Number(id),
    previousValue: { status: existing.status },
    newValue: { status: nextStatus },
  })
  return getCorrectiveAction(id)
}

module.exports = {
  listFindings,
  getFinding,
  createFinding,
  updateFinding,
  listCorrectiveActions,
  getCorrectiveAction,
  createCorrectiveAction,
  updateCorrectiveAction,
  validateClosureFields,
  mapFinding,
  mapCa,
}

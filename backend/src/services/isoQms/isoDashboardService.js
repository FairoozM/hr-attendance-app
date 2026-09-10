const { query } = require('../../db')
const { REQUIRED_CONTROLLED_DOCUMENT_CODES } = require('./isoQmsConstants')
const { listActivity } = require('./isoActivityLogService')

async function count(sql, params = []) {
  const result = await query(sql, params)
  return Number(result.rows[0]?.count || 0)
}

/**
 * Real counts only — no invented readiness percentage.
 */
async function getDashboard() {
  const [
    totalControlled,
    currentApproved,
    draftPending,
    obsolete,
    totalRecordTypes,
    requiringReview,
    expiredCerts,
    openFindings,
    overdueCas,
    openRisks,
    upcomingCalibrations,
    upcomingMrMs,
    upcomingAudits,
  ] = await Promise.all([
    count(`SELECT COUNT(*)::int AS count FROM iso_documents WHERE soft_deleted_at IS NULL AND status NOT IN ('Obsolete','Archived')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_documents WHERE soft_deleted_at IS NULL AND status IN ('Approved','Current')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_documents WHERE soft_deleted_at IS NULL AND status IN ('Draft','Under Review')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_documents WHERE soft_deleted_at IS NULL AND status = 'Obsolete'`),
    count(`SELECT COUNT(*)::int AS count FROM iso_record_types`),
    count(`SELECT COUNT(*)::int AS count FROM iso_documents WHERE soft_deleted_at IS NULL AND review_date IS NOT NULL AND review_date <= CURRENT_DATE AND status IN ('Approved','Current')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_external_certificates WHERE expiry_date < CURRENT_DATE AND status <> 'Expired'`),
    count(`SELECT COUNT(*)::int AS count FROM iso_findings WHERE status IN ('Open','In Progress')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_corrective_actions WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed','Cancelled')`),
    count(`SELECT COUNT(*)::int AS count FROM iso_risks WHERE status = 'Open'`),
    count(`SELECT COUNT(*)::int AS count FROM iso_calibrations WHERE next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE + INTERVAL '30 days' AND status <> 'Completed'`),
    count(`SELECT COUNT(*)::int AS count FROM iso_management_reviews WHERE next_review_date IS NOT NULL AND next_review_date <= CURRENT_DATE + INTERVAL '60 days'`),
    count(`SELECT COUNT(*)::int AS count FROM iso_audits WHERE status IN ('Draft','Planned','In Progress') AND (planned_date IS NULL OR planned_date <= CURRENT_DATE + INTERVAL '60 days')`),
  ])

  const uploadedCodesRes = await query(
    `SELECT DISTINCT UPPER(document_code) AS code
     FROM iso_documents
     WHERE soft_deleted_at IS NULL
       AND document_code IS NOT NULL
       AND status NOT IN ('Obsolete','Archived')`
  )
  const uploadedCodes = new Set(uploadedCodesRes.rows.map((r) => String(r.code || '').toUpperCase()))
  const requiredCodes = REQUIRED_CONTROLLED_DOCUMENT_CODES
  const requiredUploaded = requiredCodes.filter((c) => uploadedCodes.has(c.toUpperCase()))

  const recordEvidenceRes = await query(
    `SELECT rt.format_code,
            COUNT(d.id)::int AS evidence_count
     FROM iso_record_types rt
     LEFT JOIN iso_documents d
       ON d.soft_deleted_at IS NULL
      AND (
        UPPER(d.document_code) LIKE '%' || UPPER(rt.format_code) || '%'
        OR d.document_type ILIKE '%' || rt.format_description || '%'
      )
     GROUP BY rt.id, rt.format_code
     ORDER BY rt.sort_order`
  )
  const recordTypesWithEvidence = recordEvidenceRes.rows.filter((r) => Number(r.evidence_count) > 0).length

  const recentUploads = await query(
    `SELECT d.id, d.title, d.document_code, d.status, v.original_filename, v.uploaded_at
     FROM iso_document_versions v
     JOIN iso_documents d ON d.id = v.document_id
     WHERE d.soft_deleted_at IS NULL
     ORDER BY v.uploaded_at DESC
     LIMIT 10`
  )

  const recentlyRevised = await query(
    `SELECT id, title, document_code, revision, status, revision_date, updated_at
     FROM iso_documents
     WHERE soft_deleted_at IS NULL AND status NOT IN ('Obsolete','Archived')
     ORDER BY COALESCE(revision_date, updated_at::date) DESC NULLS LAST
     LIMIT 10`
  )

  const awaitingApproval = await query(
    `SELECT id, title, document_code, status, updated_at
     FROM iso_documents
     WHERE soft_deleted_at IS NULL AND status = 'Under Review'
     ORDER BY updated_at DESC
     LIMIT 10`
  )

  const casDueSoon = await query(
    `SELECT id, ca_number, description, due_date, status
     FROM iso_corrective_actions
     WHERE status NOT IN ('Closed','Cancelled')
       AND due_date IS NOT NULL
       AND due_date <= CURRENT_DATE + INTERVAL '14 days'
     ORDER BY due_date ASC
     LIMIT 10`
  )

  const expiringCerts = await query(
    `SELECT id, title, certificate_number, expiry_date, status
     FROM iso_external_certificates
     WHERE expiry_date IS NOT NULL
       AND expiry_date <= CURRENT_DATE + INTERVAL '60 days'
     ORDER BY expiry_date ASC
     LIMIT 10`
  )

  const calDue = await query(
    `SELECT c.id, c.next_due_date, c.status, c.certificate_number, e.name AS equipment_name, e.equipment_number
     FROM iso_calibrations c
     LEFT JOIN iso_equipment e ON e.id = c.equipment_id
     WHERE c.next_due_date IS NOT NULL
       AND c.next_due_date <= CURRENT_DATE + INTERVAL '60 days'
     ORDER BY c.next_due_date ASC
     LIMIT 10`
  )

  const recentActivity = await listActivity({ limit: 15 })

  return {
    summary: {
      totalControlledDocuments: totalControlled,
      currentApprovedDocuments: currentApproved,
      draftOrPendingApproval: draftPending,
      obsoleteDocuments: obsolete,
      totalQmsRecordTypes: totalRecordTypes,
      documentsRequiringReview: requiringReview,
      expiredExternalCertificates: expiredCerts,
      openAuditFindings: openFindings,
      overdueCorrectiveActions: overdueCas,
      openRisksRequiringAction: openRisks,
      upcomingCalibrationDates: upcomingCalibrations,
      upcomingManagementReviews: upcomingMrMs,
      upcomingAudits,
    },
    auditReadiness: {
      requiredControlledDocuments: {
        uploaded: requiredUploaded.length,
        required: requiredCodes.length,
        missingCodes: requiredCodes.filter((c) => !uploadedCodes.has(c.toUpperCase())),
        uploadedCodes: requiredUploaded,
      },
      recordTypesWithEvidence: {
        withEvidence: recordTypesWithEvidence,
        total: recordEvidenceRes.rows.length,
      },
      documentsRequiringReview: requiringReview,
      openCorrectiveActions: overdueCas + (await count(
        `SELECT COUNT(*)::int AS count FROM iso_corrective_actions WHERE status NOT IN ('Closed','Cancelled') AND (due_date IS NULL OR due_date >= CURRENT_DATE)`
      )),
    },
    sections: {
      recentUploads: recentUploads.rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        documentCode: r.document_code,
        status: r.status,
        originalFilename: r.original_filename,
        uploadedAt: r.uploaded_at ? new Date(r.uploaded_at).toISOString() : null,
      })),
      recentlyRevised: recentlyRevised.rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        documentCode: r.document_code,
        revision: r.revision,
        status: r.status,
        revisionDate: r.revision_date ? String(r.revision_date).slice(0, 10) : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      })),
      awaitingApproval: awaitingApproval.rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        documentCode: r.document_code,
        status: r.status,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      })),
      correctiveActionsApproachingDue: casDueSoon.rows.map((r) => ({
        id: Number(r.id),
        caNumber: r.ca_number,
        description: r.description,
        dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
        status: r.status,
      })),
      expiredOrExpiringCertificates: expiringCerts.rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        certificateNumber: r.certificate_number,
        expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : null,
        status: r.status,
      })),
      calibrationDueDates: calDue.rows.map((r) => ({
        id: Number(r.id),
        nextDueDate: r.next_due_date ? String(r.next_due_date).slice(0, 10) : null,
        status: r.status,
        certificateNumber: r.certificate_number,
        equipmentName: r.equipment_name,
        equipmentNumber: r.equipment_number,
      })),
      recentActivity,
    },
  }
}

async function getAuditorRoomOverview({ isAuditor = true } = {}) {
  const { AUDITOR_ROOM_SECTIONS } = require('./isoQmsConstants')
  const sections = []
  for (const section of AUDITOR_ROOM_SECTIONS) {
    const clauseParams = section.clauses
    const evidenceRes = await query(
      `SELECT COUNT(DISTINCT d.id)::int AS count,
              MAX(d.updated_at) AS latest_updated
       FROM iso_documents d
       LEFT JOIN iso_document_clauses dc ON dc.document_id = d.id
       LEFT JOIN iso_clauses cl ON cl.id = dc.clause_id
       WHERE d.soft_deleted_at IS NULL
         AND d.publish_to_auditor_room = TRUE
         AND d.status IN ('Approved','Current')
         AND (
           cl.clause_number = ANY($1::text[])
           OR d.document_type ILIKE '%' || $2 || '%'
           OR d.title ILIKE '%' || $2 || '%'
         )`,
      [clauseParams, section.title.split(' ')[0]]
    )
    const latestRes = await query(
      `SELECT d.id, d.title, d.document_code, d.revision, d.status
       FROM iso_documents d
       LEFT JOIN iso_document_clauses dc ON dc.document_id = d.id
       LEFT JOIN iso_clauses cl ON cl.id = dc.clause_id
       WHERE d.soft_deleted_at IS NULL
         AND d.publish_to_auditor_room = TRUE
         AND d.status IN ('Approved','Current')
         AND cl.clause_number = ANY($1::text[])
       ORDER BY d.updated_at DESC
       LIMIT 1`,
      [clauseParams]
    )
    sections.push({
      id: section.id,
      title: section.title,
      clauses: section.clauses,
      evidenceCount: Number(evidenceRes.rows[0]?.count || 0),
      latestDocument: latestRes.rows[0]
        ? {
            id: Number(latestRes.rows[0].id),
            title: latestRes.rows[0].title,
            documentCode: latestRes.rows[0].document_code,
            revision: latestRes.rows[0].revision,
            status: latestRes.rows[0].status,
          }
        : null,
    })
  }
  return { sections, isAuditor }
}

async function getAuditorRoomSection(sectionId) {
  const { AUDITOR_ROOM_SECTIONS } = require('./isoQmsConstants')
  const section = AUDITOR_ROOM_SECTIONS.find((s) => s.id === sectionId)
  if (!section) {
    const err = new Error('Unknown auditor room section')
    err.status = 404
    throw err
  }
  const docs = await query(
    `SELECT d.id, d.title, d.document_code, d.revision, d.status, d.document_type,
            d.department, d.auditor_download_allowed, d.updated_at
     FROM iso_documents d
     LEFT JOIN iso_document_clauses dc ON dc.document_id = d.id
     LEFT JOIN iso_clauses cl ON cl.id = dc.clause_id
     WHERE d.soft_deleted_at IS NULL
       AND d.publish_to_auditor_room = TRUE
       AND d.status IN ('Approved','Current')
       AND cl.clause_number = ANY($1::text[])
     ORDER BY d.title`,
    [section.clauses]
  )
  return {
    ...section,
    documents: docs.rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      documentCode: r.document_code,
      revision: r.revision,
      status: r.status,
      documentType: r.document_type,
      department: r.department,
      auditorDownloadAllowed: Boolean(r.auditor_download_allowed),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    })),
  }
}

async function listClauses() {
  const result = await query(`SELECT * FROM iso_clauses ORDER BY sort_order, clause_number`)
  return result.rows.map((r) => ({
    id: Number(r.id),
    clauseNumber: r.clause_number,
    title: r.title,
    parentClauseNumber: r.parent_clause_number,
    sortOrder: Number(r.sort_order || 0),
    responsibleDepartment: r.responsible_department,
    notes: r.notes,
  }))
}

async function getClauseEvidence(clauseId) {
  const clauseRes = await query(`SELECT * FROM iso_clauses WHERE id = $1`, [Number(clauseId)])
  const clause = clauseRes.rows[0]
  if (!clause) return null

  const docs = await query(
    `SELECT d.id, d.title, d.document_code, d.revision, d.status, d.document_type, d.department
     FROM iso_documents d
     JOIN iso_document_clauses dc ON dc.document_id = d.id
     WHERE dc.clause_id = $1 AND d.soft_deleted_at IS NULL
     ORDER BY d.title`,
    [Number(clauseId)]
  )
  const findings = await query(
    `SELECT id, nc_number, classification, status, description
     FROM iso_findings WHERE clause_number = $1 ORDER BY id DESC LIMIT 50`,
    [clause.clause_number]
  )
  const audits = await query(
    `SELECT DISTINCT a.id, a.audit_reference, a.status, a.audit_year
     FROM iso_audits a
     JOIN iso_audit_checklist_items i ON i.audit_id = a.id
     WHERE i.clause_number = $1
     ORDER BY a.audit_year DESC NULLS LAST
     LIMIT 20`,
    [clause.clause_number]
  )

  return {
    clause: {
      id: Number(clause.id),
      clauseNumber: clause.clause_number,
      title: clause.title,
      responsibleDepartment: clause.responsible_department,
      notes: clause.notes,
    },
    documents: docs.rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      documentCode: r.document_code,
      revision: r.revision,
      status: r.status,
      documentType: r.document_type,
      department: r.department,
    })),
    findings: findings.rows.map((r) => ({
      id: Number(r.id),
      ncNumber: r.nc_number,
      classification: r.classification,
      status: r.status,
      description: r.description,
    })),
    audits: audits.rows.map((r) => ({
      id: Number(r.id),
      auditReference: r.audit_reference,
      status: r.status,
      auditYear: r.audit_year,
    })),
  }
}

module.exports = {
  getDashboard,
  getAuditorRoomOverview,
  getAuditorRoomSection,
  listClauses,
  getClauseEvidence,
}

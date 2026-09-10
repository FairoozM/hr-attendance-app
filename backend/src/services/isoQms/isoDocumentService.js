const { query } = require('../../db')
const { logActivity } = require('./isoActivityLogService')
const { filterForAuditor, isCurrentLikeStatus } = require('./isoPermissions')
const {
  CONTROLLED_METADATA_FIELDS,
  CURRENT_LIKE_STATUSES,
  DOCUMENT_STATUSES,
} = require('./isoQmsConstants')
function queueExtraction(versionId) {
  // Lazy require avoids circular dependency with isoExtractionService
  const { queueExtraction: enqueue } = require('./isoExtractionService')
  enqueue(versionId)
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function mapVersion(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    revisionNumber: row.revision_number,
    status: row.status,
    originalFilename: row.original_filename,
    fileType: row.file_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    storageKey: row.storage_key,
    checksumSha256: row.checksum_sha256,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    extractionError: row.extraction_error,
    revisionComments: row.revision_comments,
    uploadedBy: row.uploaded_by != null ? Number(row.uploaded_by) : null,
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : null,
    approvedBy: row.approved_by != null ? Number(row.approved_by) : null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    supersededAt: row.superseded_at ? new Date(row.superseded_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapDocument(row, { includeExtractedText = false } = {}) {
  if (!row) return null
  const doc = {
    id: Number(row.id),
    title: row.title,
    documentCode: row.document_code,
    documentType: row.document_type,
    categoryId: row.category_id != null ? Number(row.category_id) : null,
    categoryName: row.category_name || null,
    department: row.department,
    revision: row.revision,
    issueDate: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
    revisionDate: row.revision_date ? String(row.revision_date).slice(0, 10) : null,
    reviewDate: row.review_date ? String(row.review_date).slice(0, 10) : null,
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    preparedBy: row.prepared_by,
    reviewedBy: row.reviewed_by,
    approvedBy: row.approved_by,
    ownerName: row.owner_name,
    status: row.status,
    description: row.description,
    retentionPeriod: row.retention_period,
    masterCopyLocation: row.master_copy_location,
    distribution: row.distribution,
    confidentiality: row.confidentiality,
    publishToAuditorRoom: Boolean(row.publish_to_auditor_room),
    auditorDownloadAllowed: Boolean(row.auditor_download_allowed),
    currentVersionId: row.current_version_id != null ? Number(row.current_version_id) : null,
    obsoleteDate: row.obsolete_date ? String(row.obsolete_date).slice(0, 10) : null,
    obsoleteReason: row.obsolete_reason,
    isExternal: Boolean(row.is_external),
    remarks: row.remarks,
    softDeletedAt: row.soft_deleted_at ? new Date(row.soft_deleted_at).toISOString() : null,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    tags: row.tags || [],
    clauseIds: row.clause_ids || [],
    clauseNumbers: row.clause_numbers || [],
  }
  if (row.version_id) {
    doc.currentVersion = mapVersion({
      id: row.version_id,
      document_id: row.id,
      revision_number: row.v_revision_number || row.revision,
      status: row.v_status,
      original_filename: row.original_filename,
      file_type: row.file_type,
      file_size: row.file_size,
      storage_key: row.storage_key,
      checksum_sha256: row.checksum_sha256,
      extracted_text: includeExtractedText ? row.extracted_text : undefined,
      extraction_status: row.extraction_status,
      extraction_error: row.extraction_error,
      revision_comments: row.revision_comments,
      uploaded_by: row.uploaded_by,
      uploaded_at: row.uploaded_at,
      approved_by: row.v_approved_by,
      approved_at: row.v_approved_at,
      superseded_at: row.superseded_at,
      created_at: row.v_created_at,
      updated_at: row.v_updated_at,
    })
    if (!includeExtractedText && doc.currentVersion) {
      delete doc.currentVersion.extractedText
    }
  }
  return doc
}

const DOC_SELECT = `
  SELECT d.*,
         c.name AS category_name,
         v.id AS version_id,
         v.revision_number AS v_revision_number,
         v.status AS v_status,
         v.original_filename,
         v.file_type,
         v.file_size,
         v.storage_key,
         v.checksum_sha256,
         v.extraction_status,
         v.extraction_error,
         v.revision_comments,
         v.uploaded_by,
         v.uploaded_at,
         v.approved_by AS v_approved_by,
         v.approved_at AS v_approved_at,
         v.superseded_at,
         v.created_at AS v_created_at,
         v.updated_at AS v_updated_at,
         COALESCE((
           SELECT array_agg(t.tag ORDER BY t.tag)
           FROM iso_document_tags t WHERE t.document_id = d.id
         ), ARRAY[]::text[]) AS tags,
         COALESCE((
           SELECT array_agg(dc.clause_id ORDER BY dc.clause_id)
           FROM iso_document_clauses dc WHERE dc.document_id = d.id
         ), ARRAY[]::int[]) AS clause_ids,
         COALESCE((
           SELECT array_agg(cl.clause_number ORDER BY cl.sort_order)
           FROM iso_document_clauses dc
           JOIN iso_clauses cl ON cl.id = dc.clause_id
           WHERE dc.document_id = d.id
         ), ARRAY[]::text[]) AS clause_numbers
  FROM iso_documents d
  LEFT JOIN iso_categories c ON c.id = d.category_id
  LEFT JOIN iso_document_versions v ON v.id = d.current_version_id
`

async function attachExtras(docs) {
  return docs
}

async function listDocuments(filters = {}, { isAuditor = false } = {}) {
  const params = []
  const where = ['d.soft_deleted_at IS NULL']

  if (isAuditor) {
    const af = filterForAuditor('d', params.length)
    where.push(af.sql)
    params.push(...af.params)
  }

  if (filters.status) {
    params.push(filters.status)
    where.push(`d.status = $${params.length}`)
  }
  if (filters.documentType) {
    params.push(filters.documentType)
    where.push(`d.document_type = $${params.length}`)
  }
  if (filters.categoryId) {
    params.push(Number(filters.categoryId))
    where.push(`d.category_id = $${params.length}`)
  }
  if (filters.department) {
    params.push(filters.department)
    where.push(`d.department ILIKE $${params.length}`)
  }
  if (filters.documentCode) {
    params.push(`%${filters.documentCode}%`)
    where.push(`d.document_code ILIKE $${params.length}`)
  }
  if (filters.q) {
    params.push(`%${filters.q}%`)
    where.push(`(d.title ILIKE $${params.length} OR d.document_code ILIKE $${params.length} OR d.description ILIKE $${params.length})`)
  }
  if (filters.publishToAuditorRoom != null && !isAuditor) {
    params.push(Boolean(filters.publishToAuditorRoom))
    where.push(`d.publish_to_auditor_room = $${params.length}`)
  }
  if (filters.clauseId) {
    params.push(Number(filters.clauseId))
    where.push(`EXISTS (SELECT 1 FROM iso_document_clauses dc WHERE dc.document_id = d.id AND dc.clause_id = $${params.length})`)
  }
  if (filters.includeObsolete !== true && !filters.status) {
    where.push(`d.status NOT IN ('Obsolete', 'Archived')`)
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  const offset = Math.max(Number(filters.offset) || 0, 0)
  params.push(limit, offset)

  const result = await query(
    `${DOC_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY d.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return attachExtras(result.rows.map((r) => mapDocument(r)))
}

async function getDocument(id, { isAuditor = false, includeExtractedText = false } = {}) {
  const params = [Number(id)]
  let auditorSql = ''
  if (isAuditor) {
    const af = filterForAuditor('d', params.length)
    auditorSql = ` AND ${af.sql}`
    params.push(...af.params)
  }
  const result = await query(
    `${DOC_SELECT}
     WHERE d.id = $1 AND d.soft_deleted_at IS NULL${auditorSql}`,
    params
  )
  if (!result.rows[0]) return null
  const doc = mapDocument(result.rows[0], { includeExtractedText })
  if (includeExtractedText && doc.currentVersionId) {
    const vr = await query(
      `SELECT extracted_text FROM iso_document_versions WHERE id = $1`,
      [doc.currentVersionId]
    )
    if (doc.currentVersion) {
      doc.currentVersion.extractedText = vr.rows[0]?.extracted_text || null
    }
  }
  return doc
}

async function setDocumentTags(documentId, tags = []) {
  await query(`DELETE FROM iso_document_tags WHERE document_id = $1`, [documentId])
  for (const tag of tags) {
    const t = String(tag || '').trim().slice(0, 128)
    if (!t) continue
    await query(
      `INSERT INTO iso_document_tags (document_id, tag) VALUES ($1, $2)
       ON CONFLICT (document_id, tag) DO NOTHING`,
      [documentId, t]
    )
  }
}

async function setDocumentClauses(documentId, clauseIds = []) {
  await query(`DELETE FROM iso_document_clauses WHERE document_id = $1`, [documentId])
  for (const cid of clauseIds) {
    const id = Number(cid)
    if (!Number.isFinite(id)) continue
    await query(
      `INSERT INTO iso_document_clauses (document_id, clause_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [documentId, id]
    )
  }
}

/**
 * Create document + first version. Version starts as Draft unless meta.status says otherwise.
 * storage_key must be unique (never overwrite).
 */
async function createDocumentWithVersion(meta, fileMeta, userId) {
  if (!meta?.title) throw httpError(400, 'title is required')
  if (!fileMeta?.storageKey) throw httpError(400, 'storageKey is required')

  if (fileMeta.checksumSha256) {
    const dup = await findByChecksum(fileMeta.checksumSha256)
    if (dup) {
      const err = httpError(409, 'Duplicate file checksum — this file content already exists')
      err.duplicate = dup
      throw err
    }
  }

  const status = meta.status && DOCUMENT_STATUSES.includes(meta.status) ? meta.status : 'Draft'
  const versionStatus = isCurrentLikeStatus(status) ? status : 'Draft'

  const docRes = await query(
    `INSERT INTO iso_documents (
       title, document_code, document_type, category_id, department, revision,
       issue_date, revision_date, review_date, expiry_date,
       prepared_by, reviewed_by, approved_by, owner_name, status, description,
       retention_period, master_copy_location, distribution, confidentiality,
       publish_to_auditor_room, auditor_download_allowed, is_external, remarks,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25
     ) RETURNING id`,
    [
      String(meta.title).trim(),
      meta.documentCode || null,
      meta.documentType || 'Other Evidence',
      meta.categoryId != null ? Number(meta.categoryId) : null,
      meta.department || null,
      meta.revision || fileMeta.revisionNumber || '00',
      meta.issueDate || null,
      meta.revisionDate || null,
      meta.reviewDate || null,
      meta.expiryDate || null,
      meta.preparedBy || null,
      meta.reviewedBy || null,
      meta.approvedBy || null,
      meta.ownerName || null,
      versionStatus === 'Draft' ? 'Draft' : status,
      meta.description || null,
      meta.retentionPeriod || null,
      meta.masterCopyLocation || null,
      meta.distribution || null,
      meta.confidentiality || 'Internal',
      Boolean(meta.publishToAuditorRoom),
      Boolean(meta.auditorDownloadAllowed),
      Boolean(meta.isExternal),
      meta.remarks || null,
      userId != null ? Number(userId) : null,
    ]
  )
  const documentId = Number(docRes.rows[0].id)

  const verRes = await query(
    `INSERT INTO iso_document_versions (
       document_id, revision_number, status, original_filename, file_type, file_size,
       storage_key, checksum_sha256, revision_comments, uploaded_by, extraction_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending')
     RETURNING *`,
    [
      documentId,
      meta.revision || '00',
      versionStatus,
      fileMeta.originalFilename || null,
      fileMeta.fileType || null,
      fileMeta.fileSize != null ? Number(fileMeta.fileSize) : null,
      fileMeta.storageKey,
      fileMeta.checksumSha256 || null,
      meta.revisionComments || null,
      userId != null ? Number(userId) : null,
    ]
  )
  const version = verRes.rows[0]

  if (isCurrentLikeStatus(version.status)) {
    await query(
      `UPDATE iso_documents SET current_version_id = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [version.id, version.status, documentId]
    )
  }

  if (Array.isArray(meta.tags)) await setDocumentTags(documentId, meta.tags)
  if (Array.isArray(meta.clauseIds)) await setDocumentClauses(documentId, meta.clauseIds)

  await logActivity({
    userId,
    action: 'document.create',
    entityType: 'iso_document',
    entityId: documentId,
    versionId: version.id,
    newValue: { title: meta.title, documentCode: meta.documentCode, storageKey: fileMeta.storageKey },
    message: 'Created document with initial version',
  })

  queueExtraction(Number(version.id))
  return getDocument(documentId)
}

async function updateDocumentMetadata(id, patch, userId) {
  const existing = await getDocument(id)
  if (!existing) throw httpError(404, 'Document not found')

  const snakeMap = {
    title: 'title',
    documentCode: 'document_code',
    documentType: 'document_type',
    categoryId: 'category_id',
    department: 'department',
    revision: 'revision',
    issueDate: 'issue_date',
    revisionDate: 'revision_date',
    reviewDate: 'review_date',
    expiryDate: 'expiry_date',
    preparedBy: 'prepared_by',
    reviewedBy: 'reviewed_by',
    approvedBy: 'approved_by',
    ownerName: 'owner_name',
    description: 'description',
    retentionPeriod: 'retention_period',
    masterCopyLocation: 'master_copy_location',
    distribution: 'distribution',
    confidentiality: 'confidentiality',
    isExternal: 'is_external',
    remarks: 'remarks',
  }

  const sets = []
  const params = []
  const changedControlled = {}
  const isControlled = isCurrentLikeStatus(existing.status)

  for (const [camel, col] of Object.entries(snakeMap)) {
    if (!Object.prototype.hasOwnProperty.call(patch, camel)) continue
    let val = patch[camel]
    if (camel === 'categoryId') val = val != null ? Number(val) : null
    if (camel === 'isExternal') val = Boolean(val)
    params.push(val)
    sets.push(`${col} = $${params.length}`)
    if (isControlled && CONTROLLED_METADATA_FIELDS.includes(col)) {
      const prev = existing[camel]
      if (String(prev ?? '') !== String(val ?? '')) {
        changedControlled[col] = { from: prev, to: val }
      }
    }
  }

  if (sets.length) {
    params.push(userId != null ? Number(userId) : null)
    params.push(Number(id))
    await query(
      `UPDATE iso_documents SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
       WHERE id = $${params.length} AND soft_deleted_at IS NULL`,
      params
    )
  }

  if (Array.isArray(patch.tags)) await setDocumentTags(Number(id), patch.tags)
  if (Array.isArray(patch.clauseIds)) await setDocumentClauses(Number(id), patch.clauseIds)

  if (Object.keys(changedControlled).length) {
    await query(
      `INSERT INTO iso_document_approvals (
         document_id, version_id, action, from_status, to_status, actor_user_id, comments, controlled_fields_changed
       ) VALUES ($1, $2, 'metadata_change_on_controlled', $3, $3, $4, $5, $6::jsonb)`,
      [
        Number(id),
        existing.currentVersionId,
        existing.status,
        userId != null ? Number(userId) : null,
        'Controlled metadata changed on Approved/Current document',
        JSON.stringify(changedControlled),
      ]
    )
  }

  await logActivity({
    userId,
    action: 'document.update_metadata',
    entityType: 'iso_document',
    entityId: Number(id),
    previousValue: { status: existing.status },
    newValue: patch,
    message: Object.keys(changedControlled).length
      ? 'Updated controlled metadata (approval event recorded)'
      : 'Updated document metadata',
  })

  return getDocument(id)
}

async function recordApproval(documentId, versionId, action, fromStatus, toStatus, userId, comments) {
  await query(
    `INSERT INTO iso_document_approvals (
       document_id, version_id, action, from_status, to_status, actor_user_id, comments
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [documentId, versionId, action, fromStatus, toStatus, userId, comments || null]
  )
}

async function submitForReview(id, userId, comments) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  if (!['Draft', 'Rejected'].includes(doc.status) && doc.status !== 'Draft') {
    // allow Draft and Under Review re-submit from Draft only primarily
  }
  if (doc.status === 'Obsolete' || doc.status === 'Archived') {
    throw httpError(400, 'Cannot submit obsolete/archived document')
  }
  await query(
    `UPDATE iso_documents SET status = 'Under Review', updated_by = $1, updated_at = NOW() WHERE id = $2`,
    [userId, Number(id)]
  )
  if (doc.currentVersionId) {
    await query(
      `UPDATE iso_document_versions SET status = 'Under Review', updated_at = NOW() WHERE id = $1 AND status = 'Draft'`,
      [doc.currentVersionId]
    )
  } else {
    // submit latest draft version
    const latest = await query(
      `SELECT id FROM iso_document_versions WHERE document_id = $1 ORDER BY id DESC LIMIT 1`,
      [Number(id)]
    )
    if (latest.rows[0]) {
      await query(
        `UPDATE iso_document_versions SET status = 'Under Review', updated_at = NOW() WHERE id = $1`,
        [latest.rows[0].id]
      )
    }
  }
  await recordApproval(Number(id), doc.currentVersionId, 'submit_for_review', doc.status, 'Under Review', userId, comments)
  await logActivity({
    userId,
    action: 'document.submit_for_review',
    entityType: 'iso_document',
    entityId: Number(id),
    previousValue: { status: doc.status },
    newValue: { status: 'Under Review' },
  })
  return getDocument(id)
}

async function approve(id, userId, { makeCurrent = true, comments } = {}) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')

  const verRes = await query(
    `SELECT * FROM iso_document_versions
     WHERE document_id = $1
     ORDER BY CASE WHEN status = 'Under Review' THEN 0 WHEN status = 'Draft' THEN 1 ELSE 2 END, id DESC
     LIMIT 1`,
    [Number(id)]
  )
  const version = verRes.rows[0]
  if (!version) throw httpError(400, 'No version to approve')

  const newStatus = makeCurrent ? 'Current' : 'Approved'

  // Supersede previous current/approved versions
  await query(
    `UPDATE iso_document_versions
     SET status = 'Superseded', superseded_at = NOW(), updated_at = NOW()
     WHERE document_id = $1 AND id <> $2 AND status = ANY($3::text[])`,
    [Number(id), version.id, CURRENT_LIKE_STATUSES]
  )

  await query(
    `UPDATE iso_document_versions
     SET status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $3`,
    [newStatus, userId, version.id]
  )

  await query(
    `UPDATE iso_documents
     SET status = $1, current_version_id = $2, revision = $3, updated_by = $4, updated_at = NOW()
     WHERE id = $5`,
    [newStatus, version.id, version.revision_number, userId, Number(id)]
  )

  await recordApproval(Number(id), version.id, 'approve', doc.status, newStatus, userId, comments)
  await logActivity({
    userId,
    action: 'document.approve',
    entityType: 'iso_document',
    entityId: Number(id),
    versionId: Number(version.id),
    previousValue: { status: doc.status },
    newValue: { status: newStatus },
  })
  return getDocument(id)
}

async function reject(id, userId, comments) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  await query(
    `UPDATE iso_documents SET status = 'Draft', updated_by = $1, updated_at = NOW() WHERE id = $2`,
    [userId, Number(id)]
  )
  const ver = await query(
    `SELECT id FROM iso_document_versions WHERE document_id = $1 AND status = 'Under Review' ORDER BY id DESC LIMIT 1`,
    [Number(id)]
  )
  if (ver.rows[0]) {
    await query(
      `UPDATE iso_document_versions SET status = 'Draft', updated_at = NOW() WHERE id = $1`,
      [ver.rows[0].id]
    )
  }
  await recordApproval(Number(id), ver.rows[0]?.id || doc.currentVersionId, 'reject', doc.status, 'Draft', userId, comments)
  await logActivity({
    userId,
    action: 'document.reject',
    entityType: 'iso_document',
    entityId: Number(id),
    message: comments || 'Rejected',
  })
  return getDocument(id)
}

/**
 * Upload a new revision as Draft by default.
 * Never reuses storage keys. Previous Current remains until approval.
 */
async function uploadNewRevision(documentId, fileMeta, userId, { revisionNumber, revisionComments, status = 'Draft' } = {}) {
  const doc = await getDocument(documentId)
  if (!doc) throw httpError(404, 'Document not found')
  if (!fileMeta?.storageKey) throw httpError(400, 'storageKey is required')

  if (fileMeta.checksumSha256) {
    const dup = await findByChecksum(fileMeta.checksumSha256)
    if (dup && Number(dup.documentId) !== Number(documentId)) {
      const err = httpError(409, 'Duplicate file checksum — this file content already exists on another document')
      err.duplicate = dup
      throw err
    }
  }

  const rev = revisionNumber || suggestNextRevision(doc.revision)
  const verStatus = status === 'Draft' || !isCurrentLikeStatus(status) ? 'Draft' : status

  if (isCurrentLikeStatus(verStatus)) {
    throw httpError(400, 'New revisions must start as Draft; approve to make Current')
  }

  const verRes = await query(
    `INSERT INTO iso_document_versions (
       document_id, revision_number, status, original_filename, file_type, file_size,
       storage_key, checksum_sha256, revision_comments, uploaded_by, extraction_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending')
     RETURNING *`,
    [
      Number(documentId),
      rev,
      verStatus,
      fileMeta.originalFilename || null,
      fileMeta.fileType || null,
      fileMeta.fileSize != null ? Number(fileMeta.fileSize) : null,
      fileMeta.storageKey,
      fileMeta.checksumSha256 || null,
      revisionComments || null,
      userId != null ? Number(userId) : null,
    ]
  )

  await query(
    `UPDATE iso_documents SET revision = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`,
    [rev, userId, Number(documentId)]
  )

  await logActivity({
    userId,
    action: 'document.upload_revision',
    entityType: 'iso_document',
    entityId: Number(documentId),
    versionId: Number(verRes.rows[0].id),
    newValue: { revision: rev, storageKey: fileMeta.storageKey },
    message: 'Uploaded new revision (draft)',
  })

  queueExtraction(Number(verRes.rows[0].id))
  return { document: await getDocument(documentId), version: mapVersion(verRes.rows[0]) }
}

function suggestNextRevision(current) {
  const n = parseInt(String(current || '0').replace(/\D/g, ''), 10)
  const next = Number.isFinite(n) ? n + 1 : 1
  return String(next).padStart(2, '0')
}

async function markObsolete(id, userId, reason) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  await query(
    `UPDATE iso_documents
     SET status = 'Obsolete', obsolete_date = CURRENT_DATE, obsolete_reason = $1,
         publish_to_auditor_room = FALSE, updated_by = $2, updated_at = NOW()
     WHERE id = $3`,
    [reason || null, userId, Number(id)]
  )
  if (doc.currentVersionId) {
    await query(
      `UPDATE iso_document_versions SET status = 'Obsolete', updated_at = NOW() WHERE id = $1`,
      [doc.currentVersionId]
    )
  }
  await logActivity({
    userId,
    action: 'document.obsolete',
    entityType: 'iso_document',
    entityId: Number(id),
    message: reason || 'Marked obsolete',
  })
  return getDocument(id)
}

async function archive(id, userId) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  await query(
    `UPDATE iso_documents
     SET status = 'Archived', publish_to_auditor_room = FALSE, updated_by = $1, updated_at = NOW()
     WHERE id = $2`,
    [userId, Number(id)]
  )
  await logActivity({
    userId,
    action: 'document.archive',
    entityType: 'iso_document',
    entityId: Number(id),
  })
  return getDocument(id)
}

async function softDelete(id, userId) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  await query(
    `UPDATE iso_documents
     SET soft_deleted_at = NOW(), soft_deleted_by = $1, publish_to_auditor_room = FALSE,
         updated_by = $1, updated_at = NOW()
     WHERE id = $2`,
    [userId, Number(id)]
  )
  await logActivity({
    userId,
    action: 'document.soft_delete',
    entityType: 'iso_document',
    entityId: Number(id),
  })
  return { success: true, id: Number(id) }
}

async function findByChecksum(checksumSha256) {
  if (!checksumSha256) return null
  const result = await query(
    `SELECT v.*, d.title, d.document_code, d.status AS document_status
     FROM iso_document_versions v
     JOIN iso_documents d ON d.id = v.document_id
     WHERE v.checksum_sha256 = $1 AND d.soft_deleted_at IS NULL
     ORDER BY v.id ASC
     LIMIT 1`,
    [String(checksumSha256).toLowerCase()]
  )
  if (!result.rows[0]) return null
  const row = result.rows[0]
  return {
    versionId: Number(row.id),
    documentId: Number(row.document_id),
    title: row.title,
    documentCode: row.document_code,
    documentStatus: row.document_status,
    storageKey: row.storage_key,
    revisionNumber: row.revision_number,
  }
}

async function setAuditorPublish(id, userId, { publishToAuditorRoom, auditorDownloadAllowed }) {
  const doc = await getDocument(id)
  if (!doc) throw httpError(404, 'Document not found')
  if (publishToAuditorRoom && !isCurrentLikeStatus(doc.status)) {
    throw httpError(400, 'Only Approved/Current documents can be published to Auditor Room')
  }
  await query(
    `UPDATE iso_documents
     SET publish_to_auditor_room = COALESCE($1, publish_to_auditor_room),
         auditor_download_allowed = COALESCE($2, auditor_download_allowed),
         updated_by = $3, updated_at = NOW()
     WHERE id = $4`,
    [
      publishToAuditorRoom == null ? null : Boolean(publishToAuditorRoom),
      auditorDownloadAllowed == null ? null : Boolean(auditorDownloadAllowed),
      userId,
      Number(id),
    ]
  )
  await logActivity({
    userId,
    action: 'document.publish_auditor',
    entityType: 'iso_document',
    entityId: Number(id),
    newValue: { publishToAuditorRoom, auditorDownloadAllowed },
  })
  return getDocument(id)
}

async function getRevisionHistory(documentId, { isAuditor = false } = {}) {
  if (isAuditor) {
    const doc = await getDocument(documentId, { isAuditor: true })
    if (!doc) return []
  }
  const result = await query(
    `SELECT * FROM iso_document_versions
     WHERE document_id = $1
     ORDER BY id DESC`,
    [Number(documentId)]
  )
  let rows = result.rows
  if (isAuditor) {
    rows = rows.filter((r) => CURRENT_LIKE_STATUSES.includes(r.status) || r.status === 'Superseded')
  }
  return rows.map(mapVersion)
}

async function getVersion(versionId) {
  const result = await query(`SELECT * FROM iso_document_versions WHERE id = $1`, [Number(versionId)])
  return mapVersion(result.rows[0])
}

module.exports = {
  listDocuments,
  getDocument,
  createDocumentWithVersion,
  updateDocumentMetadata,
  submitForReview,
  approve,
  reject,
  uploadNewRevision,
  markObsolete,
  archive,
  softDelete,
  findByChecksum,
  setAuditorPublish,
  getRevisionHistory,
  getVersion,
  mapDocument,
  mapVersion,
  suggestNextRevision,
}

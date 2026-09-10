const multer = require('multer')
const documentService = require('../../services/isoQms/isoDocumentService')
const uploadService = require('../../services/isoQms/isoUploadService')
const extractionService = require('../../services/isoQms/isoExtractionService')
const searchService = require('../../services/isoQms/isoSearchService')
const auditService = require('../../services/isoQms/isoAuditService')
const findingsService = require('../../services/isoQms/isoFindingsService')
const dashboardService = require('../../services/isoQms/isoDashboardService')
const masterListsService = require('../../services/isoQms/isoMasterListsService')
const phase2 = require('../../services/isoQms/isoPhase2Service')
const activityLog = require('../../services/isoQms/isoActivityLogService')
const {
  isAuditorRole,
  canDownloadAsAuditor,
} = require('../../services/isoQms/isoPermissions')
const s3Service = require('../../services/s3Service')
const { MAX_FILE_SIZE_BYTES } = require('../../services/isoQms/isoQmsConstants')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
})

function sendError(res, err) {
  const status = err.status || err.statusCode || 500
  if (status >= 500) console.error('[iso-qms]', err)
  const body = { error: err.message || 'Internal server error' }
  if (err.duplicate) body.duplicate = err.duplicate
  return res.status(status).json(body)
}

function uid(req) {
  return req.user?.userId != null ? Number(req.user.userId) : null
}

function auditorOpts(req) {
  return { isAuditor: isAuditorRole(req.user) }
}

// ── Dashboard / auditor room / clauses ──────────────────────────────────────

async function getDashboard(req, res) {
  try {
    res.json(await dashboardService.getDashboard())
  } catch (err) {
    sendError(res, err)
  }
}

async function getAuditorRoom(req, res) {
  try {
    if (isAuditorRole(req.user)) {
      await phase2.touchAuditorActivity(uid(req))
    }
    res.json(await dashboardService.getAuditorRoomOverview({ isAuditor: isAuditorRole(req.user) }))
  } catch (err) {
    sendError(res, err)
  }
}

async function getAuditorRoomSection(req, res) {
  try {
    res.json(await dashboardService.getAuditorRoomSection(req.params.section))
  } catch (err) {
    sendError(res, err)
  }
}

async function listClauses(req, res) {
  try {
    res.json(await dashboardService.listClauses())
  } catch (err) {
    sendError(res, err)
  }
}

async function getClauseEvidence(req, res) {
  try {
    const data = await dashboardService.getClauseEvidence(req.params.id)
    if (!data) return res.status(404).json({ error: 'Clause not found' })
    res.json(data)
  } catch (err) {
    sendError(res, err)
  }
}

// ── Documents ───────────────────────────────────────────────────────────────

async function listDocuments(req, res) {
  try {
    const docs = await documentService.listDocuments(req.query, auditorOpts(req))
    res.json(docs)
  } catch (err) {
    sendError(res, err)
  }
}

async function getDocument(req, res) {
  try {
    const doc = await documentService.getDocument(req.params.id, {
      ...auditorOpts(req),
      includeExtractedText: !isAuditorRole(req.user),
    })
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    res.json(doc)
  } catch (err) {
    sendError(res, err)
  }
}

async function createDocument(req, res) {
  try {
    let fileMeta = null
    const body = req.body || {}
    if (req.file) {
      fileMeta = await uploadService.uploadBufferToS3({
        documentId: 'new',
        revisionLabel: body.revision || '00',
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        buffer: req.file.buffer,
      })
    } else if (body.storageKey) {
      fileMeta = uploadService.confirmUploadAfterPresign({
        storageKey: body.storageKey,
        fileName: body.originalFilename || body.fileName,
        contentType: body.fileType || body.contentType,
        fileSize: body.fileSize,
        checksumSha256: body.checksumSha256,
      })
    } else {
      return res.status(400).json({ error: 'File upload or storageKey required' })
    }

    const suggestions = fileMeta.suggestions || {}
    const meta = {
      title: body.title || suggestions.titleHint || fileMeta.originalFilename,
      documentCode: body.documentCode || suggestions.documentCode,
      documentType: body.documentType || suggestions.documentType || 'Other Evidence',
      categoryId: body.categoryId,
      department: body.department,
      revision: body.revision || suggestions.revision || '00',
      issueDate: body.issueDate,
      revisionDate: body.revisionDate,
      reviewDate: body.reviewDate,
      expiryDate: body.expiryDate,
      preparedBy: body.preparedBy,
      reviewedBy: body.reviewedBy,
      approvedBy: body.approvedBy,
      ownerName: body.ownerName,
      status: body.status || 'Draft',
      description: body.description,
      retentionPeriod: body.retentionPeriod,
      masterCopyLocation: body.masterCopyLocation,
      distribution: body.distribution,
      confidentiality: body.confidentiality,
      publishToAuditorRoom: body.publishToAuditorRoom === true || body.publishToAuditorRoom === 'true',
      auditorDownloadAllowed: body.auditorDownloadAllowed === true || body.auditorDownloadAllowed === 'true',
      isExternal: body.isExternal === true || body.isExternal === 'true',
      remarks: body.remarks,
      tags: body.tags ? (Array.isArray(body.tags) ? body.tags : String(body.tags).split(',')) : suggestions.tags,
      clauseIds: body.clauseIds
        ? (Array.isArray(body.clauseIds) ? body.clauseIds : String(body.clauseIds).split(',').map(Number))
        : undefined,
    }

    const doc = await documentService.createDocumentWithVersion(meta, fileMeta, uid(req))
    res.status(201).json(doc)
  } catch (err) {
    sendError(res, err)
  }
}

async function patchDocument(req, res) {
  try {
    const doc = await documentService.updateDocumentMetadata(req.params.id, req.body || {}, uid(req))
    res.json(doc)
  } catch (err) {
    sendError(res, err)
  }
}

async function submitForReview(req, res) {
  try {
    res.json(await documentService.submitForReview(req.params.id, uid(req), req.body?.comments))
  } catch (err) {
    sendError(res, err)
  }
}

async function approveDocument(req, res) {
  try {
    res.json(await documentService.approve(req.params.id, uid(req), {
      makeCurrent: req.body?.makeCurrent !== false,
      comments: req.body?.comments,
    }))
  } catch (err) {
    sendError(res, err)
  }
}

async function rejectDocument(req, res) {
  try {
    res.json(await documentService.reject(req.params.id, uid(req), req.body?.comments))
  } catch (err) {
    sendError(res, err)
  }
}

async function uploadRevision(req, res) {
  try {
    let fileMeta
    if (req.file) {
      fileMeta = await uploadService.uploadBufferToS3({
        documentId: req.params.id,
        revisionLabel: req.body?.revisionNumber || 'rev',
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        buffer: req.file.buffer,
      })
    } else if (req.body?.storageKey) {
      fileMeta = uploadService.confirmUploadAfterPresign({
        storageKey: req.body.storageKey,
        fileName: req.body.originalFilename || req.body.fileName,
        contentType: req.body.fileType || req.body.contentType,
        fileSize: req.body.fileSize,
        checksumSha256: req.body.checksumSha256,
      })
    } else {
      return res.status(400).json({ error: 'File or storageKey required' })
    }
    const result = await documentService.uploadNewRevision(req.params.id, fileMeta, uid(req), {
      revisionNumber: req.body?.revisionNumber,
      revisionComments: req.body?.revisionComments,
    })
    res.status(201).json(result)
  } catch (err) {
    sendError(res, err)
  }
}

async function obsoleteDocument(req, res) {
  try {
    res.json(await documentService.markObsolete(req.params.id, uid(req), req.body?.reason))
  } catch (err) {
    sendError(res, err)
  }
}

async function archiveDocument(req, res) {
  try {
    res.json(await documentService.archive(req.params.id, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function deleteDocument(req, res) {
  try {
    res.json(await documentService.softDelete(req.params.id, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function publishAuditor(req, res) {
  try {
    res.json(await documentService.setAuditorPublish(req.params.id, uid(req), {
      publishToAuditorRoom: req.body?.publishToAuditorRoom,
      auditorDownloadAllowed: req.body?.auditorDownloadAllowed,
    }))
  } catch (err) {
    sendError(res, err)
  }
}

async function listVersions(req, res) {
  try {
    res.json(await documentService.getRevisionHistory(req.params.id, auditorOpts(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function versionDownloadUrl(req, res) {
  try {
    const version = await documentService.getVersion(req.params.id)
    if (!version) return res.status(404).json({ error: 'Version not found' })
    const doc = await documentService.getDocument(version.documentId, auditorOpts(req))
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (isAuditorRole(req.user) && !canDownloadAsAuditor(doc)) {
      return res.status(403).json({ error: 'Auditor download not allowed for this document' })
    }
    const url = await s3Service.getDownloadUrl({ key: version.storageKey })
    res.json({ url, version })
  } catch (err) {
    sendError(res, err)
  }
}

async function versionPreviewUrl(req, res) {
  return versionDownloadUrl(req, res)
}

async function retryExtraction(req, res) {
  try {
    const result = await extractionService.retryExtraction(req.params.id)
    if (!result) return res.status(404).json({ error: 'Version not found' })
    res.json({
      id: Number(result.id),
      extractionStatus: result.extraction_status,
      extractionError: result.extraction_error,
    })
  } catch (err) {
    sendError(res, err)
  }
}

// ── Uploads ─────────────────────────────────────────────────────────────────

async function presignUpload(req, res) {
  try {
    const { fileName, contentType, fileSize, documentId, revisionLabel } = req.body || {}
    if (!fileName) return res.status(400).json({ error: 'fileName is required' })
    const result = await uploadService.preparePresignUpload({
      documentId: documentId || 'new',
      revisionLabel: revisionLabel || 'draft',
      fileName,
      contentType,
      fileSize,
    })
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
}

async function confirmUpload(req, res) {
  try {
    const meta = uploadService.confirmUploadAfterPresign(req.body || {})
    res.json(meta)
  } catch (err) {
    sendError(res, err)
  }
}

async function bulkConfirmUpload(req, res) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const out = []
    for (const item of items) {
      const fileMeta = uploadService.confirmUploadAfterPresign(item)
      const suggestions = fileMeta.suggestions || {}
      const doc = await documentService.createDocumentWithVersion(
        {
          title: item.title || suggestions.titleHint || fileMeta.originalFilename,
          documentCode: item.documentCode || suggestions.documentCode,
          documentType: item.documentType || suggestions.documentType || 'Other Evidence',
          revision: item.revision || suggestions.revision || '00',
          department: item.department,
          status: 'Draft',
          publishToAuditorRoom: false,
          tags: suggestions.tags,
        },
        fileMeta,
        uid(req)
      )
      out.push(doc)
    }
    res.status(201).json({ documents: out })
  } catch (err) {
    sendError(res, err)
  }
}

async function parseFilename(req, res) {
  try {
    res.json(uploadService.parseFilenameSuggestions(req.body?.fileName || req.query?.fileName || ''))
  } catch (err) {
    sendError(res, err)
  }
}

// ── Search / master lists ───────────────────────────────────────────────────

async function search(req, res) {
  try {
    const q = req.query.q || req.query.query || ''
    res.json(await searchService.searchIso(q, req.query, auditorOpts(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function masterDocuments(req, res) {
  try {
    res.json(await masterListsService.getMasterDocuments(req.query))
  } catch (err) {
    sendError(res, err)
  }
}

async function masterRecords(req, res) {
  try {
    res.json(await masterListsService.getMasterRecords(req.query))
  } catch (err) {
    sendError(res, err)
  }
}

async function exportMasterDocuments(req, res) {
  try {
    const buf = await masterListsService.exportMasterDocumentsExcel(req.query)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="master-list-documents.xlsx"')
    res.send(buf)
  } catch (err) {
    sendError(res, err)
  }
}

async function exportMasterRecords(req, res) {
  try {
    const buf = await masterListsService.exportMasterRecordsExcel(req.query)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="master-list-records.xlsx"')
    res.send(buf)
  } catch (err) {
    sendError(res, err)
  }
}

async function exportFindings(req, res) {
  try {
    const buf = await masterListsService.exportFindingsExcel(req.query)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="findings-list.xlsx"')
    res.send(buf)
  } catch (err) {
    sendError(res, err)
  }
}

async function exportCorrectiveActions(req, res) {
  try {
    const buf = await masterListsService.exportCorrectiveActionsExcel(req.query)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="corrective-action-tracker.xlsx"')
    res.send(buf)
  } catch (err) {
    sendError(res, err)
  }
}

// ── Audits ──────────────────────────────────────────────────────────────────

async function listAudits(req, res) {
  try {
    res.json(await auditService.listAudits(req.query))
  } catch (err) {
    sendError(res, err)
  }
}

async function getAudit(req, res) {
  try {
    const audit = await auditService.getAudit(req.params.id)
    if (!audit) return res.status(404).json({ error: 'Audit not found' })
    res.json(audit)
  } catch (err) {
    sendError(res, err)
  }
}

async function createAudit(req, res) {
  try {
    res.status(201).json(await auditService.createAudit(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function patchAudit(req, res) {
  try {
    res.json(await auditService.updateAudit(req.params.id, req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function addAuditSection(req, res) {
  try {
    res.status(201).json(await auditService.addSection(req.params.id, req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
}

async function addChecklistItem(req, res) {
  try {
    res.status(201).json(await auditService.addChecklistItem(req.params.id, req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function patchChecklistItem(req, res) {
  try {
    res.json(await auditService.updateChecklistItem(req.params.itemId, req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function linkAuditEvidence(req, res) {
  try {
    res.status(201).json(await auditService.linkEvidence({
      auditId: req.params.id,
      checklistItemId: req.body?.checklistItemId,
      documentId: req.body?.documentId,
      versionId: req.body?.versionId,
      notes: req.body?.notes,
      userId: uid(req),
    }))
  } catch (err) {
    sendError(res, err)
  }
}

async function deleteAuditEvidence(req, res) {
  try {
    res.json(await auditService.deleteEvidence(req.params.evidenceId))
  } catch (err) {
    sendError(res, err)
  }
}

async function auditReport(req, res) {
  try {
    res.json(await auditService.generateReportData(req.params.id))
  } catch (err) {
    sendError(res, err)
  }
}

// ── Findings / CA ───────────────────────────────────────────────────────────

async function listFindings(req, res) {
  try {
    res.json(await findingsService.listFindings(req.query))
  } catch (err) {
    sendError(res, err)
  }
}

async function getFinding(req, res) {
  try {
    const f = await findingsService.getFinding(req.params.id)
    if (!f) return res.status(404).json({ error: 'Finding not found' })
    res.json(f)
  } catch (err) {
    sendError(res, err)
  }
}

async function createFinding(req, res) {
  try {
    if (isAuditorRole(req.user)) {
      const assignment = await phase2.getActiveAssignmentForUser(uid(req))
      if (!assignment?.canCreateFindings) {
        return res.status(403).json({ error: 'Auditor is not permitted to create findings' })
      }
    }
    res.status(201).json(await findingsService.createFinding(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function patchFinding(req, res) {
  try {
    res.json(await findingsService.updateFinding(req.params.id, req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function listCorrectiveActions(req, res) {
  try {
    res.json(await findingsService.listCorrectiveActions(req.query))
  } catch (err) {
    sendError(res, err)
  }
}

async function getCorrectiveAction(req, res) {
  try {
    const ca = await findingsService.getCorrectiveAction(req.params.id)
    if (!ca) return res.status(404).json({ error: 'Corrective action not found' })
    res.json(ca)
  } catch (err) {
    sendError(res, err)
  }
}

async function createCorrectiveAction(req, res) {
  try {
    res.status(201).json(await findingsService.createCorrectiveAction(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function patchCorrectiveAction(req, res) {
  try {
    res.json(await findingsService.updateCorrectiveAction(req.params.id, req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

// ── Activity / phase 2 ─────────────────────────────────────────────────────

async function getActivityLog(req, res) {
  try {
    res.json(await activityLog.listActivity({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      limit: req.query.limit,
      offset: req.query.offset,
    }))
  } catch (err) {
    sendError(res, err)
  }
}

function wrapList(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req.query))
    } catch (err) {
      sendError(res, err)
    }
  }
}

function wrapCreate(fn) {
  return async (req, res) => {
    try {
      res.status(201).json(await fn(req.body || {}, uid(req)))
    } catch (err) {
      sendError(res, err)
    }
  }
}

const listManagementReviews = wrapList(phase2.listManagementReviews)
const createManagementReview = wrapCreate(phase2.createManagementReview)
const listRiskAssessments = wrapList(phase2.listRiskAssessments)
const createRiskAssessment = wrapCreate(phase2.createRiskAssessment)
const listRisks = wrapList(phase2.listRisks)
const createRisk = async (req, res) => {
  try {
    res.status(201).json(await phase2.createRisk(req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
}
const patchRisk = async (req, res) => {
  try {
    res.json(await phase2.updateRisk(req.params.id, req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
}
const listObjectives = wrapList(phase2.listObjectives)
const createObjective = wrapCreate(phase2.createObjective)
const listSuppliers = wrapList(phase2.listSuppliers)
const createSupplier = wrapCreate(phase2.createSupplier)
const listEquipment = wrapList(phase2.listEquipment)
const createEquipment = wrapCreate(phase2.createEquipment)
const listCalibrations = wrapList(phase2.listCalibrations)
const createCalibration = wrapCreate(phase2.createCalibration)
const listCertificates = wrapList(phase2.listCertificates)
const createCertificate = wrapCreate(phase2.createCertificate)

async function listHrEvidence(req, res) {
  try {
    res.json(await phase2.listHrEvidence())
  } catch (err) {
    sendError(res, err)
  }
}

async function listWarehouseEvidence(req, res) {
  try {
    res.json(await phase2.listWarehouseEvidence())
  } catch (err) {
    sendError(res, err)
  }
}

async function getSettings(req, res) {
  try {
    res.json(await phase2.getSettings())
  } catch (err) {
    sendError(res, err)
  }
}

async function putSettings(req, res) {
  try {
    res.json(await phase2.putSettings(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function listAuditorAssignments(req, res) {
  try {
    res.json(await phase2.listAuditorAssignments())
  } catch (err) {
    sendError(res, err)
  }
}

async function createAuditorAssignment(req, res) {
  try {
    res.status(201).json(await phase2.createAuditorAssignment(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function createAuditorAccount(req, res) {
  try {
    res.status(201).json(await phase2.createAuditorAccount(req.body || {}, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function revokeAuditorAssignment(req, res) {
  try {
    res.json(await phase2.revokeAuditorAssignment(req.params.id, uid(req)))
  } catch (err) {
    sendError(res, err)
  }
}

async function addMaintenanceLog(req, res) {
  try {
    res.status(201).json(await phase2.addMaintenanceLog(req.params.id, req.body || {}))
  } catch (err) {
    sendError(res, err)
  }
}

module.exports = {
  upload,
  getDashboard,
  getAuditorRoom,
  getAuditorRoomSection,
  listClauses,
  getClauseEvidence,
  listDocuments,
  getDocument,
  createDocument,
  patchDocument,
  submitForReview,
  approveDocument,
  rejectDocument,
  uploadRevision,
  obsoleteDocument,
  archiveDocument,
  deleteDocument,
  publishAuditor,
  listVersions,
  versionDownloadUrl,
  versionPreviewUrl,
  retryExtraction,
  presignUpload,
  confirmUpload,
  bulkConfirmUpload,
  parseFilename,
  search,
  masterDocuments,
  masterRecords,
  exportMasterDocuments,
  exportMasterRecords,
  exportFindings,
  exportCorrectiveActions,
  listAudits,
  getAudit,
  createAudit,
  patchAudit,
  addAuditSection,
  addChecklistItem,
  patchChecklistItem,
  linkAuditEvidence,
  deleteAuditEvidence,
  auditReport,
  listFindings,
  getFinding,
  createFinding,
  patchFinding,
  listCorrectiveActions,
  getCorrectiveAction,
  createCorrectiveAction,
  patchCorrectiveAction,
  getActivityLog,
  listManagementReviews,
  createManagementReview,
  listRiskAssessments,
  createRiskAssessment,
  listRisks,
  createRisk,
  patchRisk,
  listObjectives,
  createObjective,
  listSuppliers,
  createSupplier,
  listEquipment,
  createEquipment,
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
  addMaintenanceLog,
}

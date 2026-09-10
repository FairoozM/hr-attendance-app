const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/isoQms/isoQmsController')
const { isAuditorRole } = require('../services/isoQms/isoPermissions')

const router = express.Router()

/**
 * Auditor role: allow view (+ finding create gated in controller).
 * Block edit / approve / delete / settings / document mutations.
 */
function blockAuditorWrites(req, res, next) {
  if (!isAuditorRole(req.user)) return next()
  const method = String(req.method || '').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()

  // Allow POST findings for auditors (controller checks assignment)
  if (method === 'POST' && /^\/findings\/?$/.test(req.path)) return next()

  return res.status(403).json({
    error: 'Auditor role is read-only for ISO documents and QMS administration',
  })
}

function p(action) {
  return auth.requirePermission('iso_qms', action)
}

router.use(auth.requireAuth)
router.use(blockAuditorWrites)

// Dashboard & auditor room
router.get('/dashboard', p('view'), ctrl.getDashboard)
router.get('/auditor-room', p('view'), ctrl.getAuditorRoom)
router.get('/auditor-room/:section', p('view'), ctrl.getAuditorRoomSection)

// Clauses
router.get('/clauses', p('view'), ctrl.listClauses)
router.get('/clauses/:id/evidence', p('view'), ctrl.getClauseEvidence)

// Documents
router.get('/documents', p('view'), ctrl.listDocuments)
router.post('/documents', p('add'), ctrl.upload.single('file'), ctrl.createDocument)
router.get('/documents/:id', p('view'), ctrl.getDocument)
router.patch('/documents/:id', p('edit'), ctrl.patchDocument)
router.delete('/documents/:id', p('delete'), ctrl.deleteDocument)
router.post('/documents/:id/submit-review', p('edit'), ctrl.submitForReview)
router.post('/documents/:id/approve', p('approve'), ctrl.approveDocument)
router.post('/documents/:id/reject', p('approve'), ctrl.rejectDocument)
router.post('/documents/:id/revisions', p('add'), ctrl.upload.single('file'), ctrl.uploadRevision)
router.post('/documents/:id/obsolete', p('edit'), ctrl.obsoleteDocument)
router.post('/documents/:id/archive', p('edit'), ctrl.archiveDocument)
router.post('/documents/:id/publish-auditor', p('edit'), ctrl.publishAuditor)
router.get('/documents/:id/versions', p('view'), ctrl.listVersions)

// Versions
router.get('/versions/:id/download-url', p('view'), ctrl.versionDownloadUrl)
router.get('/versions/:id/preview-url', p('view'), ctrl.versionPreviewUrl)
router.post('/versions/:id/retry-extraction', p('edit'), ctrl.retryExtraction)

// Uploads
router.post('/uploads/presign', p('add'), ctrl.presignUpload)
router.post('/uploads/confirm', p('add'), ctrl.confirmUpload)
router.post('/uploads/bulk-confirm', p('add'), ctrl.bulkConfirmUpload)
router.post('/uploads/parse-filename', p('add'), ctrl.parseFilename)

// Search & master lists
router.get('/search', p('view'), ctrl.search)
router.get('/master-documents', p('view'), ctrl.masterDocuments)
router.get('/master-records', p('view'), ctrl.masterRecords)
router.get('/master-documents/export', p('view'), ctrl.exportMasterDocuments)
router.get('/master-records/export', p('view'), ctrl.exportMasterRecords)
router.get('/findings/export', p('view'), ctrl.exportFindings)
router.get('/corrective-actions/export', p('view'), ctrl.exportCorrectiveActions)

// Audits
router.get('/audits', p('view'), ctrl.listAudits)
router.post('/audits', p('manage_audits'), ctrl.createAudit)
router.get('/audits/:id', p('view'), ctrl.getAudit)
router.patch('/audits/:id', p('manage_audits'), ctrl.patchAudit)
router.post('/audits/:id/sections', p('manage_audits'), ctrl.addAuditSection)
router.post('/audits/:id/checklist', p('manage_audits'), ctrl.addChecklistItem)
router.patch('/audits/:id/checklist/:itemId', p('manage_audits'), ctrl.patchChecklistItem)
router.post('/audits/:id/evidence', p('manage_audits'), ctrl.linkAuditEvidence)
router.delete('/audits/:id/evidence/:evidenceId', p('manage_audits'), ctrl.deleteAuditEvidence)
router.get('/audits/:id/report', p('view'), ctrl.auditReport)

// Findings & CA
router.get('/findings', p('view'), ctrl.listFindings)
router.post('/findings', p('manage_audits'), ctrl.createFinding)
router.get('/findings/:id', p('view'), ctrl.getFinding)
router.patch('/findings/:id', p('manage_audits'), ctrl.patchFinding)
router.get('/corrective-actions', p('view'), ctrl.listCorrectiveActions)
router.post('/corrective-actions', p('manage_audits'), ctrl.createCorrectiveAction)
router.get('/corrective-actions/:id', p('view'), ctrl.getCorrectiveAction)
router.patch('/corrective-actions/:id', p('manage_audits'), ctrl.patchCorrectiveAction)

// Activity
router.get('/activity-log', p('view'), ctrl.getActivityLog)

// Phase 2 entities
router.get('/management-reviews', p('view'), ctrl.listManagementReviews)
router.post('/management-reviews', p('edit'), ctrl.createManagementReview)
router.get('/risk-assessments', p('view'), ctrl.listRiskAssessments)
router.post('/risk-assessments', p('edit'), ctrl.createRiskAssessment)
router.get('/risks', p('view'), ctrl.listRisks)
router.post('/risks', p('edit'), ctrl.createRisk)
router.patch('/risks/:id', p('edit'), ctrl.patchRisk)
router.get('/objectives', p('view'), ctrl.listObjectives)
router.post('/objectives', p('edit'), ctrl.createObjective)
router.get('/suppliers', p('view'), ctrl.listSuppliers)
router.post('/suppliers', p('edit'), ctrl.createSupplier)
router.get('/equipment', p('view'), ctrl.listEquipment)
router.post('/equipment', p('edit'), ctrl.createEquipment)
router.post('/equipment/:id/maintenance', p('edit'), ctrl.addMaintenanceLog)
router.get('/calibrations', p('view'), ctrl.listCalibrations)
router.post('/calibrations', p('edit'), ctrl.createCalibration)
router.get('/certificates', p('view'), ctrl.listCertificates)
router.post('/certificates', p('edit'), ctrl.createCertificate)
router.get('/hr-evidence', p('view'), ctrl.listHrEvidence)
router.get('/warehouse-evidence', p('view'), ctrl.listWarehouseEvidence)

// Settings & auditor assignments
router.get('/settings', p('settings'), ctrl.getSettings)
router.put('/settings', p('settings'), ctrl.putSettings)
router.get('/auditor-assignments', p('settings'), ctrl.listAuditorAssignments)
router.post('/auditor-assignments', p('settings'), ctrl.createAuditorAssignment)
router.post('/auditor-accounts', p('settings'), ctrl.createAuditorAccount)
router.post('/auditor-assignments/:id/revoke', p('settings'), ctrl.revokeAuditorAssignment)

module.exports = router

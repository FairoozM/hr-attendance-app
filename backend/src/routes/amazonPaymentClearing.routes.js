const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonPaymentClearingController')

const router = express.Router({ mergeParams: true })
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

router.use(requireAuth, requireAdmin)

router.get('/ksa/settlements', ctrl.getKsaSettlementReports)
router.get('/ksa/zoho-customers', ctrl.getKsaZohoCustomers)
router.get('/zoho/account-diagnostics', ctrl.getZohoAccountDiagnostics)
router.get('/zoho/chart-accounts', ctrl.getZohoChartAccounts)
router.get('/zoho/oauth/authorize-url', ctrl.getZohoOAuthAuthorize)
router.get('/zoho/oauth/callback', ctrl.getZohoOAuthCallback)
router.post('/zoho/oauth/exchange', ctrl.postZohoOAuthExchange)
router.get('/ksa/batches', ctrl.getKsaSavedBatches)
router.get('/ksa/batches/:id', ctrl.getKsaBatch)
router.post('/ksa/preview', ctrl.postKsaPreview)
router.post('/ksa/preview-upload', upload.single('file'), ctrl.postKsaPreviewUpload)
router.post('/ksa/batches/:id/approve', ctrl.postKsaApproveBatch)
router.get('/ksa/batches/:id/credit-note-apply-plan', ctrl.getKsaCreditNoteApplyPlan)
router.post('/ksa/batches/:id/apply-credit-notes', ctrl.postKsaApplyCreditNotes)
router.get('/ksa/batches/:id/return-fee-plan', ctrl.getKsaReturnFeePlan)
router.post('/ksa/batches/:id/payment-preview', ctrl.postKsaPaymentPreview)
router.post('/ksa/batches/:id/post-to-zoho', ctrl.postKsaPostToZoho)
router.get('/ksa/post-to-zoho-jobs/:jobId', ctrl.getKsaPostToZohoJob)
router.post('/ksa/batches/:id/post-return-fee-journals', ctrl.postKsaReturnFeeJournals)
router.post('/ksa/batches/:id/force-repost', ctrl.postKsaForceRepost)
router.post('/ksa/batches/:id/reclassify-account-level-fees', ctrl.postKsaReclassifyAccountLevelFees)
router.get('/ksa/fee-journal-mappings', ctrl.getFeeJournalMappings)
router.post('/ksa/fee-journal-mappings', ctrl.postFeeJournalMapping)
router.post('/ksa/zoho-invoice-match', ctrl.postKsaZohoInvoiceMatch)

module.exports = router

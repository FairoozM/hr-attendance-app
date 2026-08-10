const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/noonPaymentClearingController')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

router.use(requireAuth, requireAdmin)

router.get('/zoho/chart-accounts', ctrl.getZohoChartAccounts)
router.get('/zoho-customers', ctrl.getZohoCustomers)
router.get('/batches', ctrl.getSavedBatches)
router.get('/batches/:id', ctrl.getBatch)
router.post('/preview-upload', upload.single('file'), ctrl.postPreviewUpload)
router.get('/preview-upload/jobs/:jobId', ctrl.getPreviewUploadJob)
router.post('/batches/:id/approve', ctrl.postApproveBatch)
router.post('/batches/:id/payment-preview', ctrl.postPaymentPreview)
router.post('/batches/:id/post-to-zoho', ctrl.postPostToZoho)
router.post('/batches/:id/force-repost', ctrl.postForceRepost)
router.get('/posting-jobs/:jobId', ctrl.getPostingJob)
router.get('/fee-journal-mappings', ctrl.getFeeJournalMappings)
router.post('/fee-journal-mappings', ctrl.postFeeJournalMapping)
router.delete('/fee-journal-mappings/:id', ctrl.deleteFeeJournalMapping)
router.get('/settings/input-vat', ctrl.getInputVatSettings)
router.put('/settings/input-vat', ctrl.putInputVatSettings)

module.exports = router

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

function rejectInvalidMarketplace(req, res, next) {
  const key = String(req.params.marketplace || '').trim().toLowerCase()
  if (key !== 'ksa' && key !== 'uae') {
    return res.status(404).json({
      success: false,
      error: 'Unknown marketplace. Use ksa or uae.',
      code: 'AMAZON_PAYMENT_CLEARING_UNKNOWN_MARKETPLACE',
    })
  }
  return next()
}

router.get('/zoho/account-diagnostics', ctrl.getZohoAccountDiagnostics)
router.get('/zoho/chart-accounts', ctrl.getZohoChartAccounts)
router.get('/zoho/oauth/authorize-url', ctrl.getZohoOAuthAuthorize)
router.get('/zoho/oauth/callback', ctrl.getZohoOAuthCallback)
router.post('/zoho/oauth/exchange', ctrl.postZohoOAuthExchange)

router.get('/:marketplace/settlements', rejectInvalidMarketplace, ctrl.getSettlementReports)
router.get('/:marketplace/zoho-customers', rejectInvalidMarketplace, ctrl.getZohoCustomers)
router.get('/:marketplace/batches', rejectInvalidMarketplace, ctrl.getSavedBatches)
router.get('/:marketplace/batches/:id', rejectInvalidMarketplace, ctrl.getBatch)
router.post('/:marketplace/preview', rejectInvalidMarketplace, ctrl.postPreview)
router.post('/:marketplace/preview-upload', rejectInvalidMarketplace, upload.single('file'), ctrl.postPreviewUpload)
router.post('/:marketplace/batches/:id/approve', rejectInvalidMarketplace, ctrl.postApproveBatch)
router.get('/:marketplace/batches/:id/credit-note-apply-plan', rejectInvalidMarketplace, ctrl.getCreditNoteApplyPlan)
router.post('/:marketplace/batches/:id/apply-credit-notes', rejectInvalidMarketplace, ctrl.postApplyCreditNotes)
router.get('/:marketplace/batches/:id/return-fee-plan', rejectInvalidMarketplace, ctrl.getReturnFeePlan)
router.post('/:marketplace/batches/:id/payment-preview', rejectInvalidMarketplace, ctrl.postPaymentPreview)
router.post('/:marketplace/batches/:id/post-to-zoho', rejectInvalidMarketplace, ctrl.postPostToZoho)
router.get('/:marketplace/post-to-zoho-jobs/:jobId', rejectInvalidMarketplace, ctrl.getPostToZohoJob)
router.post('/:marketplace/batches/:id/post-return-fee-journals', rejectInvalidMarketplace, ctrl.postReturnFeeJournals)
router.post('/:marketplace/batches/:id/force-repost', rejectInvalidMarketplace, ctrl.postForceRepost)
router.post('/:marketplace/batches/:id/reclassify-account-level-fees', rejectInvalidMarketplace, ctrl.postReclassifyAccountLevelFees)
router.get('/:marketplace/fee-journal-mappings', rejectInvalidMarketplace, ctrl.getFeeJournalMappings)
router.post('/:marketplace/fee-journal-mappings', rejectInvalidMarketplace, ctrl.postFeeJournalMapping)
router.post('/:marketplace/zoho-invoice-match', rejectInvalidMarketplace, ctrl.postZohoInvoiceMatch)

module.exports = router

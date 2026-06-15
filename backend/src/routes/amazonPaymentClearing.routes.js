const express = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonPaymentClearingController')

const router = express.Router({ mergeParams: true })

router.use(requireAuth, requireAdmin)

router.get('/ksa/settlements', ctrl.getKsaSettlementReports)
router.get('/zoho/account-diagnostics', ctrl.getZohoAccountDiagnostics)
router.get('/zoho/oauth/authorize-url', ctrl.getZohoOAuthAuthorize)
router.get('/zoho/oauth/callback', ctrl.getZohoOAuthCallback)
router.post('/zoho/oauth/exchange', ctrl.postZohoOAuthExchange)
router.get('/ksa/batches/:id', ctrl.getKsaBatch)
router.post('/ksa/preview', ctrl.postKsaPreview)
router.post('/ksa/batches/:id/approve', ctrl.postKsaApproveBatch)
router.post('/ksa/batches/:id/payment-preview', ctrl.postKsaPaymentPreview)
router.post('/ksa/batches/:id/post-to-zoho', ctrl.postKsaPostToZoho)
router.post('/ksa/zoho-invoice-match', ctrl.postKsaZohoInvoiceMatch)

module.exports = router

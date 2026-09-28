'use strict'

const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/stripeController')

const router = express.Router()

router.get('/status', auth.requireAuth, auth.requireAdmin, ctrl.status)
router.post('/connection-test', auth.requireAuth, auth.requireAdmin, ctrl.testConnection)
// Read-only: never creates or updates anything in Zoho.
router.get('/clearing/dry-run', auth.requireAuth, auth.requireAdmin, ctrl.clearingDryRun)
router.get('/clearing/:paymentIntentId', auth.requireAuth, auth.requireAdmin, ctrl.clearingRecord)
router.get('/clearing/:paymentIntentId/preview', auth.requireAuth, auth.requireAdmin, ctrl.clearingPreview)
// Read-only payout clearing preview (NET → 1019, FEE → 1013, advances → 1123 per customer).
router.get('/payouts', auth.requireAuth, auth.requireAdmin, ctrl.payoutList)
router.get('/payouts/:payoutId/preview', auth.requireAuth, auth.requireAdmin, ctrl.payoutPreview)
// Local status only (no Zoho): admin confirms a detected overpayment as a customer advance.
router.post('/payouts/:payoutId/customer-advance-cases/confirm', auth.requireAuth, auth.requireAdmin, ctrl.confirmCustomerAdvance)
// Zoho write: NET + FEE customer payments (+ confirmed advance journal) for one payout + customer.
// Refused unless STRIPE_CLEARING_POSTING_ENABLED=true and the live preview still matches.
router.post('/payouts/:payoutId/customers/:customerKey/post', auth.requireAuth, auth.requireAdmin, ctrl.payoutPostCustomerGroup)
// Local status only (no Zoho): record that a gross-only clearing was deleted in Zoho.
router.post('/clearing/:paymentIntentId/reversed-externally', auth.requireAuth, auth.requireAdmin, ctrl.clearingReversedExternally)
router.post('/clearing/:paymentIntentId/post', auth.requireAuth, auth.requireAdmin, ctrl.clearingPostRetired)

module.exports = router

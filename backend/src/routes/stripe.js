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
// Read-only payout grouping preview (NET → 1019, FEE → 1013 per customer).
router.get('/payouts', auth.requireAuth, auth.requireAdmin, ctrl.payoutList)
router.get('/payouts/:payoutId/preview', auth.requireAuth, auth.requireAdmin, ctrl.payoutPreview)
// One PaymentIntent per request; the service re-validates everything live.
router.post('/clearing/:paymentIntentId/post', auth.requireAuth, auth.requireAdmin, ctrl.clearingPost)

module.exports = router

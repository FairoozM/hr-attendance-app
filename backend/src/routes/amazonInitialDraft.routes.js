'use strict'

const express = require('express')

const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonInitialDraftController')

const router = express.Router()

// Admin only, matching Amazon Sync Health and Amazon + Zoho Stock.
router.use(requireAuth, requireAdmin)

router.get('/health', ctrl.getHealth)
router.post('/preview', ctrl.uploadMiddleware, ctrl.postPreview)
router.post('/draft', ctrl.uploadMiddleware, ctrl.postDraft)
router.post('/report', ctrl.uploadMiddleware, ctrl.postReport)

// Multer reports a rejected upload through next(err), which would otherwise reach the
// default handler and answer HTML to a fetch that is expecting JSON.
router.use(ctrl.uploadErrorHandler)

module.exports = router

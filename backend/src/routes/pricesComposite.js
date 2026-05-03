const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/compositeItemsPricingController')

const router = express.Router()

router.post(
  '/composite-items/lookup',
  auth.requireAuth,
  auth.requirePermission('document_expiry', 'view'),
  ctrl.postLookup
)

module.exports = router

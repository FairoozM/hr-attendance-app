const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/compositeItemsPricingController')
const reportCtrl = require('../controllers/compositeItemsPriceReportController')

const router = express.Router()

router.post(
  '/composite-items/lookup',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  ctrl.postLookup
)

router.get(
  '/composite-items/reports',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  reportCtrl.listReports
)

router.post(
  '/composite-items/reports/generate',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  reportCtrl.generateReport
)

router.get(
  '/composite-items/reports/:reportId',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  reportCtrl.getReport
)

module.exports = router

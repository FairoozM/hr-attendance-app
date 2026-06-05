const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/compositeItemsPricingController')
const reportCtrl = require('../controllers/compositeItemsPriceReportController')
const cogsCtrl = require('../controllers/cogsController')
const ksaPricingCtrl = require('../controllers/ksaPricingController')

const router = express.Router()

router.get(
  '/cogs/sales-by-item',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  cogsCtrl.getSalesByItem
)

router.get(
  '/cogs/customers',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  cogsCtrl.getCustomers
)

router.get(
  '/cogs/purchase-costs',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  cogsCtrl.getPurchaseCosts
)

router.post(
  '/ksa/zoho-dimensions',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  ksaPricingCtrl.postZohoDimensions
)

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

router.post(
  '/composite-items/reports/:reportId/items/:itemId/save-parent-price',
  auth.requireAuth,
  auth.requirePermission('prices', 'edit'),
  reportCtrl.saveParentPrice
)

router.delete(
  '/composite-items/reports/:reportId',
  auth.requireAuth,
  auth.requirePermission('prices', 'view'),
  reportCtrl.deleteReport
)

module.exports = router

'use strict'

const express = require('express')
const { requirePermission } = require('../middleware/auth')
const {
  getDailyEcommerceLedger,
  getEcommerceSummaryReport,
} = require('../controllers/ecommerceReportsController')

const router = express.Router()

// GET /api/reports/daily-ecommerce-ledger?date=YYYY-MM-DD
router.get(
  '/daily-ecommerce-ledger',
  requirePermission('weekly_reports', 'view'),
  getDailyEcommerceLedger
)

// GET /api/reports/ecommerce?date=YYYY-MM-DD  (management Ecommerce Summary)
router.get(
  '/ecommerce',
  requirePermission('weekly_reports', 'view'),
  getEcommerceSummaryReport
)

module.exports = router

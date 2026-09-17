'use strict'

const express = require('express')
const { requirePermission } = require('../middleware/auth')
const {
  getDailyEcommerceLedger,
  startDailyEcommerceLedger,
  getDailyEcommerceLedgerJob,
  getEcommerceSummaryReport,
} = require('../controllers/ecommerceReportsController')

const router = express.Router()

// Sync build (scripts / long-timeout clients). UI uses /build + poll.
router.get(
  '/daily-ecommerce-ledger',
  requirePermission('weekly_reports', 'view'),
  getDailyEcommerceLedger
)

// POST /api/reports/daily-ecommerce-ledger/build { date? } -> 202 { jobId }
router.post(
  '/daily-ecommerce-ledger/build',
  requirePermission('weekly_reports', 'view'),
  startDailyEcommerceLedger
)

// GET /api/reports/daily-ecommerce-ledger/build/:jobId
router.get(
  '/daily-ecommerce-ledger/build/:jobId',
  requirePermission('weekly_reports', 'view'),
  getDailyEcommerceLedgerJob
)

// GET /api/reports/ecommerce?date=YYYY-MM-DD  (management Ecommerce Summary)
router.get(
  '/ecommerce',
  requirePermission('weekly_reports', 'view'),
  getEcommerceSummaryReport
)

module.exports = router

'use strict'

const express = require('express')
const { requirePermission } = require('../middleware/auth')
const {
  getDailyEcommerceLedger,
  startDailyEcommerceLedger,
  getDailyEcommerceLedgerJob,
  getEcommerceSummaryReport,
  startEcommerceSummaryReport,
  getEcommerceSummaryJob,
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

// Sync build (scripts). UI uses /build + poll.
router.get(
  '/ecommerce',
  requirePermission('weekly_reports', 'view'),
  getEcommerceSummaryReport
)

// POST /api/reports/ecommerce/build { date? } -> 202 { jobId }
router.post(
  '/ecommerce/build',
  requirePermission('weekly_reports', 'view'),
  startEcommerceSummaryReport
)

// GET /api/reports/ecommerce/build/:jobId
router.get(
  '/ecommerce/build/:jobId',
  requirePermission('weekly_reports', 'view'),
  getEcommerceSummaryJob
)

module.exports = router

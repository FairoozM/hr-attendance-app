'use strict'

const express = require('express')
const { requirePermission } = require('../middleware/auth')
const {
  getDailyEcommerceReport,
  exportDailyEcommerceReportXlsx,
  refreshDailyEcommerceReport,
} = require('../controllers/dailyEcommerceReportController')

const router = express.Router()

/**
 * Export: dedicated `weekly_reports.export`, or `view` for backward compatibility
 * (existing roles only had view). Admin/warehouse still bypass via requirePermission paths.
 */
function requireWeeklyReportsExport(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  if (req.user.role === 'admin' || req.user.role === 'warehouse') return next()
  const mod = req.user.permissions?.weekly_reports || {}
  if (mod.export || mod.view || mod.manage) return next()
  return res.status(403).json({
    error: 'Access denied: requires weekly_reports export (or view) permission',
  })
}

// GET /api/reports/daily-ecommerce?date=YYYY-MM-DD
router.get(
  '/daily-ecommerce',
  requirePermission('weekly_reports', 'view'),
  getDailyEcommerceReport,
)

// GET /api/reports/daily-ecommerce/export.xlsx?date=YYYY-MM-DD
router.get(
  '/daily-ecommerce/export.xlsx',
  requireWeeklyReportsExport,
  exportDailyEcommerceReportXlsx,
)

// POST /api/reports/daily-ecommerce/refresh  { date?: YYYY-MM-DD }
router.post(
  '/daily-ecommerce/refresh',
  requirePermission('weekly_reports', 'view'),
  refreshDailyEcommerceReport,
)

module.exports = router

const express = require('express')
const { requirePermission } = require('../middleware/auth')
const {
  listAvailableGroups,
  getReportByGroup,
  getSlowMovingReport,
} = require('../controllers/weeklyReportsController')

const router = express.Router()

// Generic: list available report groups (driven by item_report_groups table)
router.get('/groups', requirePermission('weekly_reports', 'view'), listAvailableGroups)

// Generic: per-group weekly Zoho-sourced report
// GET /api/weekly-reports/by-group/:group?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
router.get('/by-group/:group', requirePermission('weekly_reports', 'view'), getReportByGroup)

// Legacy: original slow-moving route, preserved for back-compat. Same response
// shape as before; backed by the generic implementation under the hood.
router.get('/slow-moving', requirePermission('weekly_reports', 'view'), getSlowMovingReport)

module.exports = router

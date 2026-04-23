/**
 * TEMPORARY — admin-only; non-production for weekly-report debug.
 */
const express = require('express')
const { requireAdmin } = require('../middleware/auth')
const { getZohoDebugItems } = require('../controllers/debugZohoController')
const { getWeeklyReportDebugByGroup } = require('../controllers/debugWeeklyReportController')

const router = express.Router()
router.get('/zoho/items', requireAdmin, getZohoDebugItems)
// GET /api/debug/weekly-report/by-group/:group?from_date&to_date
router.get('/weekly-report/by-group/:group', requireAdmin, getWeeklyReportDebugByGroup)
module.exports = router

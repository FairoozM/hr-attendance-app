const express = require('express')
const { requirePermission } = require('../middleware/auth')
const { getSlowMovingReport } = require('../controllers/weeklyReportsController')

const router = express.Router()

// GET /api/weekly-reports/slow-moving?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
router.get('/slow-moving', requirePermission('weekly_reports', 'view'), getSlowMovingReport)

module.exports = router

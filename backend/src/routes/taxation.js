const express = require('express')
const { requirePermission } = require('../middleware/auth')
const { getVatCustomers, getVatReport } = require('../controllers/taxationController')

const router = express.Router()

// GET /api/taxation/vat/customers  – Zoho Books customer list (cached 5 min)
router.get('/vat/customers', requirePermission('weekly_reports', 'view'), getVatCustomers)

// GET /api/taxation/vat/report?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&customer_id=]
router.get('/vat/report', requirePermission('weekly_reports', 'view'), getVatReport)

module.exports = router

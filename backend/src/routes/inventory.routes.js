const express = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonZohoStockController')

const router = express.Router()

router.use(requireAuth, requireAdmin)

router.get('/amazon-zoho-stock', ctrl.getAmazonZohoStock)
router.get('/amazon-zoho-stock/export', ctrl.exportAmazonZohoStock)
router.post('/amazon-zoho-stock/vigil-match', ctrl.postAmazonZohoStockVigilMatch)
router.post('/amazon-zoho-stock/refresh', ctrl.postAmazonZohoStockRefresh)
router.get('/amazon-zoho-stock/refresh/:jobId', ctrl.getAmazonZohoStockRefreshStatus)

module.exports = router

const express = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/skuChannelCoverageController')

const router = express.Router()

router.use(requireAuth, requireAdmin)

router.get('/summary', ctrl.getSkuChannelCoverageSummary)
router.get('/export', ctrl.exportSkuChannelCoverage)
router.post('/export', ctrl.exportSkuChannelCoverage)
router.post('/refresh', ctrl.postSkuChannelCoverageRefresh)
router.post('/vigil-zoho', ctrl.postVigilZohoStockCompare)

module.exports = router

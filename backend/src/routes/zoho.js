/**
 * Admin Zoho guard rails — usage, cache, manual sync.
 */
const express = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const zohoAdminController = require('../controllers/zohoAdminController')

const router = express.Router()

router.get('/usage/today', requireAuth, requireAdmin, zohoAdminController.getUsageToday)
router.get('/usage/summary', requireAuth, requireAdmin, zohoAdminController.getUsageSummary)
router.get('/cache/stats', requireAuth, requireAdmin, zohoAdminController.getCacheStats)
router.post('/cache/clear', requireAuth, requireAdmin, zohoAdminController.postCacheClear)
router.post('/sync/items/manual', requireAuth, requireAdmin, zohoAdminController.postManualItemsSync)

module.exports = router

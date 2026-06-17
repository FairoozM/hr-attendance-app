/**
 * Admin Zoho guard rails — usage, cache, manual sync.
 */
const express = require('express')
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth')
const zohoAdminController = require('../controllers/zohoAdminController')
const zohoItemImagesController = require('../controllers/zohoItemImagesController')
const zohoBulkInvoiceController = require('../controllers/zohoBulkInvoiceController')

const router = express.Router()

router.post(
  '/items/images/fetch',
  requirePermission('weekly_reports', 'view'),
  zohoItemImagesController.fetchImages
)
router.post(
  '/items/images/export-csv',
  requirePermission('weekly_reports', 'view'),
  zohoItemImagesController.exportCsv
)
router.post(
  '/items/images/export-zip',
  requirePermission('weekly_reports', 'view'),
  zohoItemImagesController.exportZip
)
router.get(
  '/items/images/:itemId/download',
  requirePermission('weekly_reports', 'view'),
  zohoItemImagesController.downloadImage
)
router.post(
  '/items/validate-skus',
  requireAdmin,
  zohoBulkInvoiceController.validateSkus
)
router.post(
  '/items/validate-names',
  requireAdmin,
  zohoBulkInvoiceController.validateNames
)
router.post(
  '/items/sync',
  requireAdmin,
  zohoBulkInvoiceController.syncItems
)
router.post(
  '/invoices/bulk-create',
  requireAdmin,
  zohoBulkInvoiceController.bulkCreateInvoice
)

router.get('/usage/today', requireAuth, requireAdmin, zohoAdminController.getUsageToday)
router.get('/usage/summary', requireAuth, requireAdmin, zohoAdminController.getUsageSummary)
router.get('/cache/stats', requireAuth, requireAdmin, zohoAdminController.getCacheStats)
router.post('/cache/clear', requireAuth, requireAdmin, zohoAdminController.postCacheClear)
router.post('/sync/items/manual', requireAuth, requireAdmin, zohoAdminController.postManualItemsSync)

module.exports = router

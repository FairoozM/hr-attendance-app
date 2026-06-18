/**
 * Admin Zoho guard rails — usage, cache, manual sync.
 */
const express = require('express')
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth')
const zohoAdminController = require('../controllers/zohoAdminController')
const zohoItemImagesController = require('../controllers/zohoItemImagesController')
const zohoBulkInvoiceController = require('../controllers/zohoBulkInvoiceController')
const inventoryHealthController = require('../controllers/inventoryHealthController')
const inventoryHealthImageController = require('../controllers/inventoryHealthImageController')

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

router.get('/inventory-health', requireAuth, requireAdmin, inventoryHealthController.getInventoryHealth)
router.get('/inventory-health/export.csv', requireAuth, requireAdmin, inventoryHealthController.exportInventoryHealthCsv)
router.post('/inventory-health/refresh', requireAuth, requireAdmin, inventoryHealthController.postInventoryHealthRefresh)
router.get(
  '/inventory-health/images/file/:itemId',
  requireAuth,
  requireAdmin,
  inventoryHealthImageController.getCachedImageFile,
)
router.get('/inventory-health/images/debug-one', requireAuth, requireAdmin, inventoryHealthImageController.getImageDebugOne)
router.get('/inventory-health/images/sync/active', requireAuth, requireAdmin, inventoryHealthImageController.getActiveImageSyncJob)
router.get('/inventory-health/images/sync/job/:jobId', requireAuth, requireAdmin, inventoryHealthImageController.getImageSyncJob)
router.post('/inventory-health/images/sync', requireAuth, requireAdmin, inventoryHealthImageController.postImageSync)
router.get('/inventory-health/images/status', requireAuth, requireAdmin, inventoryHealthImageController.getImageStatus)
router.post('/inventory-health/images/sync-one', requireAuth, requireAdmin, inventoryHealthImageController.postImageSyncOne)
router.post('/inventory-health/images/batch', requireAuth, requireAdmin, inventoryHealthImageController.postImagesBatch)

router.get('/usage/today', requireAuth, requireAdmin, zohoAdminController.getUsageToday)
router.get('/usage/summary', requireAuth, requireAdmin, zohoAdminController.getUsageSummary)
router.get('/cache/stats', requireAuth, requireAdmin, zohoAdminController.getCacheStats)
router.post('/cache/clear', requireAuth, requireAdmin, zohoAdminController.postCacheClear)
router.post('/sync/items/manual', requireAuth, requireAdmin, zohoAdminController.postManualItemsSync)

module.exports = router

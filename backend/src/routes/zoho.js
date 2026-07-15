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

const bulkQuantityAdjustmentController = require('../controllers/bulkQuantityAdjustmentController')
const zohoAccountWatchlistController = require('../controllers/zohoAccountWatchlistController')

const router = express.Router()

router.get(
  '/account-watchlist/accounts',
  requireAuth,
  requireAdmin,
  zohoAccountWatchlistController.getAllAccounts,
)
router.get(
  '/account-watchlist',
  requireAuth,
  requireAdmin,
  zohoAccountWatchlistController.getWatchlist,
)
router.post(
  '/account-watchlist',
  requireAuth,
  requireAdmin,
  zohoAccountWatchlistController.postWatchlist,
)
router.delete(
  '/account-watchlist/:accountId',
  requireAuth,
  requireAdmin,
  zohoAccountWatchlistController.deleteWatchlistAccount,
)

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

router.get(
  '/bulk-quantity-adjustments/template',
  requireAdmin,
  bulkQuantityAdjustmentController.getTemplate,
)
router.post(
  '/bulk-quantity-adjustments/upload',
  requireAdmin,
  bulkQuantityAdjustmentController.uploadMiddleware,
  bulkQuantityAdjustmentController.uploadFile,
)
router.post(
  '/bulk-quantity-adjustments/validate',
  requireAdmin,
  bulkQuantityAdjustmentController.validateBatchFromBody,
)
router.post(
  '/bulk-quantity-adjustments/post',
  requireAdmin,
  bulkQuantityAdjustmentController.postToZohoFromBody,
)
router.get(
  '/bulk-quantity-adjustments/:batchId',
  requireAdmin,
  bulkQuantityAdjustmentController.getBatch,
)
router.post(
  '/bulk-quantity-adjustments/:batchId/validate',
  requireAdmin,
  bulkQuantityAdjustmentController.validateBatch,
)
router.post(
  '/bulk-quantity-adjustments/:batchId/post',
  requireAdmin,
  bulkQuantityAdjustmentController.postToZoho,
)
router.post(
  '/bulk-quantity-adjustments/:batchId/refresh-valuation',
  requireAdmin,
  bulkQuantityAdjustmentController.refreshValuation,
)
router.get(
  '/bulk-quantity-adjustments/:batchId/export-errors',
  requireAdmin,
  bulkQuantityAdjustmentController.exportErrors,
)
router.get(
  '/bulk-quantity-adjustments/:batchId/export-results',
  requireAdmin,
  bulkQuantityAdjustmentController.exportResults,
)

router.get('/inventory-health', requireAuth, requireAdmin, inventoryHealthController.getInventoryHealth)
router.get('/inventory-health/export.csv', requireAuth, requireAdmin, inventoryHealthController.exportInventoryHealthCsv)
router.post('/inventory-health/refresh', requireAuth, requireAdmin, inventoryHealthController.postInventoryHealthRefresh)
router.get(
  '/inventory-health/refresh/job/:jobId',
  requireAuth,
  requireAdmin,
  inventoryHealthController.getInventoryHealthRefreshJob,
)
router.get(
  '/inventory-health/refresh/active',
  requireAuth,
  requireAdmin,
  inventoryHealthController.getActiveInventoryHealthRefreshJob,
)
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

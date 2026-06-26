const express = require('express')
const { requireAuth, requireAdmin, requireAdminOrWarehouse } = require('../middleware/auth')
const { postAmazonGenerateListing } = require('../controllers/amazonListingController')
const { getAmazonMarketplaces, searchAmazonCatalogItems } = require('../controllers/amazonSpApiController')
const {
  getCachedAmazonOrders,
  postAmazonOrdersSync,
  getAmazonSyncStatus,
  getAmazonSyncHealth,
  getAmazonRateLimits,
  getAmazonOrdersDashboardHandler,
  getAmazonSkuImageOverrides,
  postAmazonSkuImageOverride,
} = require('../controllers/amazonOrdersController')
const { amazonListingLimiter } = require('../middleware/aiRateLimiter')
const { validateAmazonGenerateListing } = require('../middleware/validateAiRequest')
const { checkAiBudget } = require('../middleware/checkAiBudget')
const { getZohoItemImage } = require('../controllers/weeklyReportsController')
const amazonOutOfStockClearanceRoutes = require('./amazonOutOfStockClearance.routes')
const amazonPaymentClearingRoutes = require('./amazonPaymentClearing.routes')
const amazonKsaRtoLabelingRoutes = require('./amazonKsaRtoLabeling.routes')

/**
 * Amazon SP-API (JWT: Authorization: Bearer <token>).
 *
 * Dashboard (cache aggregates only):
 *   curl -sS -H "Authorization: Bearer YOUR_JWT" "http://localhost:5001/api/amazon/dashboard/orders?marketplaceKey=all&createdAfter=...&createdBefore=..."
 *
 * Cached orders (no live Amazon on GET):
 *   curl -sS -H "Authorization: Bearer YOUR_JWT" "http://localhost:5001/api/amazon/orders?marketplaceKey=uae&createdAfter=...&createdBefore=..."
 *
 * Sync (admin or warehouse):
 *   curl -sS -X POST -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" \
 *     -d '{"marketplaceKey":"uae","includeItems":true}' "http://localhost:5001/api/amazon/orders/sync"
 *
 * Sync health (admin only, no secrets):
 *   curl -sS -H "Authorization: Bearer ADMIN_JWT" "http://localhost:5001/api/amazon/sync/health"
 */
const router = express.Router()

router.get('/marketplaces', requireAuth, getAmazonMarketplaces)
router.get('/orders', requireAuth, getCachedAmazonOrders)
router.get('/dashboard/orders', requireAuth, getAmazonOrdersDashboardHandler)
/** Same binary handler as weekly reports; auth is any logged-in user (matches GET /api/amazon/orders). */
router.get('/zoho-item-images/:itemId', requireAuth, getZohoItemImage)
router.get('/sku-image-overrides', requireAuth, requireAdmin, getAmazonSkuImageOverrides)
router.post('/sku-image-overrides', requireAuth, requireAdmin, postAmazonSkuImageOverride)
router.post('/orders/sync', requireAuth, requireAdminOrWarehouse, postAmazonOrdersSync)
router.get('/sync/status', requireAuth, getAmazonSyncStatus)
router.get('/sync/health', requireAuth, requireAdmin, getAmazonSyncHealth)
router.get('/rate-limits', requireAuth, requireAdmin, getAmazonRateLimits)
router.get('/catalog/items', requireAuth, searchAmazonCatalogItems)

router.post(
  '/generate-listing',
  requireAuth,
  amazonListingLimiter,
  validateAmazonGenerateListing,
  checkAiBudget,
  postAmazonGenerateListing
)

router.use('/out-of-stock-clearance', amazonOutOfStockClearanceRoutes)
router.use('/payment-clearing', amazonPaymentClearingRoutes)
router.use('/ksa-rto-labeling', amazonKsaRtoLabelingRoutes)

module.exports = router

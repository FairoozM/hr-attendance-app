const express = require('express')
const {
  attachAuth,
  requireAuth,
  requirePermission,
  requireInfluencersWrite,
  requireInfluencersPerformanceWrite,
} = require('../middleware/auth')
const influencersController = require('../controllers/influencersController')
const influencerPerformanceController = require('../controllers/influencerPerformanceController')

const router = express.Router()

router.get('/', attachAuth, requireAuth, requirePermission('influencers', 'view'), influencersController.listInfluencers)

router.get(
  '/performance-records',
  attachAuth,
  requireAuth,
  requirePermission('influencers', 'view'),
  influencerPerformanceController.listPerformanceRecords,
)
router.post(
  '/performance-records/bulk-upsert',
  attachAuth,
  requireAuth,
  requireInfluencersPerformanceWrite,
  influencerPerformanceController.bulkUpsertPerformanceRecords,
)
router.delete(
  '/performance-records/:id',
  attachAuth,
  requireAuth,
  requireInfluencersPerformanceWrite,
  influencerPerformanceController.deletePerformanceRecord,
)
router.post('/', attachAuth, requireAuth, requireInfluencersWrite, influencersController.createInfluencer)
router.put('/', attachAuth, requireAuth, requireInfluencersWrite, influencersController.putInfluencers)
router.post(
  '/instagram/batch-refresh',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.batchRefreshInstagramProfilePictures,
)
router.get(
  '/:id/insights-images/urls',
  attachAuth,
  requireAuth,
  requirePermission('influencers', 'view'),
  influencersController.getInsightsImageSignedUrls,
)
router.post(
  '/:id/insights-images/upload-url',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.getInsightsImageUploadUrl,
)
router.post(
  '/:id/insights-images/upload-urls',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.getInsightsImageUploadUrlsBatch,
)
router.post(
  '/:id/instagram/refresh-profile',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.refreshInstagramProfileFromGraph,
)
router.patch('/:id', attachAuth, requireAuth, requireInfluencersWrite, influencersController.updateInfluencer)
router.delete(
  '/:id',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.deleteInfluencer,
)

module.exports = router

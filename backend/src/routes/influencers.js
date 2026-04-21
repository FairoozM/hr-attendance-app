const express = require('express')
const { attachAuth, requireAuth, requirePermission, requireInfluencersWrite } = require('../middleware/auth')
const influencersController = require('../controllers/influencersController')

const router = express.Router()

router.get('/', attachAuth, requireAuth, requirePermission('influencers', 'view'), influencersController.listInfluencers)
router.post('/', attachAuth, requireAuth, requireInfluencersWrite, influencersController.createInfluencer)
router.put('/', attachAuth, requireAuth, requireInfluencersWrite, influencersController.putInfluencers)
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
router.patch('/:id', attachAuth, requireAuth, requireInfluencersWrite, influencersController.updateInfluencer)
router.delete(
  '/:id',
  attachAuth,
  requireAuth,
  requireInfluencersWrite,
  influencersController.deleteInfluencer,
)

module.exports = router

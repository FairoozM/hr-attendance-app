const express = require('express')
const { requireAuth } = require('../middleware/auth')
const aiController = require('../controllers/aiController')
const { postLegacyFlexibleGenerate } = require('../controllers/amazonListingController')
const { amazonListingLimiter, aiDashboardLimiter } = require('../middleware/aiRateLimiter')

const router = express.Router()

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
}

router.get('/usage/summary', requireAuth, aiDashboardLimiter, wrap(aiController.getUsageSummary))
router.get('/usage/recent', requireAuth, aiDashboardLimiter, wrap(aiController.getRecentUsage))

router.post(
  '/amazon-listing/generate',
  requireAuth,
  amazonListingLimiter,
  postLegacyFlexibleGenerate
)

module.exports = router

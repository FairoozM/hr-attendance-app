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

/**
 * OpenAI connectivity check — `src/services/openaiService.testOpenAI()`.
 *
 * Default: requires Bearer JWT (same as other /api/ai routes).
 * Dev-only: set AI_TEST_OPENAI_PUBLIC=1 (never in production) to allow GET from the browser address bar
 * without Authorization — still rate-limited.
 *
 * Public mode is evaluated per request from `process.env` (not once when this file loads).
 *
 * Use API port 5001 by default (not 5000 — macOS AirPlay often claims :5000 and Chrome shows HTTP 403).
 */
function allowPublicTestOpenAI(req, res, next) {
  const pub =
    process.env.AI_TEST_OPENAI_PUBLIC === '1' && process.env.NODE_ENV !== 'production'
  if (pub) return next()
  return requireAuth(req, res, next)
}

router.get(
  '/test-openai',
  allowPublicTestOpenAI,
  aiDashboardLimiter,
  wrap(aiController.getTestOpenAI)
)

router.post(
  '/amazon-listing/generate',
  requireAuth,
  amazonListingLimiter,
  postLegacyFlexibleGenerate
)

module.exports = router

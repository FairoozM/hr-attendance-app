const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { postAmazonGenerateListing } = require('../controllers/amazonListingController')
const { amazonListingLimiter } = require('../middleware/aiRateLimiter')
const { validateAmazonGenerateListing } = require('../middleware/validateAiRequest')
const { checkAiBudget } = require('../middleware/checkAiBudget')

const router = express.Router()

router.post(
  '/generate-listing',
  requireAuth,
  amazonListingLimiter,
  validateAmazonGenerateListing,
  checkAiBudget,
  postAmazonGenerateListing
)

module.exports = router

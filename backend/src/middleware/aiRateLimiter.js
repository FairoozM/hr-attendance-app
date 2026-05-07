const rateLimit = require('express-rate-limit')

/** Stricter cap for generation endpoints (per IP + user session via default key). */
const amazonListingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_GENERATE_PER_MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many AI generation requests. Please wait and try again.' },
})

const aiDashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_DASHBOARD_PER_MIN || 120),
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = {
  amazonListingLimiter,
  aiDashboardLimiter,
}

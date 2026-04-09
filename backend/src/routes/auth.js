const express = require('express')
const authController = require('../controllers/authController')
const auth = require('../middleware/auth')

const router = express.Router()

// Login is POST-only; GET is common mistake from browsers/tools — return JSON, not 404
router.get('/login', (req, res) => {
  res
    .status(405)
    .setHeader('Allow', 'POST, OPTIONS')
    .json({
      error: 'Method not allowed',
      hint: 'Use POST /api/auth/login with Content-Type: application/json and body { "username", "password" }',
    })
})

router.post('/login', authController.login)
router.get('/me', auth.attachAuth, auth.requireAuth, authController.me)

module.exports = router

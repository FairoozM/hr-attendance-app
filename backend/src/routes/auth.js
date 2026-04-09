const express = require('express')
const authController = require('../controllers/authController')
const { attachAuth, requireAuth } = require('../middleware/auth')

const router = express.Router()

// POST /api/auth/login — returns { token, user }
router.post('/login', authController.login)

// GET /api/auth/login — friendly 405 so typos give a clear JSON error, never HTML
router.get('/login', (_req, res) => {
  res
    .status(405)
    .setHeader('Allow', 'POST, OPTIONS')
    .json({
      error: 'Method not allowed',
      hint: 'Use POST /api/auth/login with Content-Type: application/json and body { "username", "password" }',
    })
})

// GET /api/auth/me — returns { user } for the authenticated session
router.get('/me', attachAuth, requireAuth, authController.me)

module.exports = router

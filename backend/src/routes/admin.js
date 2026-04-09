const express = require('express')
const router = express.Router()
const adminController = require('../controllers/adminController')
const { requireAuth, requireAdmin } = require('../middleware/auth')

// GET /api/admin/users — list all users (no password hashes)
router.get('/users', requireAuth, requireAdmin, adminController.listUsers)

// POST /api/admin/users/:userId/reset-password — admin resets a specific user's password
router.post('/users/:userId/reset-password', requireAuth, requireAdmin, adminController.resetUserPassword)

module.exports = router

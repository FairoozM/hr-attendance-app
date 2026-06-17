const express = require('express')
const router = express.Router()
const adminController = require('../controllers/adminController')
const aiBudgetAdminController = require('../controllers/aiBudgetAdminController')
const { requireAuth, requireAdmin } = require('../middleware/auth')

// GET /api/admin/users — list all users (no password hashes)
router.get('/users', requireAuth, requireAdmin, adminController.listUsers)

// POST /api/admin/users/:userId/reset-password — admin resets a specific user's password
router.post('/users/:userId/reset-password', requireAuth, requireAdmin, adminController.resetUserPassword)

// GET /api/admin/users-permissions — list non-admin users with their permissions
router.get('/users-permissions', requireAuth, requireAdmin, adminController.listUsersWithPermissions)

// PUT /api/admin/users/:userId/permissions — update a user's module permissions
router.put('/users/:userId/permissions', requireAuth, requireAdmin, adminController.updateUserPermissions)

// GET /api/admin/users/:userId/attendance-assignments — get assigned employees for a user's attendance scope
router.get('/users/:userId/attendance-assignments', requireAuth, requireAdmin, adminController.getAttendanceAssignments)

// PUT /api/admin/users/:userId/attendance-assignments — set/replace assigned employees
router.put('/users/:userId/attendance-assignments', requireAuth, requireAdmin, adminController.setAttendanceAssignments)

// AI budget & safety controls (admin only — OpenAI key stays server-side only)
router.get('/ai/budget-settings', requireAuth, requireAdmin, aiBudgetAdminController.getBudgetSettingsHandler)
router.put('/ai/budget-settings', requireAuth, requireAdmin, aiBudgetAdminController.putBudgetSettingsHandler)

module.exports = router

const express = require('express')
const ctrl  = require('../controllers/annualLeaveController')
const auth  = require('../middleware/auth')

const router = express.Router()

// Dashboard stats (admin only)
router.get('/dashboard', auth.requireAuth, auth.requireAdmin, ctrl.dashboard)

// Standard CRUD
router.get('/',    auth.requireAuth, ctrl.list)
router.get('/alternate-options', auth.requireAuth, ctrl.listAlternateOptions)
router.get(
  '/:id/leave-request-letter',
  auth.requireAuth,
  ctrl.getLeaveRequestLetter
)
router.post(
  '/:id/leave-request-letter/regenerate',
  auth.requireAuth,
  auth.requireAdmin,
  ctrl.regenerateLeaveRequestLetter
)
router.get('/:id', auth.requireAuth, ctrl.getOne)
router.post('/',   auth.requireAuth, ctrl.create)
router.put('/:id', auth.requireAuth, ctrl.update)
router.delete('/:id', auth.requireAuth, ctrl.remove)

// Lifecycle actions (admin only)
router.post('/:id/confirm-return', auth.requireAuth, auth.requireAdmin, ctrl.confirmReturn)
router.post('/:id/extend',         auth.requireAuth, auth.requireAdmin, ctrl.extendLeave)
router.patch('/:id/remarks',       auth.requireAuth, auth.requireAdmin, ctrl.updateRemarks)

module.exports = router

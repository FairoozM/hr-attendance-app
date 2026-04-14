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

// Main shop visit workflow (paths must stay before generic `/:id` GET)
router.get('/:id/shop-visit', auth.requireAuth, ctrl.getShopVisit)
router.post('/:id/shop-visit/submit', auth.requireAuth, ctrl.submitShopVisit)
router.post('/:id/shop-visit/confirm', auth.requireAuth, auth.requireAdmin, ctrl.confirmShopVisit)
router.post('/:id/shop-visit/reschedule', auth.requireAuth, auth.requireAdmin, ctrl.rescheduleShopVisit)
router.post('/:id/shop-visit/complete', auth.requireAuth, auth.requireAdmin, ctrl.completeShopVisit)
router.post(
  '/:id/shop-visit/apply-calculator',
  auth.requireAuth,
  auth.requireAdmin,
  ctrl.applyShopVisitCalculator
)
router.patch(
  '/:id/shop-visit/admin-note',
  auth.requireAuth,
  auth.requireAdmin,
  ctrl.patchShopVisitAdminNote
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

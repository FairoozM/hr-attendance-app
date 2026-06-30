const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/subscriptionsController')

const router = express.Router()

router.get('/summary', auth.requireAuth, auth.requirePermission('subscriptions', 'view'), ctrl.summary)
router.get('/', auth.requireAuth, auth.requirePermission('subscriptions', 'view'), ctrl.list)
router.get('/:id', auth.requireAuth, auth.requirePermission('subscriptions', 'view'), ctrl.getOne)
router.post('/', auth.requireAuth, auth.requirePermission('subscriptions', 'add'), ctrl.create)
router.put('/:id', auth.requireAuth, auth.requirePermission('subscriptions', 'edit'), ctrl.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('subscriptions', 'delete'), ctrl.remove)

router.get('/:id/invoices', auth.requireAuth, auth.requirePermission('subscriptions', 'view'), ctrl.listInvoices)
router.post(
  '/:id/invoices',
  auth.requireAuth,
  auth.requirePermission('subscriptions', 'edit'),
  ctrl.uploadMiddleware,
  ctrl.uploadInvoice
)
router.get(
  '/:id/invoices/:invoiceId/download-url',
  auth.requireAuth,
  auth.requirePermission('subscriptions', 'view'),
  ctrl.downloadInvoice
)

router.post(
  '/:id/send-to-payment-group',
  auth.requireAuth,
  auth.requirePermission('subscriptions', 'edit'),
  ctrl.sendToPaymentGroup
)
router.post(
  '/:id/mark-paid',
  auth.requireAuth,
  auth.requirePermission('subscriptions', 'edit'),
  ctrl.markPaid
)
router.post(
  '/:id/renew',
  auth.requireAuth,
  auth.requirePermission('subscriptions', 'edit'),
  ctrl.renew
)

module.exports = router

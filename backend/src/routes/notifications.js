const express = require('express')
const ctrl = require('../controllers/notificationsController')
const auth = require('../middleware/auth')

const router = express.Router()

router.use(auth.requireAuth, auth.requireAdmin)

// Canonical read: items + counts in one round trip.
router.get('/inbox', ctrl.inbox)

// Actions on dynamic reminders take the key in the body, so keys never travel through the URL.
router.post('/mark-all-read', ctrl.markAllRead)
router.post('/mark-read', ctrl.markMany)
router.post('/snooze', ctrl.snooze)
router.post('/ignore', ctrl.ignoreNotification)
router.post('/resolve', ctrl.resolveNotification)
router.post('/restore', ctrl.reactivateNotification)

// Legacy shapes kept so an older cached bundle keeps working after deploy.
router.get('/', ctrl.list)
router.get('/unread-count', ctrl.unreadCount)
router.patch('/:id/read', ctrl.markRead)
router.post('/:key/snooze', ctrl.snooze)
router.post('/:key/ignore', ctrl.ignoreNotification)
router.post('/:key/resolve', ctrl.resolveNotification)

module.exports = router

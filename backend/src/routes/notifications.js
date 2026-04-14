const express = require('express')
const ctrl = require('../controllers/notificationsController')
const auth = require('../middleware/auth')

const router = express.Router()

router.get('/', auth.requireAuth, auth.requireAdmin, ctrl.list)
router.get('/unread-count', auth.requireAuth, auth.requireAdmin, ctrl.unreadCount)
router.patch('/:id/read', auth.requireAuth, auth.requireAdmin, ctrl.markRead)
router.post('/mark-all-read', auth.requireAuth, auth.requireAdmin, ctrl.markAllRead)

module.exports = router

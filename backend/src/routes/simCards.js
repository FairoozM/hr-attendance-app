const express = require('express')
const auth = require('../middleware/auth')
const simCardsController = require('../controllers/simCardsController')

const router = express.Router()

router.get('/', auth.requireAuth, auth.requirePermission('sim_cards', 'view'), simCardsController.list)
router.post('/', auth.requireAuth, auth.requirePermission('sim_cards', 'add'), simCardsController.create)
router.put('/:id', auth.requireAuth, auth.requirePermission('sim_cards', 'edit'), simCardsController.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('sim_cards', 'delete'), simCardsController.remove)

module.exports = router

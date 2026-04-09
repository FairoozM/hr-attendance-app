const express = require('express')
const annualLeaveController = require('../controllers/annualLeaveController')
const auth = require('../middleware/auth')

const router = express.Router()

router.get('/', auth.requireAuth, annualLeaveController.list)
router.get('/:id', auth.requireAuth, annualLeaveController.getOne)
router.post('/', auth.requireAuth, annualLeaveController.create)
router.put('/:id', auth.requireAuth, annualLeaveController.update)
router.delete('/:id', auth.requireAuth, annualLeaveController.remove)

module.exports = router

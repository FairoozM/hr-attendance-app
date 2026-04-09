const express = require('express')
const employeesController = require('../controllers/employeesController')
const auth = require('../middleware/auth')

const router = express.Router()

router.get('/me', auth.requireAuth, auth.requireEmployee, employeesController.me)
router.get('/', auth.requireAuth, auth.requireAdminOrWarehouse, employeesController.list)
router.post('/', auth.requireAuth, auth.requireAdmin, employeesController.create)
router.get('/:id', auth.requireAuth, employeesController.getOne)
router.put('/:id', auth.requireAuth, auth.requireAdmin, employeesController.update)
router.delete('/:id', auth.requireAuth, auth.requireAdmin, employeesController.remove)

module.exports = router

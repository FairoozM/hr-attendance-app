const express = require('express')
const employeesController = require('../controllers/employeesController')
const profileController = require('../controllers/profileController')
const auth = require('../middleware/auth')

const router = express.Router()

router.get('/me', auth.requireAuth, auth.requireEmployee, employeesController.me)
router.get('/', auth.requireAuth, auth.requirePermission('employees', 'view'), employeesController.list)
router.post('/', auth.requireAuth, auth.requirePermission('employees', 'edit'), employeesController.create)
// Admin full profile view (must be before /:id to not clash)
router.get('/:id/profile', auth.requireAuth, auth.requirePermission('employees', 'view'), profileController.getEmployeeProfile)
router.get('/:id', auth.requireAuth, employeesController.getOne)
router.put('/:id', auth.requireAuth, auth.requirePermission('employees', 'edit'), employeesController.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('employees', 'edit'), employeesController.remove)

module.exports = router

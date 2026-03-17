const express = require('express')
const employeesController = require('../controllers/employeesController')

const router = express.Router()

router.get('/', employeesController.list)
router.get('/:id', employeesController.getOne)
router.post('/', employeesController.create)
router.put('/:id', employeesController.update)
router.delete('/:id', employeesController.remove)

module.exports = router

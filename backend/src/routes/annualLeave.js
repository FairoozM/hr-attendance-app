const express = require('express')
const annualLeaveController = require('../controllers/annualLeaveController')

const router = express.Router()

router.get('/', annualLeaveController.list)
router.get('/:id', annualLeaveController.getOne)
router.post('/', annualLeaveController.create)
router.put('/:id', annualLeaveController.update)
router.delete('/:id', annualLeaveController.remove)

module.exports = router

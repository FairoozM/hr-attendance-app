const express = require('express')
const attendanceController = require('../controllers/attendanceController')

const router = express.Router()

router.get('/', attendanceController.list)
router.put('/', attendanceController.upsert)

module.exports = router

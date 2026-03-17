const express = require('express')
const healthController = require('../controllers/healthController')
const employeesRoutes = require('./employees')
const attendanceRoutes = require('./attendance')

const router = express.Router()

router.get('/health', healthController.getHealth)
router.use('/employees', employeesRoutes)
router.use('/attendance', attendanceRoutes)

module.exports = router

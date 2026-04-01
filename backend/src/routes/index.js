const express = require('express')
const healthController = require('../controllers/healthController')
const employeesRoutes = require('./employees')
const attendanceRoutes = require('./attendance')
const annualLeaveRoutes = require('./annualLeave')

const router = express.Router()

router.get('/health', healthController.getHealth)
router.use('/employees', employeesRoutes)
router.use('/attendance', attendanceRoutes)
router.use('/annual-leave', annualLeaveRoutes)

router.use((req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

module.exports = router

const express = require('express')
const healthController = require('../controllers/healthController')
const authMiddleware = require('../middleware/auth')
const authRoutes = require('./auth')
const employeesRoutes = require('./employees')
const attendanceRoutes = require('./attendance')
const annualLeaveRoutes = require('./annualLeave')

const router = express.Router()

// GET /api — API URL checks and monitoring
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'hr-api' })
})

// Public — no attachAuth
router.get('/health', healthController.getHealth)

// Auth mounted at /api/auth — POST /login, GET /login (405), GET /me (see routes/auth.js)
router.use('/auth', authRoutes)

// All routes below get optional Bearer auth
router.use(authMiddleware.attachAuth)
router.use('/employees', employeesRoutes)
router.use('/attendance', attendanceRoutes)
router.use('/annual-leave', annualLeaveRoutes)

// Unmatched /api/* must never fall through to a frontend; always JSON
router.use((req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

module.exports = router

const express = require('express')
const authController = require('../controllers/authController')
const auth = require('../middleware/auth')

const router = express.Router()

router.post('/login', authController.login)
router.get('/me', auth.attachAuth, auth.requireAuth, authController.me)

module.exports = router

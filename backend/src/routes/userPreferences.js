const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { getUserPreferences, putUserPreference } = require('../controllers/userPreferencesController')

const router = express.Router()

router.get('/', requireAuth, getUserPreferences)
router.put('/', requireAuth, putUserPreference)

module.exports = router

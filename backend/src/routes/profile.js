const express = require('express')
const router = express.Router()
const profileController = require('../controllers/profileController')
const { requireAuth, requireEmployee } = require('../middleware/auth')

// Employee self-service profile
router.get('/', requireAuth, requireEmployee, profileController.getMyProfile)
router.get('/alternate-options', requireAuth, requireEmployee, profileController.listAlternateEmployeeOptions)
router.put('/', requireAuth, requireEmployee, profileController.updateMyProfile)
router.post('/doc-upload-url', requireAuth, requireEmployee, profileController.requestDocUploadUrl)
router.post('/doc-confirm', requireAuth, requireEmployee, profileController.confirmDocUpload)
router.delete('/doc/:docType', requireAuth, requireEmployee, profileController.deleteDoc)

module.exports = router

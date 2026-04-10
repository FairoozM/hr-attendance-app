const express = require('express')
const attendanceController = require('../controllers/attendanceController')
const auth = require('../middleware/auth')

const router = express.Router()

const view = [auth.requireAuth, auth.requirePermission('attendance', 'view')]
const manage = [auth.requireAuth, auth.requirePermission('attendance', 'manage')]

router.get('/sick-leave-file', ...manage, attendanceController.serveSickLeaveFile)
router.post('/sick-leave-upload-url', ...manage, attendanceController.getSickLeaveUploadUrl)
router.post('/sick-leave-document', ...manage, attendanceController.uploadSickLeaveDocument)
router.delete('/sick-leave-document', ...manage, attendanceController.deleteSickLeaveDocument)
router.get('/', ...view, attendanceController.list)
router.put('/', ...manage, attendanceController.upsert)
router.delete('/', ...manage, attendanceController.remove)

module.exports = router

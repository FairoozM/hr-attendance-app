const express = require('express')
const attendanceController = require('../controllers/attendanceController')
const auth = require('../middleware/auth')

const router = express.Router()

const rw = [auth.requireAuth, auth.requireAdminOrWarehouse]

router.get('/sick-leave-file', ...rw, attendanceController.serveSickLeaveFile)
router.post('/sick-leave-upload-url', ...rw, attendanceController.getSickLeaveUploadUrl)
router.post('/sick-leave-document', ...rw, attendanceController.uploadSickLeaveDocument)
router.delete('/sick-leave-document', ...rw, attendanceController.deleteSickLeaveDocument)
router.get('/', ...rw, attendanceController.list)
router.put('/', ...rw, attendanceController.upsert)
router.delete('/', ...rw, attendanceController.remove)

module.exports = router

const express = require('express')
const attendanceController = require('../controllers/attendanceController')

const router = express.Router()

router.get('/sick-leave-file', attendanceController.serveSickLeaveFile)
router.post('/sick-leave-upload-url', attendanceController.getSickLeaveUploadUrl)
router.post('/sick-leave-document', attendanceController.uploadSickLeaveDocument)
router.delete('/sick-leave-document', attendanceController.deleteSickLeaveDocument)
router.get('/', attendanceController.list)
router.put('/', attendanceController.upsert)
router.delete('/', attendanceController.remove)

module.exports = router

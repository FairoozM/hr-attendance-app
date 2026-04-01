const express = require('express')
const attendanceController = require('../controllers/attendanceController')
const { upload } = require('../middleware/sickLeaveUpload')

const router = express.Router()

router.get('/files/:filename', attendanceController.serveSickLeaveFile)
router.post(
  '/sick-leave-document',
  upload.single('file'),
  attendanceController.uploadSickLeaveDocument
)
router.delete('/sick-leave-document', attendanceController.deleteSickLeaveDocument)
router.get('/', attendanceController.list)
router.put('/', attendanceController.upsert)
router.delete('/', attendanceController.remove)

module.exports = router

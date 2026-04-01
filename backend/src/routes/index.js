const express = require('express')
const healthController = require('../controllers/healthController')
const employeesRoutes = require('./employees')
const attendanceRoutes = require('./attendance')
const attendanceController = require('../controllers/attendanceController')
const { upload } = require('../middleware/sickLeaveUpload')

const router = express.Router()

router.get('/health', healthController.getHealth)
router.use('/employees', employeesRoutes)
/** Shorter alias — same handlers as /attendance/sick-leave-document (avoids long path / CDN edge quirks). */
router.post('/sick-leave-document', upload.single('file'), attendanceController.uploadSickLeaveDocument)
router.delete('/sick-leave-document', attendanceController.deleteSickLeaveDocument)
router.use('/attendance', attendanceRoutes)

router.use((req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

module.exports = router

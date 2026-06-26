const express = require('express')
const multer = require('multer')
const { requireAuth } = require('../middleware/auth')
const ctrl = require('../controllers/amazonKsaRtoLabelingController')

const router = express.Router({ mergeParams: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

router.use(requireAuth)

router.get('/batches', ctrl.getBatches)
router.get('/batches/:id', ctrl.getBatch)
router.post('/batches', ctrl.postBatch)
router.put('/batches/:id', ctrl.putBatch)
router.delete('/batches/:id', ctrl.deleteBatch)
router.post('/batches/:id/files', upload.single('file'), ctrl.postFile)
router.post('/batches/:batchId/rows/:rowId/files', upload.single('file'), ctrl.postRowFile)
router.delete('/files/:fileId', ctrl.deleteFile)
router.delete('/row-files/:fileId', ctrl.deleteRowFile)
router.post('/parse', upload.single('file'), ctrl.postParse)

module.exports = router

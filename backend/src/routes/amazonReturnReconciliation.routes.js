const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonReturnReconciliationController')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
})

const labelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

const adminRouter = express.Router()
adminRouter.use(requireAuth, requireAdmin)

adminRouter.post('/upload', upload.single('file'), ctrl.uploadBatch)
adminRouter.get('/batches', ctrl.listBatches)
adminRouter.get('/batches/:batchId/export', ctrl.exportBatch)
adminRouter.get('/batches/:batchId', ctrl.getBatch)
adminRouter.patch('/combined-skus/:combinedSkuId', ctrl.updateCombinedSku)
adminRouter.post('/combined-skus/:combinedSkuId/label', labelUpload.single('file'), ctrl.uploadLabel)
adminRouter.delete('/labels/:labelId', ctrl.deleteLabel)
adminRouter.post('/batches/:batchId/regenerate-link', ctrl.regenerateLink)

const publicRouter = express.Router()
publicRouter.get('/:publicToken', ctrl.getPublicReport)
publicRouter.patch('/:publicToken/combined-skus/:combinedSkuId/processing', ctrl.updatePublicCombinedSku)
publicRouter.get('/:publicToken/labels/:labelId/download', ctrl.downloadPublicLabel)
publicRouter.get('/:publicToken/export', ctrl.exportPublicBatch)

module.exports = { adminRouter, publicRouter }

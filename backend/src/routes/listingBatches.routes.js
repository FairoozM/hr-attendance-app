const express = require('express')
const multer = require('multer')
const { requireAuth } = require('../middleware/auth')
const ctrl = require('../controllers/listingBatchController')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.AMAZON_FLAT_FILE_UPLOAD_LIMIT_BYTES || 25 * 1024 * 1024) },
})

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
}

router.get('/default-profiles', requireAuth, wrap(ctrl.getDefaultProfiles))
router.post('/default-profiles', requireAuth, wrap(ctrl.postDefaultProfile))
router.patch('/default-profiles/:id', requireAuth, wrap(ctrl.patchDefaultProfile))

router.post('/batches/upload', requireAuth, upload.single('file'), wrap(ctrl.uploadBatch))
router.get('/batches', requireAuth, wrap(ctrl.getBatches))
router.get('/batches/:batchId', requireAuth, wrap(ctrl.getBatchDetail))
router.post('/batches/:batchId/apply-defaults', requireAuth, wrap(ctrl.postApplyDefaults))
router.post('/batches/:batchId/validate', requireAuth, wrap(ctrl.postValidate))
router.post('/batches/:batchId/generate', requireAuth, wrap(ctrl.postGenerate))
router.get('/batches/:batchId/generate/status', requireAuth, wrap(ctrl.getGenerationStatus))
router.post('/batches/:batchId/generate/cancel', requireAuth, wrap(ctrl.postCancelGeneration))
router.post('/batches/:batchId/rows/:rowId/generate', requireAuth, wrap(ctrl.postGenerateRow))
router.patch('/batches/:batchId/rows/:rowId', requireAuth, wrap(ctrl.patchRow))
router.post('/batches/:batchId/rows/bulk-action', requireAuth, wrap(ctrl.postBulkAction))
router.post('/batches/:batchId/export', requireAuth, wrap(ctrl.postExport))

module.exports = router

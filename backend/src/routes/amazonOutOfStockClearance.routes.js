const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonOutOfStockClearanceController')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const router = express.Router({ mergeParams: true })

router.use(requireAuth, requireAdmin)

router.get('/out-of-stock', ctrl.getOutOfStock)
router.post('/zoho-stock', ctrl.postZohoStock)
router.post('/vigil-preview', upload.single('file'), ctrl.postVigilPreview)
router.post('/calculate', ctrl.postCalculate)
router.post('/export', ctrl.postExport)
router.post('/update-amazon', ctrl.postUpdateAmazon)

module.exports = router

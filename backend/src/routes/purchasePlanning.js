const express = require('express')
const multer = require('multer')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/purchasePlanningController')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

router.use(auth.requireAuth, auth.requireAdmin)

router.get('/low-stock', ctrl.listLowStock)
router.get('/low-stock/enrichment-status', ctrl.getLowStockEnrichmentStatus)
router.delete('/low-stock/:id', ctrl.deleteLowStockItem)
router.post('/low-stock-upload', upload.single('file'), ctrl.uploadLowStockSkus)
router.post('/low-stock/refresh-zoho', ctrl.refreshLowStockZoho)

router.post('/vigil-upload', upload.single('file'), ctrl.uploadVigilCsv)
router.get('/vigil-uploads', ctrl.listVigilUploads)

router.post('/generate-plan', ctrl.generatePlan)
router.get('/plans', ctrl.listPlans)
router.get('/plans/:id', ctrl.getPlan)
router.post('/plans/:id/refresh-zoho-data', ctrl.refreshDraftPlanZohoData)
router.delete('/plans/:id', ctrl.deletePlan)
router.put('/plans/:id/items/:itemId', ctrl.updatePlanItem)
router.post('/plans/:id/create-zoho-po', ctrl.createZohoPo)

module.exports = router

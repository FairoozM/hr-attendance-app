const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/tabbyClearingController')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

router.use(requireAuth, requireAdmin)

router.get('/batches', ctrl.listBatches)
router.post('/upload', upload.single('file'), ctrl.upload)
router.get('/batches/:id/preview', ctrl.getPreview)
router.post('/batches/:id/post', ctrl.post)
router.get('/batches/:id/post-job', ctrl.getPostJob)
router.get('/batches/:id/activity', ctrl.getActivity)
router.post('/batches/:id/bank-match', ctrl.postBankMatch)
router.get('/accounts', ctrl.getAccounts)
router.put('/accounts/:role', ctrl.putAccount)
router.delete('/accounts/:role', ctrl.deleteAccount)

module.exports = router

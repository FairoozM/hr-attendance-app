'use strict'

const express = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/posSettlementController.ts')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.use(requireAuth, requireAdmin)

router.get('/settlements', ctrl.listSettlements)
router.post('/upload', upload.single('file'), ctrl.upload)
router.get('/settlements/:id/preview', ctrl.getPreview)
router.post('/settlements/:id/approve', ctrl.approve)
router.delete('/settlements/:id/approval', ctrl.deleteApproval)
router.post('/settlements/:id/post', ctrl.post)
router.get('/settlements/:id/post-job', ctrl.getPostJob)
router.get('/settlements/:id/activity', ctrl.getActivity)
router.post('/settlements/:id/bank-link', ctrl.postBankLink)
router.delete('/settlements/:id/bank-link', ctrl.deleteBankLink)
router.post('/transactions/:id/dismiss-conflict', ctrl.dismissConflict)
router.get('/transactions/:id/manual-mappings', ctrl.getManualMappings)
router.post('/transactions/:id/manual-mapping', ctrl.postManualMapping)
router.delete('/manual-mappings/:id', ctrl.deleteManualMapping)
router.get('/invoices/search', ctrl.searchInvoices)
router.get('/terminals', ctrl.getTerminals)
router.post('/terminals', ctrl.postTerminal)
router.delete('/terminals/:id', ctrl.deleteTerminal)
router.get('/accounts', ctrl.getAccounts)
router.put('/accounts/:role', ctrl.putAccount)
router.delete('/accounts/:role', ctrl.deleteAccount)

module.exports = router

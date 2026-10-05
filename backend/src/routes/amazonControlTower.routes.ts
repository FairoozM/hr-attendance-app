'use strict'

const express = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const ctrl = require('../controllers/amazonControlTowerController.ts')

const router = express.Router()

router.use(requireAuth, requireAdmin)

router.post('/:marketplace/refresh', ctrl.startRefresh)
router.post('/:marketplace/backfill', ctrl.startBackfill)
router.get('/:marketplace/runs', ctrl.listRuns)
router.get('/:marketplace/runs/:id', ctrl.getRun)
router.get('/:marketplace/freshness', ctrl.getFreshness)
router.get('/:marketplace/command-center', ctrl.getCommandCenter)
router.get('/:marketplace/sku-master', ctrl.listSkuMaster)
router.post('/:marketplace/sku-master/:id/confirm', ctrl.confirmSku)
router.put('/:marketplace/sku-master/:id/mapping', ctrl.changeSkuMapping)
router.post('/:marketplace/sku-master/:id/unmap', ctrl.unmapSku)
router.put('/:marketplace/sku-master/:id/parameters', ctrl.updateSkuParameters)
router.get('/:marketplace/zoho-items', ctrl.searchZohoItems)
router.get('/:marketplace/settings', ctrl.getSettings)
router.put('/:marketplace/settings', ctrl.updateSettings)

module.exports = router

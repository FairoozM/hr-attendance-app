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
router.get('/:marketplace/capacity', ctrl.getCapacity)
router.get('/:marketplace/capacity/periods', ctrl.listCapacityPeriods)
router.post('/:marketplace/capacity/periods', ctrl.createCapacityPeriod)
router.put('/:marketplace/capacity/periods/:id', ctrl.reviseCapacityPeriod)
router.post('/:marketplace/capacity/periods/:id/verify', ctrl.verifyCapacityPeriod)
router.get('/:marketplace/capacity-release', ctrl.getCapacityRelease)
router.get('/:marketplace/inventory-health', ctrl.getInventoryHealth)
router.get('/:marketplace/inventory-health/inactive-with-stock', ctrl.getInactiveWithStock)
router.get('/:marketplace/removal-orders', ctrl.getRemovalOrders)
router.get('/:marketplace/actions', ctrl.getActions)

module.exports = router

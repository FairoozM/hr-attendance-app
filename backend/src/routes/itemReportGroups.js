const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/itemReportGroupsController')

const router = express.Router()

// All routes are admin-only — these mappings drive every weekly report,
// so writes must be tightly controlled.
router.use(auth.requireAuth, auth.requireAdmin)

router.get('/groups', ctrl.listGroupKeys)
router.get('/',       ctrl.list)
router.post('/import/dry-run', ctrl.bulkImportDryRun)
router.post('/import',         ctrl.bulkImport)
router.get('/import/log',      ctrl.listImportLog)
router.get('/:id',    ctrl.getOne)
router.post('/',      ctrl.create)
router.put('/:id',    ctrl.update)
router.patch('/:id/active', ctrl.setActive)
router.delete('/:id', ctrl.remove)

module.exports = router

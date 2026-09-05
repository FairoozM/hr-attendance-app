const express = require('express')
const auth = require('../middleware/auth')
const vatInfoController = require('../controllers/vatInfoController')

const router = express.Router()

router.get('/', auth.requireAuth, auth.requirePermission('vat_info', 'view'), vatInfoController.list)
router.post('/', auth.requireAuth, auth.requirePermission('vat_info', 'add'), vatInfoController.create)
router.put('/:id', auth.requireAuth, auth.requirePermission('vat_info', 'edit'), vatInfoController.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('vat_info', 'delete'), vatInfoController.remove)

module.exports = router

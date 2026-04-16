const express = require('express')
const auth = require('../middleware/auth')
const ctrl = require('../controllers/documentExpiryController')

const router = express.Router()

router.get('/',     auth.requireAuth, auth.requirePermission('document_expiry', 'view'),   ctrl.list)
router.post('/',    auth.requireAuth, auth.requirePermission('document_expiry', 'add'),    ctrl.create)
router.put('/:id',  auth.requireAuth, auth.requirePermission('document_expiry', 'edit'),   ctrl.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('document_expiry', 'delete'), ctrl.remove)

module.exports = router

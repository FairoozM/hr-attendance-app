const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/annualLeaveSalaryController')
const { requireAuth, requireAdmin } = require('../middleware/auth')

router.get('/',      requireAuth, requireAdmin, ctrl.list)
router.get('/:id',   requireAuth, requireAdmin, ctrl.getOne)
router.post('/',     requireAuth, requireAdmin, ctrl.create)
router.put('/:id',   requireAuth, requireAdmin, ctrl.update)
router.delete('/:id',requireAuth, requireAdmin, ctrl.remove)

module.exports = router

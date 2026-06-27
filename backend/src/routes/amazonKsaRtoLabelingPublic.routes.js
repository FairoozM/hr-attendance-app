const express = require('express')
const ctrl = require('../controllers/amazonKsaRtoLabelingController')

const router = express.Router({ mergeParams: true })

router.get('/:shareToken', ctrl.getPublicBatch)
router.post('/:shareToken/rows/:rowId/status', ctrl.postPublicRowStatus)
router.post('/:shareToken/complete', ctrl.postPublicComplete)

module.exports = router

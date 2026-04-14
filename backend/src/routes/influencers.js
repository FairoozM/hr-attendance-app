const express = require('express')
const { attachAuth, requireAuth, requirePermission, requireInfluencersWrite } = require('../middleware/auth')
const influencersController = require('../controllers/influencersController')

const router = express.Router()

router.get('/', attachAuth, requireAuth, requirePermission('influencers', 'view'), influencersController.listInfluencers)
router.put('/', attachAuth, requireAuth, requireInfluencersWrite, influencersController.putInfluencers)

module.exports = router

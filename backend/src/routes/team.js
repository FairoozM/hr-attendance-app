/**
 * Team routes — mounted at /api/team in app.js
 *
 * GET /api/team/members
 *   Returns team members with planner access (for assignee pickers, etc.)
 *   Auth: any logged-in user (no admin required — readers need assignee data)
 */

const express = require('express')
const auth    = require('../middleware/auth')
const teamController = require('../controllers/teamController')

const router = express.Router()

// All team routes require a valid session
router.use(auth.requireAuth)

router.get('/members', teamController.listMembers)

module.exports = router

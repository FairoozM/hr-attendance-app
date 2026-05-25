/**
 * integrations.js — Express router for third-party integration webhooks.
 *
 * IMPORTANT: This router is mounted in app.js BEFORE express.json() so that
 * the GitHub webhook route can capture the raw body Buffer needed for HMAC
 * signature verification.  Routes here must handle their own body parsing.
 *
 * Not protected by authMiddleware — GitHub calls these routes directly.
 */
'use strict'

const express    = require('express')
const controller = require('../controllers/githubWebhookController')

const router = express.Router()

// ── GitHub webhook ────────────────────────────────────────────────────────────

/**
 * POST /api/integrations/github/webhook
 *
 * Receives GitHub pull_request events.
 * express.raw() ensures req.body is a Buffer for HMAC verification.
 */
router.post(
  '/github/webhook',
  express.raw({ type: 'application/json' }),
  controller.handleWebhook
)

/**
 * GET /api/integrations/github/webhook
 * Friendly 405 for browser/curl GET probes.
 */
router.get('/github/webhook', (_req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'GitHub webhook endpoint only accepts POST requests.',
  })
})

module.exports = router

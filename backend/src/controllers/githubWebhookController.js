/**
 * githubWebhookController.js
 *
 * Handles POST /api/integrations/github/webhook
 *
 * Note: the route is mounted with express.raw({ type: 'application/json' })
 * so req.body is a Buffer (raw bytes), not a parsed object.
 * This is required to correctly verify GitHub's HMAC SHA-256 signature.
 */
'use strict'

const {
  verifySignature,
  processPullRequestEvent,
  getWebhookSecret,
} = require('../services/githubWebhookService')

async function handleWebhook(req, res) {
  // ── 1. Reject if secret is not configured ────────────────────────────────
  if (!getWebhookSecret()) {
    return res.status(503).json({
      success: false,
      message: 'GITHUB_WEBHOOK_SECRET is not configured. Webhook requests will not be processed.',
    })
  }

  // ── 2. Signature verification ─────────────────────────────────────────────
  const rawBody  = req.body          // Buffer from express.raw()
  const sigHeader = req.headers['x-hub-signature-256']

  try {
    verifySignature(rawBody, sigHeader)
  } catch (err) {
    const status = err.code === 'WEBHOOK_SIGNATURE_INVALID' ||
                   err.code === 'WEBHOOK_SIGNATURE_MISSING'  ? 401 : 503
    return res.status(status).json({ success: false, message: err.message })
  }

  // ── 3. Parse body (safe: signature is already verified) ───────────────────
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return res.status(400).json({ success: false, message: 'Webhook body is not valid JSON.' })
  }

  // ── 4. Only handle pull_request events ───────────────────────────────────
  const event  = req.headers['x-github-event']
  const action = payload.action

  if (event !== 'pull_request') {
    // Acknowledge other events silently — GitHub requires 2xx
    return res.json({ success: true, message: `Event "${event}" acknowledged (not processed).` })
  }

  // ── 5. Process ────────────────────────────────────────────────────────────
  try {
    const { matched, skipped } = await processPullRequestEvent(action, payload)
    return res.json({
      success: true,
      matched,
      ...(skipped ? { skipped } : {}),
    })
  } catch (err) {
    console.error('[github webhook] processing error:', err.message)
    return res.status(500).json({ success: false, message: 'Internal error processing webhook.' })
  }
}

module.exports = { handleWebhook }

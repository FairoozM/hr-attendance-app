'use strict'

const stripeConfig = require('../config/stripe')
const { constructEvent, recordEvent } = require('../services/stripeWebhookService')

async function handleWebhook(req, res) {
  if (!stripeConfig.getWebhookSecret()) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' })
  }

  let event
  try {
    event = constructEvent(req.body, req.headers['stripe-signature'])
  } catch (err) {
    const status = err.code === 'STRIPE_WEBHOOK_NOT_CONFIGURED' ? 503 : 400
    return res.status(status).json({ error: stripeConfig.redact(err.message) })
  }

  try {
    const { duplicate, summary } = await recordEvent(event)
    console.log('[stripe] event stored', summary.id, summary.type, duplicate ? 'duplicate' : 'new')
    return res.json({ received: true, duplicate })
  } catch (err) {
    console.error('[stripe] webhook persist failed:', stripeConfig.redact(err.message))
    return res.status(500).json({ error: 'Could not store Stripe event.' })
  }
}

module.exports = { handleWebhook }

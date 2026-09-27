'use strict'

/**
 * Server-side switch for Zoho posting. A test-mode Stripe key must never clear a
 * live Zoho invoice, and this app has no isolated Zoho test organisation, so
 * posting requires STRIPE_MODE=live with a live key plus an explicit opt-in.
 */

const defaultStripeConfig = require('../../config/stripe')

/**
 * @param {{ postingEnabled: boolean }} config
 * @param {typeof defaultStripeConfig} [stripeConfig]
 * @returns {{ allowed: boolean, reasons: Array<{ code: string, message: string }> }}
 */
function postingGate(config, stripeConfig = defaultStripeConfig) {
  const reasons = []
  if (!config.postingEnabled) {
    reasons.push({
      code: 'STRIPE_CLEARING_POSTING_DISABLED',
      message: 'Zoho posting is switched off on this server (STRIPE_CLEARING_POSTING_ENABLED).',
    })
  }
  const secretKey = stripeConfig.getSecretKey()
  if (!secretKey) {
    reasons.push({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe is not configured, so payments cannot be verified.' })
  } else if (stripeConfig.getMode() !== 'live' || stripeConfig.keyMode(secretKey) !== 'live') {
    reasons.push({
      code: 'STRIPE_NOT_LIVE',
      message: 'Clearing live Zoho invoices requires STRIPE_MODE=live and a live Stripe key.',
    })
  }
  return { allowed: reasons.length === 0, reasons }
}

module.exports = { postingGate }

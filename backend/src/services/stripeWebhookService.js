'use strict'

const stripeConfig = require('../config/stripe')
const { query } = require('../db')

function summarizeEvent(event) {
  const obj = event && event.data && event.data.object && typeof event.data.object === 'object'
    ? event.data.object
    : null
  return {
    id: event && event.id ? String(event.id) : null,
    type: event && event.type ? String(event.type) : null,
    created: event && Number.isFinite(event.created) ? event.created : null,
    livemode: event && event.livemode === true,
    apiVersion: event && event.api_version ? String(event.api_version) : null,
    objectId: obj && typeof obj.id === 'string' ? obj.id : null,
    objectType: obj && typeof obj.object === 'string' ? obj.object : null,
  }
}

function constructEvent(rawBody, signatureHeader) {
  const secret = stripeConfig.getWebhookSecret()
  if (!secret) {
    const err = new Error('Stripe webhook is not configured.')
    err.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED'
    throw err
  }
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
    const err = new Error('Stripe webhook body must be the raw request bytes.')
    err.code = 'STRIPE_WEBHOOK_BODY_INVALID'
    throw err
  }
  if (!signatureHeader) {
    const err = new Error('Stripe webhook signature is missing.')
    err.code = 'STRIPE_WEBHOOK_SIGNATURE_INVALID'
    throw err
  }

  const Stripe = require('stripe')
  const verifier = stripeConfig.getStripeClient() || new Stripe('sk_test_webhook_verify_only')
  try {
    return verifier.webhooks.constructEvent(rawBody, signatureHeader, secret)
  } catch (err) {
    const wrapped = new Error('Stripe webhook signature is invalid.')
    wrapped.code = 'STRIPE_WEBHOOK_SIGNATURE_INVALID'
    wrapped.cause = err
    throw wrapped
  }
}

/**
 * Persist an allowlisted summary. A repeated Stripe event id is a no-op.
 * @param {object} event
 * @param {Function} [queryFn]
 */
async function recordEvent(event, queryFn = query) {
  const summary = summarizeEvent(event)
  if (!summary.id || !summary.type) {
    const err = new Error('Stripe event is missing an id or type.')
    err.code = 'STRIPE_EVENT_INVALID'
    throw err
  }

  const result = await queryFn(
    `INSERT INTO stripe_events (event_id, event_type, livemode, api_version, payload_summary)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      summary.id,
      summary.type,
      summary.livemode,
      summary.apiVersion,
      JSON.stringify(summary),
    ],
  )

  return {
    duplicate: (result.rowCount || 0) === 0,
    summary,
  }
}

module.exports = {
  summarizeEvent,
  constructEvent,
  recordEvent,
}

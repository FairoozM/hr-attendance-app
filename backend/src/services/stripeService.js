'use strict'

const stripeConfig = require('../config/stripe')
const { query } = require('../db')

function safeStripeError(err) {
  const type = err && (err.type || err.code)
  if (type === 'StripeAuthenticationError' || err.statusCode === 401) {
    return 'Stripe rejected the API key.'
  }
  return stripeConfig.redact(err && err.message ? err.message : 'Stripe request failed.')
}

async function loadRecentEvents() {
  try {
    const result = await query(
      `SELECT event_id, event_type, livemode, received_at, payload_summary
       FROM stripe_events
       ORDER BY received_at DESC
       LIMIT 8`,
    )
    return (result.rows || []).map((row) => {
      const summary = row.payload_summary && typeof row.payload_summary === 'object'
        ? row.payload_summary
        : {}
      return {
        eventId: row.event_id,
        type: row.event_type,
        livemode: row.livemode === true,
        receivedAt: row.received_at,
        objectId: summary.objectId || null,
        objectType: summary.objectType || null,
      }
    })
  } catch (err) {
    console.error('[stripe] recent events unavailable:', stripeConfig.redact(err.message))
    return []
  }
}

async function getConnectionStatus() {
  const status = stripeConfig.publicStatus()
  const recentEvents = await loadRecentEvents()
  return {
    ...status,
    lastEventAt: recentEvents[0] ? recentEvents[0].receivedAt : null,
    lastEventType: recentEvents[0] ? recentEvents[0].type : null,
    recentEvents,
  }
}

async function testConnection() {
  const status = stripeConfig.publicStatus()
  if (!status.secretKeyConfigured) {
    const err = new Error('Stripe secret key is not configured.')
    err.status = 503
    throw err
  }
  if (!status.mode) {
    const err = new Error('Set STRIPE_MODE to test or live before connecting.')
    err.status = 400
    throw err
  }
  if (status.modeMismatch || status.keyMode !== status.mode) {
    const err = new Error('STRIPE_MODE does not match the secret key.')
    err.status = 400
    throw err
  }

  const client = stripeConfig.getStripeClient()
  try {
    const account = await client.accounts.retrieve()
    return {
      ok: true,
      mode: status.mode,
      accountId: account && account.id ? account.id : null,
      chargesEnabled: account && account.charges_enabled === true,
      payoutsEnabled: account && account.payouts_enabled === true,
    }
  } catch (err) {
    const safe = new Error(safeStripeError(err))
    safe.status = err && err.statusCode === 401 ? 401 : 502
    throw safe
  }
}

module.exports = {
  getConnectionStatus,
  testConnection,
  safeStripeError,
}

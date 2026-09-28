'use strict'

const stripeConfig = require('../config/stripe')
const stripeService = require('../services/stripeService')

async function status(_req, res) {
  try {
    const body = await stripeService.getConnectionStatus()
    return res.json(body)
  } catch (err) {
    console.error('[stripe] status failed:', stripeConfig.redact(err.message))
    return res.status(500).json({ error: 'Could not read Stripe status.' })
  }
}

async function testConnection(_req, res) {
  try {
    const body = await stripeService.testConnection()
    return res.json(body)
  } catch (err) {
    const statusCode = err.status || 502
    return res.status(statusCode).json({ error: stripeConfig.redact(err.message || 'Stripe connection failed.') })
  }
}

async function clearingDryRun(req, res) {
  try {
    const { runStripeClearingDryRun } = require('../services/stripeClearing/stripeClearingDryRunService')
    const body = await runStripeClearingDryRun({
      from: req.query.from,
      to: req.query.to,
      source: req.query.source,
      limit: req.query.limit,
    })
    return res.json(body)
  } catch (err) {
    const statusCode = err.status || 502
    if (statusCode >= 500) console.error('[stripe] clearing dry run failed:', stripeConfig.redact(err.message))
    return res.status(statusCode).json({
      error: stripeConfig.redact(err.message || 'Stripe clearing dry run failed.'),
      code: err.code || undefined,
    })
  }
}

function clearingError(res, err, label) {
  const statusCode = err.status || 502
  if (statusCode >= 500) console.error(`[stripe] ${label} failed:`, err.code || '', stripeConfig.redact(err.message))
  return res.status(statusCode).json({
    error: stripeConfig.redact(err.message || `Stripe ${label} failed.`),
    code: err.code || undefined,
    matchStatus: err.matchStatus || undefined,
    reasons: err.reasons || undefined,
    groupStatus: err.groupStatus || undefined,
    zohoRecordId: err.zohoRecordId || undefined,
    zohoPaymentId: err.zohoPaymentId || undefined,
    refundStatus: err.refundStatus || undefined,
    clearing: err.clearing || undefined,
  })
}

function clearingActor(req) {
  return req.user && req.user.userId ? `user:${req.user.userId}` : null
}

async function clearingRecord(req, res) {
  try {
    const { getStripeClearing } = require('../services/stripeClearing/stripeClearingPostingService')
    return res.json(await getStripeClearing(req.params.paymentIntentId))
  } catch (err) {
    return clearingError(res, err, 'clearing record')
  }
}

async function clearingPreview(req, res) {
  try {
    const { previewStripeClearing } = require('../services/stripeClearing/stripeClearingPostingService')
    return res.json(await previewStripeClearing(req.params.paymentIntentId))
  } catch (err) {
    return clearingError(res, err, 'clearing preview')
  }
}

// Gross-per-PaymentIntent posting is retired; Stripe money is cleared per payout.
function clearingPostRetired(_req, res) {
  return res.status(410).json({
    error: 'Per-payment Stripe posting is retired. Stripe payments are cleared per payout (Payout Clearing Preview).',
    code: 'GROSS_CLEARING_RETIRED',
  })
}

async function confirmCustomerAdvance(req, res) {
  try {
    const { confirmCustomerAdvance: confirm } = require('../services/stripeClearing/stripePayoutClearingService')
    const body = await confirm(req.params.payoutId, req.body && req.body.chargeId, {
      reason: req.body && req.body.reason,
      actor: clearingActor(req),
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'customer advance confirmation')
  }
}

async function clearingReversedExternally(req, res) {
  try {
    const { markGrossClearingReversedExternally } = require('../services/stripeClearing/stripePayoutClearingService')
    const body = await markGrossClearingReversedExternally(req.params.paymentIntentId, {
      zohoPaymentId: req.body && req.body.zohoPaymentId,
      actor: clearingActor(req),
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'clearing reversal record')
  }
}

async function payoutPostCustomerGroup(req, res) {
  try {
    const { postPayoutCustomerGroup } = require('../services/stripeClearing/stripePayoutPostingService')
    const body = await postPayoutCustomerGroup(req.params.payoutId, req.params.customerKey, {
      fingerprint: req.body && req.body.fingerprint,
      actor: clearingActor(req),
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'payout group posting')
  }
}

async function payoutPostFeeJournal(req, res) {
  try {
    const { postPayoutFeeJournal } = require('../services/stripeClearing/stripePayoutPostingService')
    const body = await postPayoutFeeJournal(req.params.payoutId, {
      fingerprint: req.body && req.body.fingerprint,
      actor: clearingActor(req),
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'payout fee journal posting')
  }
}

async function payoutPostRefund(req, res) {
  try {
    const { postPayoutRefund } = require('../services/stripeClearing/stripePayoutPostingService')
    const body = await postPayoutRefund(req.params.payoutId, req.params.refundId, {
      fingerprint: req.body && req.body.fingerprint,
      actor: clearingActor(req),
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'payout refund posting')
  }
}

async function payoutRecheckUncertain(req, res) {
  try {
    const { recheckUncertainComponent } = require('../services/stripeClearing/stripePayoutPostingService')
    const body = await recheckUncertainComponent(req.params.payoutId, req.params.scope, req.params.componentId, { actor: clearingActor(req) })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'uncertain component recheck')
  }
}

async function payoutConfirmUncertainNotCreated(req, res) {
  try {
    const { confirmUncertainNotCreated } = require('../services/stripeClearing/stripePayoutPostingService')
    const body = await confirmUncertainNotCreated(req.params.payoutId, req.params.scope, req.params.componentId, {
      actor: clearingActor(req),
      reason: req.body && req.body.reason,
      acknowledged: Boolean(req.body && req.body.acknowledged === true),
      verification: req.body && req.body.verification,
    })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'uncertain component confirmation')
  }
}

async function payoutList(req, res) {
  try {
    const { listPayoutSummaries } = require('../services/stripeClearing/stripePayoutPreviewService')
    return res.json(await listPayoutSummaries({ limit: req.query.limit }))
  } catch (err) {
    return clearingError(res, err, 'payout list')
  }
}

async function payoutPreview(req, res) {
  try {
    const { previewPayout } = require('../services/stripeClearing/stripePayoutPreviewService')
    return res.json(await previewPayout(req.params.payoutId))
  } catch (err) {
    return clearingError(res, err, 'payout preview')
  }
}

module.exports = {
  status,
  testConnection,
  clearingDryRun,
  clearingRecord,
  clearingPreview,
  clearingPostRetired,
  clearingReversedExternally,
  payoutList,
  payoutPreview,
  payoutPostCustomerGroup,
  payoutPostFeeJournal,
  payoutPostRefund,
  payoutRecheckUncertain,
  payoutConfirmUncertainNotCreated,
  confirmCustomerAdvance,
}

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
    zohoPaymentId: err.zohoPaymentId || undefined,
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

async function clearingPost(req, res) {
  try {
    const { postStripeClearing } = require('../services/stripeClearing/stripeClearingPostingService')
    const body = await postStripeClearing(req.params.paymentIntentId, { actor: clearingActor(req) })
    return res.json(body)
  } catch (err) {
    return clearingError(res, err, 'clearing post')
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
  clearingPost,
  payoutList,
  payoutPreview,
}

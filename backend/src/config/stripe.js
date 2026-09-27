'use strict'

/**
 * Backend-only Stripe configuration.
 * Missing keys mean "not configured". They must not crash the process
 * and must never be logged or returned to the client.
 */

const SECRET_PATTERNS = [
  /sk_(?:test|live)_[A-Za-z0-9]+/g,
  /rk_(?:test|live)_[A-Za-z0-9]+/g,
  /pk_(?:test|live)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
]

const WEBHOOK_PATH = '/api/integrations/stripe/webhook'

function redact(value) {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, (match) => {
      if (match.startsWith('whsec_')) return 'whsec_[redacted]'
      const kind = match.split('_').slice(0, 2).join('_')
      return `${kind}_[redacted]`
    }),
    String(value ?? ''),
  )
}

function trimEnv(name) {
  const raw = process.env[name]
  if (raw == null) return ''
  return String(raw).trim()
}

function keyMode(key) {
  if (!key) return null
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test'
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live'
  return null
}

function getMode() {
  const mode = trimEnv('STRIPE_MODE').toLowerCase()
  if (mode === 'test' || mode === 'live') return mode
  return null
}

function getSecretKey() {
  return trimEnv('STRIPE_SECRET_KEY')
}

function getWebhookSecret() {
  return trimEnv('STRIPE_WEBHOOK_SECRET')
}

function modeMismatch() {
  const mode = getMode()
  const fromKey = keyMode(getSecretKey())
  return Boolean(mode && fromKey && mode !== fromKey)
}

function publicStatus() {
  const secretKey = getSecretKey()
  const webhookSecret = getWebhookSecret()
  const mode = getMode()
  const fromKey = keyMode(secretKey)
  const mismatch = modeMismatch()
  const secretKeyConfigured = secretKey.length > 0
  const webhookSecretConfigured = webhookSecret.length > 0
  const ready = secretKeyConfigured
    && webhookSecretConfigured
    && mode != null
    && fromKey === mode
    && !mismatch

  return {
    ready,
    secretKeyConfigured,
    webhookSecretConfigured,
    mode,
    keyMode: fromKey,
    modeMismatch: mismatch,
    webhookPath: WEBHOOK_PATH,
  }
}

let cachedClient = null
let cachedKey = ''

function getStripeClient() {
  const key = getSecretKey()
  if (!key) return null
  if (cachedClient && cachedKey === key) return cachedClient
  const Stripe = require('stripe')
  const apiVersion = trimEnv('STRIPE_API_VERSION')
  const options = {}
  if (apiVersion) options.apiVersion = apiVersion
  cachedClient = new Stripe(key, options)
  cachedKey = key
  return cachedClient
}

function resetStripeClientForTests() {
  cachedClient = null
  cachedKey = ''
}

module.exports = {
  WEBHOOK_PATH,
  redact,
  keyMode,
  getMode,
  getSecretKey,
  getWebhookSecret,
  modeMismatch,
  publicStatus,
  getStripeClient,
  resetStripeClientForTests,
}

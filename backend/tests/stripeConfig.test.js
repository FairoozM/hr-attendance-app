const test = require('node:test')
const assert = require('node:assert/strict')
const stripeConfig = require('../src/config/stripe')

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MODE', 'STRIPE_API_VERSION']

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] == null) delete process.env[key]
    else process.env[key] = saved[key]
  }
  stripeConfig.resetStripeClientForTests()
}

test('redact strips secret keys and webhook secrets from error text', () => {
  const text = stripeConfig.redact(
    'rejected sk_live_abc123DEF and rk_test_secret99 plus whsec_webhookSecret and pk_test_public',
  )
  assert.equal(text.includes('abc123DEF'), false)
  assert.equal(text.includes('secret99'), false)
  assert.equal(text.includes('webhookSecret'), false)
  assert.equal(text.includes('pk_test_public'), false)
  assert.match(text, /sk_live_\[redacted\]/)
  assert.match(text, /whsec_\[redacted\]/)
})

test('status stays not-ready and never echoes the secret key', () => {
  const saved = snapshotEnv()
  try {
    process.env.STRIPE_MODE = 'live'
    process.env.STRIPE_SECRET_KEY = 'sk_test_supersecretvalue'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_supersecretvalue'
    stripeConfig.resetStripeClientForTests()
    const status = stripeConfig.publicStatus()
    assert.equal(status.ready, false)
    assert.equal(status.modeMismatch, true)
    assert.equal(status.mode, 'live')
    assert.equal(status.keyMode, 'test')
    const serialized = JSON.stringify(status)
    assert.equal(serialized.includes('supersecretvalue'), false)
    assert.equal(serialized.includes('sk_test_'), false)
    assert.equal(serialized.includes('whsec_'), false)
  } finally {
    restoreEnv(saved)
  }
})

test('ready only when mode matches the key and the webhook secret is set', () => {
  const saved = snapshotEnv()
  try {
    process.env.STRIPE_MODE = 'test'
    process.env.STRIPE_SECRET_KEY = 'sk_test_examplekey'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example'
    stripeConfig.resetStripeClientForTests()
    const status = stripeConfig.publicStatus()
    assert.equal(status.ready, true)
    assert.equal(status.mode, 'test')
    assert.equal(status.webhookPath, '/api/integrations/stripe/webhook')
  } finally {
    restoreEnv(saved)
  }
})

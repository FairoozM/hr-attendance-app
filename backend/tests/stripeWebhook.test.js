const test = require('node:test')
const assert = require('node:assert/strict')
const Stripe = require('stripe')
const stripeConfig = require('../src/config/stripe')
const { constructEvent, recordEvent, summarizeEvent } = require('../src/services/stripeWebhookService')

const SECRET = 'whsec_unit_test_secret'

function sampleEvent() {
  return {
    id: 'evt_unit_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    livemode: false,
    api_version: '2024-06-20',
    created: 1_700_000_000,
    data: {
      object: {
        id: 'pi_unit_1',
        object: 'payment_intent',
        client_secret: 'pi_unit_1_secret_should_not_be_stored',
        amount: 2500,
      },
    },
  }
}

test('summarizeEvent keeps only allowlisted fields', () => {
  const summary = summarizeEvent(sampleEvent())
  assert.deepEqual(summary, {
    id: 'evt_unit_1',
    type: 'payment_intent.succeeded',
    created: 1_700_000_000,
    livemode: false,
    apiVersion: '2024-06-20',
    objectId: 'pi_unit_1',
    objectType: 'payment_intent',
  })
  assert.equal(JSON.stringify(summary).includes('secret_should_not'), false)
  assert.equal(JSON.stringify(summary).includes('2500'), false)
})

test('constructEvent accepts a valid signature and rejects a bad one', () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET
  const savedKey = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_WEBHOOK_SECRET = SECRET
  delete process.env.STRIPE_SECRET_KEY
  stripeConfig.resetStripeClientForTests()
  try {
    const payload = JSON.stringify(sampleEvent())
    const stripe = new Stripe('sk_test_webhook_verify_only')
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })
    const event = constructEvent(Buffer.from(payload), header)
    assert.equal(event.id, 'evt_unit_1')
    assert.equal(event.data.object.client_secret.includes('secret_should_not'), true)

    assert.throws(
      () => constructEvent(Buffer.from(payload), 't=1,v1=deadbeef'),
      (err) => err.code === 'STRIPE_WEBHOOK_SIGNATURE_INVALID' && !String(err.message).includes(SECRET),
    )
  } finally {
    if (saved == null) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = saved
    if (savedKey == null) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = savedKey
    stripeConfig.resetStripeClientForTests()
  }
})

test('recordEvent is idempotent and stores the summary only', async () => {
  const calls = []
  const fakeQuery = async (_sql, params) => {
    calls.push(params)
    return calls.length === 1
      ? { rowCount: 1, rows: [{ event_id: 'evt_unit_1' }] }
      : { rowCount: 0, rows: [] }
  }

  const first = await recordEvent(sampleEvent(), fakeQuery)
  const second = await recordEvent(sampleEvent(), fakeQuery)
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(calls[0][0], 'evt_unit_1')
  const stored = JSON.parse(calls[0][4])
  assert.equal(stored.objectId, 'pi_unit_1')
  assert.equal(JSON.stringify(stored).includes('secret_should_not'), false)
  assert.equal(Object.hasOwn(stored, 'client_secret'), false)
})

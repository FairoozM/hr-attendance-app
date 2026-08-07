const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

function setupServiceMock() {
  const calls = []
  const restoreDb = mockModule('../src/db', {
    query: async (text, params) => {
      calls.push({ text, params })
      if (/FROM influencer_contract_payments WHERE contract_id/.test(text)) {
        return { rows: [], rowCount: 0 }
      }
      if (/INSERT INTO influencer_contract_payments/.test(text)) {
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    ensureInfluencerContractPaymentsTable: async () => {},
  })
  const svc = freshRequire('../src/services/influencerContractPaymentsService')
  return { svc, calls, restore: restoreDb }
}

test('influencerContractPaymentsService upserts payment row', async () => {
  const { svc, calls, restore } = setupServiceMock()

  const result = await svc.upsertContractPayment({
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    amountPaid: 250,
    paymentStatus: 'Partially Paid',
    dueDate: '2026-05-15',
    paymentDate: null,
    invoiceReference: 'INV-100',
    notes: 'First tranche',
  }, 8)

  assert.equal(result, null)
  assert.ok(calls.some((call) => /INSERT INTO influencer_contract_payments/.test(call.text)))
  restore()
})

test('influencerContractPaymentsService rejects missing ids', async () => {
  const { svc, restore } = setupServiceMock()

  await assert.rejects(
    () => svc.upsertContractPayment({ contractId: '', influencerId: 'inf-1' }, 8),
    /contractId and influencerId are required/,
  )
  restore()
})

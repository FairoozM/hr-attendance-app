const path = require('path')

// Stub the Postgres pool before any service loads it, so the real advisory-lock
// helper can be exercised without a database.
const heldLocks = new Set()
const dbPath = require.resolve(path.join(__dirname, '../src/db/index.js'))
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [], rowCount: 0 }),
    pool: {
      async connect() {
        let mine = null
        return {
          async query(sql, params = []) {
            if (/pg_try_advisory_xact_lock/.test(sql)) {
              const key = params.join(':')
              if (heldLocks.has(key)) return { rows: [{ locked: false }] }
              heldLocks.add(key)
              mine = key
              return { rows: [{ locked: true }] }
            }
            if (/^(COMMIT|ROLLBACK)$/.test(sql) && mine) {
              heldLocks.delete(mine)
              mine = null
            }
            return { rows: [] }
          },
          release() {},
        }
      },
    },
  },
}

const test = require('node:test')
const assert = require('node:assert/strict')

const { createFakeZoho, createFakePostingStore, KSA_TEST_ENV, timeoutError } = require('./helpers/amazonClearingFakeZoho')
const { postApprovedBatch, postReturnFeeJournalsForBatch, isReturnFeePostComplete } = require('../src/services/amazonPaymentClearingPostingService')
const { buildPaymentPreviewFromBatch } = require('../src/services/amazonPaymentClearingPaymentPreviewService')
const {
  resolveMarketplaceClearingAccounts,
  assertPostingAccountsReady,
  requireMarketplaceCode,
} = require('../src/services/amazonPaymentClearingAccountGuard')
const { applyCreditNotesForBatch, buildRefundCreditNoteRequest } = require('../src/services/amazonPaymentClearingCreditNotePostingService')
const { runSafeWrite } = require('../src/services/amazonPaymentClearingSafeWrite')
const { isAmbiguousWriteError, lookupCustomerPayment } = require('../src/services/amazonPaymentClearingZohoRecovery')
const { buildPostingStatus, linkPosting, releasePosting, reverifyPosting } = require('../src/services/amazonPaymentClearingPostingRecoveryService')
const { feeJournalIdentity, isSalesOrFeeJournalPosting } = require('../src/services/amazonPaymentClearingPostingIdentity')
const { resolveConfiguredDepositAccount } = require('../src/services/amazonPaymentClearingZohoPaymentService')
const store = require('../src/services/amazonPaymentClearingStore')

const UAE_IDS = Object.freeze({
  UNDEPOSITED: '4265011000000781161',
  COMMISSION: '4265011000002206949',
  SHIPPING_FBA: '4265011000002230152',
})
const PROD_LIKE_KSA_ENV = Object.freeze({
  AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID: '4265011000012454617',
  AMAZON_KSA_ZOHO_COMMISSION_ACCOUNT_ID: '4265011000012454621',
  AMAZON_KSA_ZOHO_SHIPPING_FBA_ACCOUNT_ID: '4265011000012454625',
})
const KSA_IDS = new Set(Object.values(PROD_LIKE_KSA_ENV))

function order(i, customer = 'cust1') {
  return {
    orderId: `171-${i}`,
    zohoInvoiceId: `zinv${i}`,
    zohoInvoiceNumber: `INV-${i}`,
    zohoCustomerId: customer,
    zohoInvoiceTotal: 100,
    principalTotal: 100,
    commissionTotal: -10,
    fulfillmentFeeTotal: -5,
    closingFeeTotal: 0,
    shippingCollectedTotal: 0,
    shippingPromotionTotal: 0,
    otherAmazonFeeTotal: 0,
  }
}

function batchFor(marketplace, overrides = {}) {
  return {
    batchId: marketplace === 'UAE' ? 40 : 90,
    marketplace,
    status: 'approved',
    zohoCustomerName: marketplace === 'UAE' ? 'Amazon' : 'KSA-Amazon',
    report: {
      settlementStartDate: '2026-09-03',
      settlementEndDate: '2026-09-17',
      currency: marketplace === 'UAE' ? 'AED' : 'SAR',
    },
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [order(1), order(2)],
    ...overrides,
  }
}

function feeLine(normalizedFeeType, rawTransactionType, description, amount, debitId = `debit-${normalizedFeeType}`, creditId = 'credit-undeposited') {
  return {
    key: `X|${normalizedFeeType}|${rawTransactionType}|${description}`,
    feeType: normalizedFeeType,
    normalizedFeeType,
    rawTransactionType,
    description,
    rowCount: 1,
    totalAmount: -amount,
    rowNumbers: [1],
    mappingStatus: 'mapped',
    journalPreview: {
      referenceNumber: `03-Sep-2026 to 17-Sep-2026 ${normalizedFeeType}`,
      notes: 'Transferring payment to Expenses accounts',
      debit: { accountId: debitId, accountName: 'Expense', amount },
      credit: { accountId: creditId, accountName: 'Undeposited', amount },
    },
  }
}

function storeFor(batch, existing = []) {
  return createFakePostingStore({
    existing,
    batch,
    previewFor: (batchId) => ({ paymentPreviewId: 1, batchId, ...buildPaymentPreviewFromBatch(batch) }),
  })
}

async function balances(ids) {
  return new Map(ids.map((id) => [id, { invoice_id: id, balance: 100000 }]))
}

function run(batch, postingStore, zoho, extra = {}) {
  return postApprovedBatch({
    batch,
    store: postingStore,
    dryRun: false,
    postedBy: 1,
    env: batch.marketplace === 'UAE' ? PROD_LIKE_KSA_ENV : KSA_TEST_ENV,
    zohoLookup: zoho.lookup,
    fetchInvoicesByIds: balances,
    createPayment: zoho.createPayment(),
    createManualJournal: zoho.createManualJournal(),
    buildPayloadPreview: async (p) => ({ account_id: p.depositToAccountId }),
    buildJournalPayloadPreview: async (j) => ({ reference_number: j.referenceNumber }),
    ...extra,
  })
}

// 1. Marketplace account selection

test('UAE resolves only UAE clearing accounts even when KSA accounts are configured', () => {
  const resolved = resolveMarketplaceClearingAccounts('UAE', { env: PROD_LIKE_KSA_ENV })
  assert.deepEqual(resolved.problems, [])
  assert.equal(resolved.accounts.UNDEPOSITED.accountId, UAE_IDS.UNDEPOSITED)
  assert.equal(resolved.accounts.COMMISSION.accountId, UAE_IDS.COMMISSION)
  assert.equal(resolved.accounts.SHIPPING_FBA.accountId, UAE_IDS.SHIPPING_FBA)
  assert.equal(resolved.accounts.UNDEPOSITED.accountCode, '1016')
  const ksa = resolveMarketplaceClearingAccounts('KSA', { env: PROD_LIKE_KSA_ENV })
  assert.equal(ksa.accounts.UNDEPOSITED.accountId, PROD_LIKE_KSA_ENV.AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID)
})

test('UAE sales payments are posted to the UAE accounts, never KSA', async () => {
  const batch = batchFor('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const result = await run(batch, storeFor(batch), zoho)
  assert.equal(result.success, true)
  const accounts = [...zoho.payments.values()].map((p) => p.account_id).sort()
  assert.deepEqual(accounts, [UAE_IDS.UNDEPOSITED, UAE_IDS.COMMISSION, UAE_IDS.SHIPPING_FBA].sort())
  assert.ok(accounts.every((id) => !KSA_IDS.has(id)))
})

test('strict deposit resolution for a UAE payment ignores KSA codes and cached lookups', async () => {
  await assert.rejects(
    () => resolveConfiguredDepositAccount({ depositToAccountCode: '1024' }, { marketplace: 'UAE', strictMarketplace: true, env: PROD_LIKE_KSA_ENV }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID'
  )
  const ok = await resolveConfiguredDepositAccount(
    { depositToAccountCode: '1021' },
    { marketplace: 'UAE', strictMarketplace: true, env: PROD_LIKE_KSA_ENV }
  )
  assert.equal(ok.accountId, UAE_IDS.COMMISSION)
})

test('UAE credit-note refunds use the UAE undeposited funds account', async () => {
  const batch = batchFor('UAE')
  const request = await buildRefundCreditNoteRequest({ orderId: 'o-1', creditNoteAmount: 25 }, batch, {
    env: PROD_LIKE_KSA_ENV,
    paymentDate: '2026-09-30',
  })
  assert.equal(request.refundAccountId, UAE_IDS.UNDEPOSITED)
  assert.equal(request.zohoRefundRequest.from_account_id, UAE_IDS.UNDEPOSITED)
})

test('posting requires an explicit marketplace and never defaults to KSA', async () => {
  assert.throws(() => requireMarketplaceCode(undefined), (err) => err.code === 'AMAZON_PAYMENT_CLEARING_MARKETPLACE_REQUIRED')
  const batch = batchFor('UAE', { marketplace: undefined })
  const zoho = createFakeZoho()
  await assert.rejects(() => run(batch, storeFor(batch), zoho), (err) => err.code === 'AMAZON_PAYMENT_CLEARING_MARKETPLACE_REQUIRED')
  assert.equal(zoho.calls.createPayment, 0)
})

// 2. Missing or conflicting configuration blocks before any write

test('missing KSA account configuration blocks posting before the first Zoho write', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const env = { ...KSA_TEST_ENV }
  delete env.AMAZON_KSA_ZOHO_COMMISSION_ACCOUNT_ID
  await assert.rejects(
    () => run(batch, postingStore, zoho, { env }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID' && /Nothing was posted/.test(err.message)
  )
  assert.equal(zoho.calls.createPayment, 0)
  assert.equal(zoho.calls.createJournal, 0)
  assert.equal(postingStore.postings.length, 0)
})

test('UAE env pointing at a KSA account is rejected as a conflict before any write', async () => {
  const env = { ...PROD_LIKE_KSA_ENV, AMAZON_UAE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID: PROD_LIKE_KSA_ENV.AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID }
  assert.throws(
    () => assertPostingAccountsReady({ marketplace: 'UAE', env }),
    (err) => err.problems.some((p) => p.kind === 'conflict' && p.role === 'UNDEPOSITED')
  )
  const batch = batchFor('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  await assert.rejects(() => run(batch, storeFor(batch), zoho, { env }), /conflicting account ids/)
  assert.equal(zoho.calls.createPayment, 0)
})

test('a UAE fee journal mapped to a KSA account blocks posting before any write', async () => {
  const batch = batchFor('UAE', {
    nonOrderLinkedAmazonFeeMappings: [
      feeLine('ADVERTISING', 'ServiceFee', 'Cost of Advertising', 50, 'debit-ad', PROD_LIKE_KSA_ENV.AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID),
    ],
  })
  const zoho = createFakeZoho({ currency: 'AED' })
  await assert.rejects(() => run(batch, storeFor(batch), zoho), (err) => err.problems.some((p) => p.kind === 'cross_marketplace'))
  assert.equal(zoho.calls.createPayment + zoho.calls.createJournal, 0)
})

test('invoice balance lookup failures stop posting instead of being ignored', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await assert.rejects(
    () =>
      run(batch, postingStore, zoho, {
        fetchInvoicesByIds: async () => {
          throw timeoutError()
        },
      }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_INVOICE_BALANCE_UNAVAILABLE'
  )
  assert.equal(zoho.calls.createPayment, 0)
  assert.equal(postingStore.postings.length, 0)
})

// 3. Timeouts and ambiguous responses

test('Zoho creates the payment but the request times out: the entry is recovered, not re-sent', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const metas = []
  const result = await run(batch, postingStore, zoho, {
    createPayment: zoho.createPayment({ timeoutAfterCreate: true, onCall: (_r, meta) => metas.push(meta) }),
  })
  assert.equal(zoho.calls.createPayment, 3)
  assert.equal(zoho.payments.size, 3)
  assert.equal(result.success, true)
  assert.ok(postingStore.postings.every((row) => row.status === 'posted' && zoho.payments.has(row.zohoPaymentId)))
  assert.ok(metas.every((meta) => meta.retryTransport === false && meta.strictMarketplace === true && meta.marketplace === 'KSA'))

  const again = await run(batch, postingStore, zoho, { allowPosted: true, batch: { ...batch, status: 'posted' } })
  assert.equal(zoho.calls.createPayment, 3)
  assert.equal(again.summary.paymentsSkipped, 3)
})

test('timeout with nothing found in Zoho is saved as verification required and blocks reposting', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const first = await run(batch, postingStore, zoho, { createPayment: zoho.createPayment({ timeoutBeforeCreate: true }) })
  assert.equal(first.success, false)
  assert.equal(first.status, 'verification_required')
  assert.equal(first.summary.verificationRequired, 3)
  assert.equal(postingStore.markedPosted, 0)
  assert.ok(postingStore.postings.every((row) => row.status === 'verification_required'))

  const second = await run(batch, postingStore, zoho)
  assert.equal(zoho.calls.createPayment, 3, 'no automatic repost after an uncertain outcome')
  assert.equal(second.status, 'verification_required')
})

test('ambiguous-error classification treats only proven rejections as definitive', () => {
  assert.equal(isAmbiguousWriteError(timeoutError()), true)
  assert.equal(isAmbiguousWriteError(Object.assign(new Error('x'), { code: 'ZOHO_API_NETWORK_ERROR' })), true)
  assert.equal(isAmbiguousWriteError(Object.assign(new Error('HTTP 503'), { code: 'ZOHO_API_ERROR', httpStatus: 503 })), true)
  assert.equal(isAmbiguousWriteError(Object.assign(new Error('Zoho API HTTP 400: {"code":1000}'), { code: 'ZOHO_API_ERROR', httpStatus: 400 })), true)
  assert.equal(isAmbiguousWriteError(Object.assign(new Error('bad'), { code: 'ZOHO_API_ERROR', httpStatus: 400 })), false)
  assert.equal(isAmbiguousWriteError(Object.assign(new Error('limit'), { code: 'ZOHO_DAILY_LIMIT' })), false)
  assert.equal(isAmbiguousWriteError(new Error('unexpected')), true)
})

// 4. Recovery lookups: exact, conflicting, multiple

test('pre-flight finds one exact existing payment: it is not re-posted and can be linked', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const seed = storeFor(batch)
  await run(batch, seed, zoho)
  const netId = seed.postings.find((row) => row.paymentType === 'net_balance').zohoPaymentId

  const fresh = storeFor(batch)
  const creates = zoho.calls.createPayment
  const result = await run(batch, fresh, zoho)
  assert.equal(zoho.calls.createPayment, creates, 'no duplicates when Zoho already has the payments')
  assert.equal(result.summary.verificationRequired, 3)
  const net = fresh.postings.find((row) => row.paymentType === 'net_balance')
  assert.equal(net.status, 'verification_required')
  assert.equal(net.mappingSnapshot.verification.outcome, 'exact')

  const linked = await linkPosting({
    batch,
    store: fresh,
    postingId: net.id,
    zohoId: netId,
    reason: 'checked in Zoho',
    zohoLookup: zoho.lookup,
    env: KSA_TEST_ENV,
  })
  assert.equal(linked.posting.status, 'posted')
  assert.equal(linked.posting.zohoPaymentId, netId)
})

test('a related Zoho payment on the wrong account is a conflict, never accepted', async () => {
  const batch = batchFor('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const dry = await run(batch, storeFor(batch), createFakeZoho({ currency: 'AED' }), { dryRun: true })
  const net = dry.payments.find((row) => row.paymentType === 'net_balance')
  zoho.payments.set(
    'zp-ksa',
    zoho.paymentFromRequest({ ...net.zohoPaymentRequest, depositToAccountId: PROD_LIKE_KSA_ENV.AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID }, 'zp-ksa')
  )
  const postingStore = storeFor(batch)
  const result = await run(batch, postingStore, zoho)
  const row = result.payments.find((p) => p.paymentType === 'net_balance')
  assert.equal(row.status, 'verification_required')
  assert.equal(row.verification.outcome, 'conflict')
  assert.ok(row.verification.candidates[0].diffs.some((d) => d.field === 'account'))
  assert.equal([...zoho.payments.values()].filter((p) => p.reference_number === net.referenceNumber).length, 1)

  await assert.rejects(
    () => linkPosting({ batch, store: postingStore, postingId: postingStore.postings.find((p) => p.paymentType === 'net_balance').id, zohoId: 'zp-ksa', reason: 'x', zohoLookup: zoho.lookup, env: PROD_LIKE_KSA_ENV }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_LINK_MISMATCH'
  )
})

test('multiple matching Zoho records are flagged as possible duplicates', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const dry = await run(batch, storeFor(batch), createFakeZoho(), { dryRun: true })
  const net = dry.payments.find((row) => row.paymentType === 'net_balance')
  const request = { ...net.zohoPaymentRequest, depositToAccountId: 'acct-1024' }
  zoho.payments.set('dup-1', zoho.paymentFromRequest(request, 'dup-1'))
  zoho.payments.set('dup-2', zoho.paymentFromRequest(request, 'dup-2'))
  const lookup = await lookupCustomerPayment(
    {
      customerId: 'cust1',
      referenceNumber: net.referenceNumber,
      date: null,
      amount: net.amount,
      accountId: 'acct-1024',
      currencyCode: 'SAR',
      invoices: net.invoiceAllocations.map((a) => ({ invoiceId: a.invoiceId, amountApplied: a.amountApplied })),
    },
    zoho.lookup
  )
  assert.equal(lookup.outcome, 'multiple')

  const result = await run(batch, storeFor(batch), zoho)
  assert.equal(result.payments.find((p) => p.paymentType === 'net_balance').verification.outcome, 'multiple')
})

test('timeout followed by two matching records stays verification required', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const result = await run(batch, postingStore, zoho, {
    createPayment: async (request) => {
      zoho.payments.set('t-1', zoho.paymentFromRequest(request, 't-1'))
      zoho.payments.set('t-2', zoho.paymentFromRequest(request, 't-2'))
      throw timeoutError()
    },
    fetchInvoicesByIds: balances,
    batch: { ...batch, matchedOrders: [order(1)] },
  })
  assert.equal(result.payments[0].status, 'verification_required')
  assert.equal(postingStore.postings[0].status, 'verification_required')
})

// 5. Partial completion survives restart and resumes without duplication

test('definitive failure is persisted and a later run posts only the missing entry', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const rejectShipping = zoho.createPayment()
  const first = await run(batch, postingStore, zoho, {
    createPayment: async (request, meta) => {
      if (request.depositToAccountCode === '1028') {
        throw Object.assign(new Error('Zoho API HTTP 400: invalid account'), { code: 'ZOHO_API_ERROR', httpStatus: 400 })
      }
      return rejectShipping(request, meta)
    },
  })
  assert.equal(first.status, 'partially_posted')
  assert.equal(postingStore.markedPosted, 0)
  assert.equal(postingStore.postings.find((row) => row.paymentType === 'shipping_fba').status, 'failed')

  const restartedZoho = { ...zoho, lookup: { ...zoho.lookup } }
  const second = await run(batch, postingStore, restartedZoho)
  assert.equal(second.success, true)
  assert.equal(second.summary.paymentsCreated, 1)
  assert.equal(second.summary.paymentsSkipped, 2)
  assert.equal(zoho.payments.size, 3)
  assert.equal(postingStore.markedPosted, 1)
})

test('a crash between send and save leaves a pending row that is recovered without reposting', async () => {
  const batch = batchFor('KSA', { matchedOrders: [order(1)] })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await assert.rejects(
    () =>
      run(batch, postingStore, zoho, {
        createPayment: async (request) => {
          zoho.payments.set('crash-1', zoho.paymentFromRequest(request, 'crash-1'))
          throw new Error('process killed')
        },
        store: {
          ...postingStore,
          updatePostingOutcome: async () => {
            throw new Error('process killed before saving the outcome')
          },
        },
      })
  )
  const pending = postingStore.postings.find((row) => row.paymentType === 'net_balance')
  assert.equal(pending.status, 'pending')
  assert.equal(pending.mappingSnapshot.attempted, true)

  const creates = zoho.calls.createPayment
  const resumed = await run(batch, postingStore, zoho)
  assert.equal(zoho.calls.createPayment, creates + 2, 'only the two never-attempted payments are sent')
  assert.equal(postingStore.postings.find((row) => row.paymentType === 'net_balance').zohoPaymentId, 'crash-1')
  assert.equal(resumed.success, true)
})

test('posting status shows partial progress and explains blocked steps', async () => {
  const batch = batchFor('KSA', {
    matchedReturns: [{ orderId: 'r-1', amazonRefundAmount: 20, zohoInvoiceId: 'zr1', creditNoteAction: 'ready_to_create', status: 'ready_to_create' }],
  })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho, { createPayment: zoho.createPayment({ timeoutBeforeCreate: true }) })
  const status = await buildPostingStatus({ batch, store: postingStore, env: KSA_TEST_ENV })
  assert.equal(status.overall, 'verification_required')
  assert.equal(status.salesComplete, false)
  assert.equal(status.settlementComplete, false)
  const sales = status.groups.find((g) => g.key === 'sales_payment')
  assert.equal(sales.status, 'verification_required')
  assert.ok(sales.entries.every((e) => e.actions.some((a) => a.action === 'reverify')))
  assert.ok(sales.entries.every((e) => e.actions.some((a) => a.action === 'release')))
  assert.ok(status.blockers.some((b) => b.step === 'credit_note' && /sales payment/.test(b.message)))
  assert.equal(status.groups.find((g) => g.key === 'credit_note').entries[0].status, 'not_started')
})

test('release re-checks Zoho and only then allows a retry', async () => {
  const batch = batchFor('KSA', { matchedOrders: [order(1)] })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho, { createPayment: zoho.createPayment({ timeoutBeforeCreate: true }) })
  const uncertain = postingStore.postings.filter((row) => row.status === 'verification_required')
  assert.equal(uncertain.length, 3)
  for (const row of uncertain) {
    const released = await releasePosting({ batch, store: postingStore, postingId: row.id, reason: 'confirmed absent in Zoho', zohoLookup: zoho.lookup, env: KSA_TEST_ENV })
    assert.equal(released.posting.status, 'failed')
  }
  const again = await run(batch, postingStore, zoho)
  assert.equal(again.success, true)
  assert.equal(zoho.payments.size, 3)

  const net = postingStore.postings.find((row) => row.paymentType === 'net_balance')
  const reverified = await reverifyPosting({ batch, store: postingStore, postingId: net.id, zohoLookup: zoho.lookup, env: KSA_TEST_ENV })
  assert.equal(reverified.posting.status, 'posted')
  await assert.rejects(
    () => releasePosting({ batch, store: postingStore, postingId: net.id, reason: 'x', zohoLookup: zoho.lookup, env: KSA_TEST_ENV }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_POSTING_NOT_UNCERTAIN'
  )
})

test('release is refused while Zoho still has a related record', async () => {
  const batch = batchFor('KSA', { matchedOrders: [order(1)] })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho, {
    createPayment: async (request) => {
      zoho.payments.set(`late-${request.depositToAccountCode}`, zoho.paymentFromRequest({ ...request, amount: request.amount + 1 }, `late-${request.depositToAccountCode}`))
      throw timeoutError()
    },
  })
  const net = postingStore.postings.find((row) => row.paymentType === 'net_balance')
  assert.equal(net.status, 'verification_required')
  await assert.rejects(
    () => releasePosting({ batch, store: postingStore, postingId: net.id, reason: 'x', zohoLookup: zoho.lookup, env: KSA_TEST_ENV }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_RELEASE_BLOCKED'
  )
})

// 6. Concurrency

test('concurrent posting requests for the same batch cannot both run', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const first = store.withBatchPostingLock(40, async () => {
    await gate
    return 'first'
  })
  await assert.rejects(
    () => store.withBatchPostingLock(40, async () => 'second'),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_POSTING_IN_PROGRESS' && err.status === 409
  )
  const other = await store.withBatchPostingLock(41, async () => 'other batch')
  assert.equal(other, 'other batch')
  release()
  assert.equal(await first, 'first')
  assert.equal(await store.withBatchPostingLock(40, async () => 'after'), 'after')
})

test('an overlapping run sees the in-flight write-ahead row and does not post again', async () => {
  const batch = batchFor('KSA', { matchedOrders: [order(1)] })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const slow = zoho.createPayment()
  const firstRun = run(batch, postingStore, zoho, {
    createPayment: async (request, meta) => {
      await gate
      return slow(request, meta)
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setTimeout(resolve, 5))
  const secondRun = await run(batch, postingStore, zoho)
  release()
  await firstRun
  const netRefs = [...zoho.payments.values()].filter((p) => /Net Undeposited/.test(p.reference_number))
  assert.equal(netRefs.length, 1, 'exactly one net balance payment in Zoho')
  assert.notEqual(secondRun.payments.find((p) => p.paymentType === 'net_balance').status, 'created')
})

// 7. Stable journal identities

test('reordering or adding fee journal mappings cannot duplicate posted journals', async () => {
  const a = feeLine('ADVERTISING', 'ServiceFee', 'Cost of Advertising', 50)
  const b = feeLine('STORAGE', 'other-transaction', 'Storage Fee', 20)
  const c = feeLine('SUBSCRIPTION', 'ServiceFee', 'Subscription Fee', 5)
  const batch = batchFor('KSA', { nonOrderLinkedAmazonFeeMappings: [a, b] })
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho)
  assert.equal(zoho.journals.size, 2)

  const reordered = { ...batch, status: 'posted', nonOrderLinkedAmazonFeeMappings: [c, b, a] }
  const result = await run(reordered, postingStore, zoho, { allowPosted: true })
  assert.equal(zoho.journals.size, 3, 'only the new journal is created')
  assert.equal(result.summary.journalsCreated, 1)
  assert.equal(result.summary.journalsSkipped, 2)
})

test('legacy positional fee journal rows map to stable identities by their snapshot', async () => {
  const a = feeLine('ADVERTISING', 'ServiceFee', 'Cost of Advertising', 50)
  const b = feeLine('STORAGE', 'other-transaction', 'Storage Fee', 20)
  const batch = batchFor('KSA', { nonOrderLinkedAmazonFeeMappings: [a, b], matchedOrders: [] })
  const zoho = createFakeZoho()
  const legacyA = zoho.createManualJournal()
  const idA = (await legacyA({ amount: 50, referenceNumber: a.journalPreview.referenceNumber, date: null, debit: a.journalPreview.debit, credit: a.journalPreview.credit })).zohoJournalId
  const idB = (await legacyA({ amount: 20, referenceNumber: b.journalPreview.referenceNumber, date: null, debit: b.journalPreview.debit, credit: b.journalPreview.credit })).zohoJournalId
  const postingStore = storeFor(batch, [
    { batchId: 90, paymentType: 'fee_journal_2', postingGroupKey: 'APC-90-fee_journal_2', zohoPaymentId: idA, mappingSnapshot: { normalizedFeeType: 'ADVERTISING', rawTransactionType: 'ServiceFee', description: 'Cost of Advertising' } },
    { batchId: 90, paymentType: 'fee_journal_1', postingGroupKey: 'APC-90-fee_journal_1', zohoPaymentId: idB, mappingSnapshot: { normalizedFeeType: 'STORAGE', rawTransactionType: 'other-transaction', description: 'Storage Fee' } },
  ])
  const before = zoho.calls.createJournal
  const result = await run(batch, postingStore, zoho)
  assert.equal(zoho.calls.createJournal, before)
  assert.equal(result.summary.journalsSkipped, 2)
  assert.equal(result.success, true)
  assert.notEqual(feeJournalIdentity(a, 'KSA'), feeJournalIdentity(b, 'KSA'))
})

test('return fee journals post to UAE accounts with stable identities and never repeat', async () => {
  const returnRows = [
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -100 },
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 15 },
    { orderId: 'r-2', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -50 },
    { orderId: 'r-2', transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 7 },
  ]
  const batch = batchFor('UAE', { status: 'posted', postedToZoho: true, allRows: returnRows, matchedReturns: [] })
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const opts = {
    batch,
    store: postingStore,
    dryRun: false,
    env: PROD_LIKE_KSA_ENV,
    zohoLookup: zoho.lookup,
    createManualJournal: zoho.createManualJournal(),
    buildJournalPayloadPreview: async () => ({}),
    isCreditNoteApplyComplete: async () => true,
  }
  const first = await postReturnFeeJournalsForBatch(opts)
  assert.equal(first.success, true)
  assert.equal(zoho.journals.size, 1)
  const journal = [...zoho.journals.values()][0]
  assert.equal(journal.total, 22)
  const commissionLine = journal.line_items.find((l) => l.debit_or_credit === 'credit')
  assert.equal(commissionLine.account_id, '4265011000000708205', 'commission refunded on returns goes straight to Amazon Commission Exp')
  assert.equal(journal.line_items.find((l) => l.debit_or_credit === 'debit').account_id, UAE_IDS.UNDEPOSITED)
  assert.ok(!journal.line_items.some((l) => l.account_id === UAE_IDS.COMMISSION), 'never touches uncleared commission')
  assert.deepEqual(postingStore.postings.map((row) => row.paymentType), ['return_fee_journal:RETURN_COMMISSION_REVERSAL'])

  const again = await postReturnFeeJournalsForBatch(opts)
  assert.equal(zoho.calls.createJournal, 1)
  assert.equal(again.summary.journalsSkipped, 1)

  await assert.rejects(
    () => postReturnFeeJournalsForBatch({ ...opts, isCreditNoteApplyComplete: async () => false }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_APPLY_REQUIRED'
  )
})

test('return fee lines that mix debit/credit directions stop posting with a clear error', async () => {
  const returnRows = [
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -100 },
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'Other', amountDescription: 'Goodwill', amount: -4 },
    { orderId: 'r-2', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -50 },
    { orderId: 'r-2', transactionType: 'Refund', amountType: 'Other', amountDescription: 'Goodwill', amount: 3 },
  ]
  const batch = batchFor('UAE', { status: 'posted', postedToZoho: true, allRows: returnRows, matchedReturns: [] })
  const zoho = createFakeZoho({ currency: 'AED' })
  await assert.rejects(
    () =>
      postReturnFeeJournalsForBatch({
        batch,
        store: storeFor(batch),
        dryRun: false,
        env: PROD_LIKE_KSA_ENV,
        zohoLookup: zoho.lookup,
        createManualJournal: zoho.createManualJournal(),
        buildJournalPayloadPreview: async () => ({}),
        isCreditNoteApplyComplete: async () => true,
      }),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_JOURNAL_SHAPE_INVALID' && /opposite debit\/credit directions/.test(err.message)
  )
  assert.equal(zoho.calls.createJournal, 0)
})

// 8. Credit notes and refunds

function returnBatch(marketplace = 'UAE') {
  return {
    ...batchFor(marketplace, { status: 'posted', postedToZoho: true }),
    zohoCustomerId: 'cust1',
    matchedReturns: [
      { orderId: 'r-1', amazonRefundAmount: 30, zohoInvoiceId: 'zi-1', creditNoteAction: 'ready_to_create', status: 'ready_to_create' },
      { orderId: 'r-2', amazonRefundAmount: 45, creditNoteAmount: 45, zohoInvoiceId: 'zi-2', zohoCreditNoteId: 'existing-cn', creditNoteAction: 'matched_existing', status: 'matched' },
    ],
  }
}

function applyOpts(zoho, postingStore, extra = {}) {
  return {
    dryRun: false,
    refreshZoho: false,
    store: postingStore,
    env: PROD_LIKE_KSA_ENV,
    zohoLookup: zoho.lookup,
    listRefunds: async (id) => zoho.lookup.listCreditNoteRefunds(id),
    createCreditNote: zoho.createCreditNote(),
    refundCreditNote: zoho.refundCreditNote(),
    paymentDate: '2026-09-30',
    ...extra,
  }
}

test('credit notes are created and refunded from the UAE undeposited account', async () => {
  const batch = returnBatch('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const result = await applyCreditNotesForBatch(batch, applyOpts(zoho, postingStore))
  assert.equal(result.success, true)
  assert.equal(result.summary.created, 1)
  assert.equal(result.summary.refunded, 2)
  const allRefunds = [...zoho.refunds.values()].flat()
  assert.ok(allRefunds.every((r) => r.from_account_id === UAE_IDS.UNDEPOSITED))
})

test('credit note refund timeout after create is recovered and a rerun sends nothing new', async () => {
  const batch = returnBatch('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const result = await applyCreditNotesForBatch(
    batch,
    applyOpts(zoho, postingStore, {
      createCreditNote: zoho.createCreditNote({ timeoutAfterCreate: true }),
      refundCreditNote: zoho.refundCreditNote({ timeoutAfterCreate: true }),
    })
  )
  assert.equal(result.success, true)
  assert.equal(zoho.creditNotes.size, 1)
  const again = await applyCreditNotesForBatch(batch, applyOpts(zoho, postingStore))
  assert.equal(zoho.calls.createCreditNote, 1)
  assert.equal(zoho.calls.refundCreditNote, 2)
  assert.equal(again.summary.skipped, 2)
})

test('a failed refund after a created credit note retries only the refund', async () => {
  const batch = returnBatch('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const first = await applyCreditNotesForBatch(
    batch,
    applyOpts(zoho, postingStore, {
      refundCreditNote: zoho.refundCreditNote({
        failWith: Object.assign(new Error('Zoho API HTTP 400: 11016'), { code: 'ZOHO_API_ERROR', httpStatus: 400 }),
      }),
    })
  )
  assert.equal(first.success, false)
  assert.equal(zoho.creditNotes.size, 1)
  const second = await applyCreditNotesForBatch(batch, applyOpts(zoho, postingStore))
  assert.equal(second.success, true)
  assert.equal(zoho.calls.createCreditNote, 1, 'the credit note is not created twice')
  assert.equal([...zoho.refunds.values()].flat().length, 2)
})

// 9. KSA behaviour stays intact

test('KSA posting still uses the configured KSA accounts and completes', async () => {
  const batch = batchFor('KSA')
  const zoho = createFakeZoho()
  const postingStore = storeFor(batch)
  const result = await run(batch, postingStore, zoho, { env: PROD_LIKE_KSA_ENV })
  assert.equal(result.success, true)
  assert.equal(result.status, 'posted')
  assert.deepEqual(
    [...zoho.payments.values()].map((p) => p.account_id).sort(),
    [...KSA_IDS].sort()
  )
  assert.equal(postingStore.markedPosted, 1)
})

test('safe write on a posted row re-verifies it in Zoho and flags a deleted record', async () => {
  const postingStore = createFakePostingStore({
    existing: [{ batchId: 1, paymentType: 'net_balance', postingGroupKey: 'k', zohoPaymentId: 'gone' }],
  })
  let created = 0
  const outcome = await runSafeWrite({
    store: postingStore,
    label: 'Net',
    row: { batchId: 1, paymentType: 'net_balance', postingGroupKey: 'k', amount: 1 },
    lookup: async () => ({ outcome: 'none', match: null, candidates: [], message: '' }),
    verifyById: async () => ({ outcome: 'missing', match: null, candidates: [], message: 'Zoho customer payment gone was not found.' }),
    create: async () => {
      created += 1
      return { zohoId: 'new' }
    },
  })
  assert.equal(outcome.status, 'verification_required')
  assert.equal(created, 0)
})

test('isSalesOrFeeJournalPosting keeps credit notes and return-fee journals', () => {
  assert.equal(isSalesOrFeeJournalPosting('net_balance'), true)
  assert.equal(isSalesOrFeeJournalPosting('commission'), true)
  assert.equal(isSalesOrFeeJournalPosting('shipping_fba'), true)
  assert.equal(isSalesOrFeeJournalPosting('fee_journal:abc'), true)
  assert.equal(isSalesOrFeeJournalPosting('fee_journal_2'), true)
  assert.equal(isSalesOrFeeJournalPosting('return_fee_journal:COMMISSION'), false)
  assert.equal(isSalesOrFeeJournalPosting('return_fee_journal_1'), false)
  assert.equal(isSalesOrFeeJournalPosting('credit_note_refund'), false)
  assert.equal(isSalesOrFeeJournalPosting('credit_note_create'), false)
})

function postedForceBatch() {
  const fee = feeLine('ADVERTISING', 'ServiceFee', 'Cost of Advertising', 50)
  return batchFor('UAE', { nonOrderLinkedAmazonFeeMappings: [fee] })
}

const salesAndFeeRows = (postingStore) => postingStore.postings.filter((row) => isSalesOrFeeJournalPosting(row.paymentType))

test('force repost links exact Zoho matches that an earlier run flagged for verification', async () => {
  const batch = postedForceBatch()
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho)
  for (const row of salesAndFeeRows(postingStore)) {
    row.status = 'verification_required'
    row.zohoPaymentId = ''
    row.mappingSnapshot = { ...row.mappingSnapshot, attempted: false }
  }
  const createdBefore = zoho.calls.createPayment + zoho.calls.createJournal

  const plain = await run({ ...batch, status: 'posted' }, postingStore, zoho, { allowPosted: true })
  assert.equal(plain.success, false, 'without force the matches stay flagged')

  const forced = await run({ ...batch, status: 'posted' }, postingStore, zoho, { allowPosted: true, forceRepost: true })
  assert.equal(forced.success, true)
  assert.equal(zoho.calls.createPayment + zoho.calls.createJournal, createdBefore, 'nothing is created again')
  assert.ok(salesAndFeeRows(postingStore).every((row) => row.status === 'posted' && row.zohoPaymentId))
  assert.equal(postingStore.markedPosted, 2)
})

test('force repost posts again entries whose Zoho records were deleted, keeping credit notes', async () => {
  const batch = postedForceBatch()
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  await run(batch, postingStore, zoho)
  postingStore.postings.push({ id: 900, batchId: batch.batchId, paymentType: 'credit_note_refund', postingGroupKey: 'APC-cn', status: 'posted', zohoPaymentId: 'cn-keep', mappingSnapshot: {} })
  zoho.payments.clear()
  zoho.journals.clear()

  const plain = await run({ ...batch, status: 'posted' }, postingStore, zoho, { allowPosted: true })
  assert.equal(plain.success, false)
  assert.equal(zoho.payments.size, 0, 'without force nothing is reposted')

  const forced = await run({ ...batch, status: 'posted' }, postingStore, zoho, { allowPosted: true, forceRepost: true })
  assert.equal(forced.success, true)
  assert.equal(forced.summary.paymentsCreated, 3)
  assert.equal(forced.summary.journalsCreated, 1)
  assert.equal(zoho.payments.size, 3)
  assert.equal(zoho.journals.size, 1)
  assert.ok(postingStore.postings.some((row) => row.paymentType === 'credit_note_refund' && row.zohoPaymentId === 'cn-keep'))

  const again = await run({ ...batch, status: 'posted' }, postingStore, zoho, { allowPosted: true, forceRepost: true })
  assert.equal(again.success, true)
  assert.equal(zoho.payments.size, 3, 'a second force repost creates no duplicates')
  assert.equal(zoho.journals.size, 1)
})

test('posting reports progress for every payment and journal', async () => {
  const batch = postedForceBatch()
  const zoho = createFakeZoho({ currency: 'AED' })
  const events = []
  const result = await run(batch, storeFor(batch), zoho, { onProgress: (p) => events.push(p) })
  assert.equal(result.success, true)
  assert.ok(events.every((e) => e.total === 4))
  assert.deepEqual(events.map((e) => e.current), [0, 0, 1, 2, 3, 4])
  assert.deepEqual(events.slice(1, 5).map((e) => e.step), ['Net Balance Payment', 'Commission Payment', 'Shipping/FBA Payment', 'ADVERTISING journal'])
})

test('force repost does not resend a recently timed-out create, but does once it is stale', async () => {
  const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString()
  const uncertainRow = (attemptedAt) => ({
    batchId: 1,
    paymentType: 'shipping_fba',
    postingGroupKey: 'k',
    status: 'verification_required',
    zohoPaymentId: '',
    mappingSnapshot: { attempted: true, attemptedAt },
  })
  const attempt = async (postingStore) => {
    let created = 0
    const outcome = await runSafeWrite({
      force: true,
      store: postingStore,
      label: 'Shipping',
      row: { batchId: 1, paymentType: 'shipping_fba', postingGroupKey: 'k', amount: 1 },
      lookup: async () => ({ outcome: 'none', match: null, candidates: [], message: 'none' }),
      create: async () => {
        created += 1
        return { zohoId: 'pay-new' }
      },
    })
    return { outcome, created }
  }

  const recent = await attempt(createFakePostingStore({ existing: [uncertainRow(minutesAgo(2))] }))
  assert.equal(recent.outcome.status, 'verification_required')
  assert.equal(recent.created, 0)

  const stale = await attempt(createFakePostingStore({ existing: [uncertainRow(minutesAgo(20))] }))
  assert.equal(stale.outcome.status, 'posted')
  assert.equal(stale.outcome.zohoId, 'pay-new')
  assert.equal(stale.created, 1)
})

// 11. Returns: credit notes found later, and refunds whose product never came back

const {
  mergeRefreshedReturnMatches,
  buildCreditNoteApplyPlan,
} = require('../src/services/amazonPaymentClearingCreditNotePostingService')
const { buildNotReceivedReturnPlan } = require('../src/services/amazonPaymentClearingNotReceivedReturnService')
const {
  postNotReceivedReturnsForBatch,
  isNotReceivedPostComplete,
} = require('../src/services/amazonPaymentClearingPostingService')

const UAE_RETURN_EXPENSE_ID = '4265011000003287848'

function notReceivedBatch(extra = {}) {
  return {
    ...batchFor('UAE', { status: 'posted', postedToZoho: true }),
    zohoCustomerId: 'cust1',
    matchedReturns: [
      { orderId: '404-0828335-0868329', amazonRefundAmount: 85, zohoInvoiceId: 'zi-1', zohoInvoiceNumber: 'INV-1', creditNoteAction: 'ready_to_create', status: 'ready_to_create' },
      { orderId: '402-3772982-5137166', amazonRefundAmount: 75, zohoInvoiceId: 'zi-2', zohoInvoiceNumber: 'INV-2', creditNoteAction: 'ready_to_create', status: 'ready_to_create' },
    ],
    returnDispositions: [
      { orderId: '404-0828335-0868329', disposition: 'not_received', amount: 85, reason: 'warehouse did not receive', zohoInvoiceNumber: 'INV-1' },
      { orderId: '402-3772982-5137166', disposition: 'not_received', amount: 75, reason: 'warehouse did not receive', zohoInvoiceNumber: 'INV-2' },
    ],
    ...extra,
  }
}

function notReceivedOpts(batch, postingStore, zoho, extra = {}) {
  return {
    batch,
    store: postingStore,
    dryRun: false,
    env: PROD_LIKE_KSA_ENV,
    zohoLookup: zoho.lookup,
    createManualJournal: zoho.createManualJournal(),
    buildJournalPayloadPreview: async (j) => ({ reference_number: j.referenceNumber, notes: j.notes }),
    isSalesComplete: async () => true,
    ...extra,
  }
}

test('credit notes found live in Zoho are saved into the batch and leave the missing lists', () => {
  const stored = {
    matchedReturns: [
      { orderId: 'o-1', amazonRefundAmount: 68, zohoInvoiceId: 'zi-1', status: 'ready_to_create', creditNoteAction: 'ready_to_create' },
      { orderId: 'o-2', amazonRefundAmount: 225, zohoInvoiceId: 'zi-2', status: 'ready_to_create', creditNoteAction: 'ready_to_create' },
    ],
    missingCreditNotes: [{ orderId: 'o-3', amazonRefundAmount: 85 }],
    creditNoteBlockingRows: [{ orderId: 'o-3', amazonRefundAmount: 85, status: 'blocked' }],
  }
  const merged = mergeRefreshedReturnMatches(stored, [
    { orderId: 'o-1', zohoCreditNoteId: 'cn-1', zohoCreditNoteNumber: 'CN-1', creditNoteAmount: 68, status: 'matched', creditNoteAction: 'matched_existing' },
    { orderId: 'o-2', zohoCreditNoteId: '', status: 'ready_to_create' },
    { orderId: 'o-3', zohoCreditNoteId: 'cn-3', zohoCreditNoteNumber: 'CN-3', creditNoteAmount: 85, status: 'matched' },
    { orderId: 'unknown', zohoCreditNoteId: 'cn-x', status: 'matched' },
  ])
  assert.equal(merged.changed, true)
  assert.deepEqual(merged.newlyFound.map((row) => row.orderId).sort(), ['o-1', 'o-3'])
  const byOrder = new Map(merged.matchedReturns.map((row) => [row.orderId, row]))
  assert.equal(byOrder.get('o-1').zohoCreditNoteId, 'cn-1')
  assert.equal(byOrder.get('o-1').status, 'matched')
  assert.equal(byOrder.get('o-2').status, 'ready_to_create')
  assert.equal(byOrder.get('o-3').zohoCreditNoteNumber, 'CN-3')
  assert.equal(byOrder.has('unknown'), false, 'orders outside the settlement are never added')
  assert.deepEqual(merged.missingCreditNotes, [])
  assert.deepEqual(merged.creditNoteBlockingRows, [])

  const again = mergeRefreshedReturnMatches(
    { ...stored, matchedReturns: merged.matchedReturns, missingCreditNotes: [], creditNoteBlockingRows: [] },
    [{ orderId: 'o-1', zohoCreditNoteId: 'cn-1', status: 'matched' }]
  )
  assert.equal(again.changed, false)
})

test('returns marked not received leave the step 10 plan and count as complete there', async () => {
  const batch = notReceivedBatch()
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const plan = await buildCreditNoteApplyPlan(batch, applyOpts(zoho, postingStore))
  assert.deepEqual(plan.rows.map((row) => row.action), ['moved_to_not_received', 'moved_to_not_received'])
  assert.equal(plan.summary.movedToNotReceived, 2)
  assert.equal(plan.summary.isComplete, true)

  const result = await applyCreditNotesForBatch(batch, applyOpts(zoho, postingStore))
  assert.equal(zoho.calls.createCreditNote, 0, 'no credit note is created for a return that never came back')
  assert.equal(zoho.calls.refundCreditNote, 0)
  assert.equal(result.success, true)
})

test('a marked order that later gets a Zoho credit note stays in step 10', async () => {
  const batch = notReceivedBatch()
  batch.matchedReturns[0] = { ...batch.matchedReturns[0], zohoCreditNoteId: 'cn-late', creditNoteAmount: 85, status: 'matched', creditNoteAction: 'matched_existing' }
  const zoho = createFakeZoho({ currency: 'AED' })
  const plan = await buildCreditNoteApplyPlan(batch, applyOpts(zoho, storeFor(batch)))
  const row = plan.rows.find((r) => r.orderId === '404-0828335-0868329')
  assert.equal(row.action, 'blocked', 'never refunded and expensed at the same time')
  assert.match(row.blockingReason, /Undo the mark/)
})

test('not-received returns post one combined journal: Dr Amazon Return Exp / Cr Undeposited, never twice', async () => {
  const batch = notReceivedBatch()
  const plan = buildNotReceivedReturnPlan(batch, { env: PROD_LIKE_KSA_ENV })
  assert.equal(plan.summary.total, 160)
  assert.equal(plan.line.status, 'ready')
  assert.equal(plan.line.referenceNumber, '03-Sep-2026 to 17-Sep-2026 Returns Not Received')
  assert.match(plan.line.notes, /404-0828335-0868329/)
  assert.match(plan.line.notes, /402-3772982-5137166/)
  assert.doesNotMatch(plan.line.notes, /HR|hr-attendance|BI/)

  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  assert.equal(await isNotReceivedPostComplete(batch.batchId, batch, postingStore), false)

  const dry = await postNotReceivedReturnsForBatch(notReceivedOpts(batch, postingStore, zoho, { dryRun: true }))
  assert.equal(dry.journals[0].status, 'dry_run')
  assert.equal(zoho.calls.createJournal, 0)

  const first = await postNotReceivedReturnsForBatch(notReceivedOpts(batch, postingStore, zoho))
  assert.equal(first.success, true)
  assert.equal(zoho.journals.size, 1)
  const journal = [...zoho.journals.values()][0]
  assert.equal(journal.total, 160)
  const debit = journal.line_items.find((l) => l.debit_or_credit === 'debit')
  const credit = journal.line_items.find((l) => l.debit_or_credit === 'credit')
  assert.equal(debit.account_id, UAE_RETURN_EXPENSE_ID)
  assert.equal(credit.account_id, UAE_IDS.UNDEPOSITED)
  assert.deepEqual(postingStore.postings.map((row) => row.paymentType), ['return_not_received_journal'])
  assert.equal(await isNotReceivedPostComplete(batch.batchId, batch, postingStore), true)

  const again = await postNotReceivedReturnsForBatch(notReceivedOpts(batch, postingStore, zoho))
  assert.equal(zoho.calls.createJournal, 1)
  assert.equal(again.summary.journalsSkipped, 1)
})

test('not-received journal waits for sales payments and needs something marked', async () => {
  const zoho = createFakeZoho({ currency: 'AED' })
  const batch = notReceivedBatch()
  await assert.rejects(
    () => postNotReceivedReturnsForBatch(notReceivedOpts(batch, storeFor(batch), zoho, { isSalesComplete: async () => false })),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_SALES_NOT_POSTED'
  )
  const empty = notReceivedBatch({ returnDispositions: [] })
  await assert.rejects(
    () => postNotReceivedReturnsForBatch(notReceivedOpts(empty, storeFor(empty), zoho)),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_NO_NOT_RECEIVED_RETURNS'
  )
  assert.equal(zoho.calls.createJournal, 0)
})

// 12. Step 13: uncleared commission / shipping moved to expense with input VAT split

const {
  postUnclearedClearingForBatch,
  buildUnclearedClearingPlanForBatch,
  isUnclearedClearingComplete,
} = require('../src/services/amazonPaymentClearingPostingService')

const UAE_COMMISSION_EXP_ID = '4265011000000708205'
const UAE_SHIPPING_EXP_ID = '4265011000000747608'
const UAE_INPUT_VAT_ID = '4265011000000077044'

function batch40Postings(batchId) {
  const journal = (paymentType, amount, debitAccountId, creditAccountId) => ({
    batchId, paymentType, amount, zohoPaymentId: `zj-${paymentType}`, mappingSnapshot: { debitAccountId, creditAccountId },
  })
  return [
    { batchId, paymentType: 'net_balance', accountCode: '1016', amount: 49829.7, zohoPaymentId: 'zp-net' },
    { batchId, paymentType: 'commission', accountCode: '1021', amount: 10345.08, zohoPaymentId: 'zp-comm' },
    { batchId, paymentType: 'shipping_fba', accountCode: '1025', amount: 5505.21, zohoPaymentId: 'zp-ship' },
    { batchId, paymentType: 'credit_note_refund', accountCode: '1016', amount: 121, zohoPaymentId: 'zr-1', mappingSnapshot: { refundAccountId: UAE_IDS.UNDEPOSITED } },
    journal('return_fee_journal:RETURN_COMMISSION_REVERSAL', 941.09, UAE_IDS.UNDEPOSITED, UAE_IDS.COMMISSION),
    journal('return_fee_journal:RETURN_OTHER_FEE', 140.65, UAE_IDS.SHIPPING_FBA, UAE_IDS.UNDEPOSITED),
    journal('return_fee_journal:RETURN_SHIPPING_FEE_REFUND', 20.76, UAE_IDS.UNDEPOSITED, UAE_IDS.SHIPPING_FBA),
    journal('correction_journal:cod_offset', 50, UAE_IDS.UNDEPOSITED, UAE_IDS.SHIPPING_FBA),
    { batchId, paymentType: 'commission', accountCode: '1021', amount: 999, zohoPaymentId: '', status: 'failed' },
  ]
}

function clearingOpts(batch, postingStore, zoho, extra = {}) {
  return {
    batch,
    store: postingStore,
    dryRun: false,
    env: PROD_LIKE_KSA_ENV,
    zohoLookup: zoho.lookup,
    createManualJournal: zoho.createManualJournal(),
    buildJournalPayloadPreview: async (j) => ({ reference_number: j.referenceNumber, notes: j.notes }),
    readiness: async () => ({ ok: true }),
    ...extra,
  }
}

test('step 13 clears exactly the commission / shipping record payments, net of input VAT, ignoring return journals', async () => {
  const batch = notReceivedBatch()
  const postings = batch40Postings(batch.batchId)
  const plan = buildUnclearedClearingPlanForBatch(batch, postings.map((row) => ({ status: 'posted', mappingSnapshot: {}, ...row })), PROD_LIKE_KSA_ENV)
  const commission = plan.lines.find((line) => line.role === 'COMMISSION')
  const shipping = plan.lines.find((line) => line.role === 'SHIPPING_FBA')
  assert.equal(commission.grossAmount, 10345.08)
  assert.equal(commission.vatAmount, 492.62)
  assert.equal(commission.netAmount, 9852.46)
  assert.equal(shipping.grossAmount, 5505.21)
  assert.equal(shipping.vatAmount, 262.15)
  assert.equal(shipping.netAmount, 5243.06)
  assert.deepEqual(
    commission.lineItems.map((l) => [l.debitOrCredit, l.accountId, l.amount]),
    [['debit', UAE_COMMISSION_EXP_ID, 9852.46], ['debit', UAE_INPUT_VAT_ID, 492.62], ['credit', UAE_IDS.COMMISSION, 10345.08]]
  )
  assert.equal(shipping.lineItems[0].accountId, UAE_SHIPPING_EXP_ID)
  assert.equal(shipping.lineItems[2].accountId, UAE_IDS.SHIPPING_FBA)
  assert.equal(commission.referenceNumber, '03-Sep-2026 to 17-Sep-2026 Commission Clearing')
  assert.doesNotMatch(`${commission.notes} ${commission.lineItems.map((l) => l.description).join(' ')}`, /HR|hr-attendance|Generated|Purchase Planning/)

  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch, postings)
  const dry = await postUnclearedClearingForBatch(clearingOpts(batch, postingStore, zoho, { dryRun: true }))
  assert.deepEqual(dry.journals.map((j) => j.status), ['dry_run', 'dry_run'])
  assert.equal(zoho.calls.createJournal, 0)

  const first = await postUnclearedClearingForBatch(clearingOpts(batch, postingStore, zoho))
  assert.equal(first.success, true)
  assert.equal(zoho.journals.size, 2)
  const totals = [...zoho.journals.values()].map((j) => j.total).sort((a, b) => a - b)
  assert.deepEqual(totals, [5505.21, 10345.08])
  const after = await postingStore.listPostingsForBatch(batch.batchId)
  assert.equal(await isUnclearedClearingComplete(batch, after, PROD_LIKE_KSA_ENV), true)
  const replan = buildUnclearedClearingPlanForBatch(batch, after, PROD_LIKE_KSA_ENV)
  assert.equal(replan.lines.find((l) => l.role === 'COMMISSION').grossAmount, 10345.08, 'own clearing journal is not counted')

  const again = await postUnclearedClearingForBatch(clearingOpts(batch, postingStore, zoho))
  assert.equal(zoho.calls.createJournal, 2, 'never posted twice')
  assert.equal(again.summary.journalsSkipped, 2)
})

test('step 13 waits for steps 9-12 and blocks KSA without an input VAT account', async () => {
  const zoho = createFakeZoho({ currency: 'AED' })
  const batch = notReceivedBatch()
  await assert.rejects(
    () => postUnclearedClearingForBatch(clearingOpts(batch, storeFor(batch, batch40Postings(batch.batchId)), zoho, {
      readiness: async () => ({ ok: false, message: 'Post the return fee journals first (step 12).' }),
    })),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_CLEARING_NOT_READY'
  )
  const ksa = { ...batch, marketplace: 'KSA' }
  const ksaPostings = [{ batchId: ksa.batchId, paymentType: 'commission', accountCode: '1026', amount: 115, zohoPaymentId: 'zp-k' }]
  const plan = buildUnclearedClearingPlanForBatch(ksa, ksaPostings.map((row) => ({ status: 'posted', mappingSnapshot: {}, ...row })), PROD_LIKE_KSA_ENV)
  assert.equal(plan.lines[0].vatAmount, 15)
  assert.equal(plan.lines[0].status, 'needs_mapping')
  assert.match(plan.lines[0].blockingReason, /AMAZON_KSA_ZOHO_INPUT_VAT_ACCOUNT_ID/)
  await assert.rejects(
    () => postUnclearedClearingForBatch(clearingOpts(ksa, storeFor(ksa, ksaPostings), zoho)),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_CLEARING_ACCOUNT_MISSING'
  )
  assert.equal(zoho.calls.createJournal, 0)
})

test('step 12 return fee journals wait for the step 11 journal when returns are marked', async () => {
  const returnRows = [
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -100 },
    { orderId: 'r-1', transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 15 },
  ]
  const batch = notReceivedBatch({ allRows: returnRows })
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const feeOpts = {
    batch,
    store: postingStore,
    dryRun: false,
    env: PROD_LIKE_KSA_ENV,
    zohoLookup: zoho.lookup,
    createManualJournal: zoho.createManualJournal(),
    buildJournalPayloadPreview: async () => ({}),
    isCreditNoteApplyComplete: async () => true,
  }
  await assert.rejects(
    () => postReturnFeeJournalsForBatch(feeOpts),
    (err) => err.code === 'AMAZON_PAYMENT_CLEARING_NOT_RECEIVED_JOURNAL_REQUIRED'
  )
  assert.equal(zoho.calls.createJournal, 0)

  await postNotReceivedReturnsForBatch(notReceivedOpts(batch, postingStore, zoho))
  const fees = await postReturnFeeJournalsForBatch(feeOpts)
  assert.equal(fees.success, true)
})

test('posting status shows returns not received as their own group, not as missing credit notes', async () => {
  const batch = notReceivedBatch()
  const zoho = createFakeZoho({ currency: 'AED' })
  const postingStore = storeFor(batch)
  const before = await buildPostingStatus({ batch, store: postingStore, env: PROD_LIKE_KSA_ENV })
  assert.equal(before.groups.find((g) => g.key === 'credit_note').entries.length, 0)
  const group = before.groups.find((g) => g.key === 'return_not_received')
  assert.equal(group.entries.length, 1)
  assert.equal(group.entries[0].status, 'not_started')
  assert.equal(group.entries[0].amount, 160)
  assert.equal(before.notReceivedComplete, false)
  assert.ok(before.blockers.some((b) => /step 11/.test(b.message)))

  await postNotReceivedReturnsForBatch(notReceivedOpts(batch, postingStore, zoho))
  const after = await buildPostingStatus({ batch, store: postingStore, env: PROD_LIKE_KSA_ENV })
  assert.equal(after.groups.find((g) => g.key === 'return_not_received').status, 'posted')
  assert.equal(after.notReceivedComplete, true)
})

test('undo and new marks are refused once the step 11 journal is in Zoho', async () => {
  const service = require('../src/services/amazonPaymentClearingService')
  const batch = notReceivedBatch()
  const original = { getBatchById: store.getBatchById, listPostingsForBatch: store.listPostingsForBatch, updateReturnDispositions: store.updateReturnDispositions }
  let saved = null
  store.getBatchById = async () => batch
  store.listPostingsForBatch = async () => [{ id: 1, batchId: batch.batchId, paymentType: 'return_not_received_journal', status: 'posted', zohoPaymentId: 'zj-1' }]
  store.updateReturnDispositions = async (_id, rows) => {
    saved = rows
    return { ...batch, returnDispositions: rows }
  }
  try {
    await assert.rejects(
      () => service.unmarkReturnNotReceived(batch.batchId, '404-0828335-0868329', {}, { actorUserId: 1 }),
      (err) => err.code === 'AMAZON_PAYMENT_CLEARING_NOT_RECEIVED_JOURNAL_POSTED'
    )
    await assert.rejects(
      () => service.markReturnNotReceived(batch.batchId, '407-3586917-0392359', { reason: 'not received' }, { actorUserId: 1 }),
      (err) => err.code === 'AMAZON_PAYMENT_CLEARING_NOT_RECEIVED_JOURNAL_POSTED'
    )
    await assert.rejects(
      () => service.markReturnNotReceived(batch.batchId, '407-3586917-0392359', { reason: 'no' }, { actorUserId: 1 }),
      (err) => err.code === 'AMAZON_PAYMENT_CLEARING_REASON_REQUIRED'
    )
    assert.equal(saved, null)
  } finally {
    Object.assign(store, original)
  }
})

test('returns jobs report progress, share one run per batch, and keep the error code', async () => {
  const { startReturnsJob, getReturnsJob } = require('../src/services/amazonPaymentClearingReturnsJobService')
  let release
  let runs = 0
  const gate = new Promise((resolve) => { release = resolve })
  const first = startReturnsJob('test_job', 7, async (onProgress) => {
    runs += 1
    onProgress({ step: 'Order 1', current: 1, total: 3 })
    await gate
    return { ok: true }
  })
  const second = startReturnsJob('test_job', 7, async () => ({ ok: false }))
  assert.equal(second.jobId, first.jobId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(getReturnsJob(first.jobId).progress, { step: 'Order 1', current: 1, total: 3 })
  release()
  await new Promise((resolve) => setTimeout(resolve, 5))
  const done = getReturnsJob(first.jobId)
  assert.equal(done.status, 'completed')
  assert.deepEqual(done.result, { ok: true })
  assert.equal(runs, 1)

  const failing = startReturnsJob('test_job', 8, async () => {
    throw Object.assign(new Error('Zoho said no'), { code: 'X_CODE', status: 422 })
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const failed = getReturnsJob(failing.jobId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'Zoho said no')
  assert.equal(failed.errorCode, 'X_CODE')
})

test('step 10 plan reports progress for every return it checks', async () => {
  const batch = returnBatch('UAE')
  const zoho = createFakeZoho({ currency: 'AED' })
  const events = []
  await buildCreditNoteApplyPlan(batch, applyOpts(zoho, storeFor(batch), { onProgress: (p) => events.push(p) }))
  assert.deepEqual(events.map((e) => [e.current, e.total]), [[0, 2], [1, 2]])
})

test('offline step 10 plan uses saved refunds and never looks up the Zoho customer', async () => {
  const { zohoCustomerId: _omit, ...batch } = returnBatch('UAE')
  const snapshot = { 'existing-cn': [{ reference_number: '', amount: 45 }] }
  const plan = await buildCreditNoteApplyPlan(batch, {
    offline: true,
    refreshZoho: true,
    store: storeFor(batch),
    env: PROD_LIKE_KSA_ENV,
    listRefunds: async (id) => snapshot[id] || [],
    onRefreshedRows: () => { throw new Error('offline plan must not re-read Zoho') },
  })
  const byOrder = new Map(plan.rows.map((row) => [row.orderId, row]))
  assert.equal(byOrder.get('r-2').action, 'skipped_already_refunded')
  assert.equal(byOrder.get('r-1').action, 'create_and_refund')
  assert.equal(byOrder.get('r-1').zohoCustomerId, null)
})

test('a return whose credit note create Zoho rejected can still be marked not received', async () => {
  const service = require('../src/services/amazonPaymentClearingService')
  const batch = notReceivedBatch({ returnDispositions: [], creditNoteRefundsCheckedAt: new Date().toISOString() })
  const orderId = '404-0828335-0868329'
  const original = {
    getBatchById: store.getBatchById,
    listPostingsForBatch: store.listPostingsForBatch,
    updateReturnDispositions: store.updateReturnDispositions,
    insertClearingAudit: store.insertClearingAudit,
  }
  let postings = [{ id: 5, batchId: batch.batchId, orderId, paymentType: 'credit_note_create', status: 'failed', zohoPaymentId: null, errorMessage: 'Specify the Associated Invoice Number.' }]
  let saved = null
  store.getBatchById = async () => batch
  store.listPostingsForBatch = async () => postings
  store.updateReturnDispositions = async (_id, rows) => {
    saved = rows
    return { ...batch, returnDispositions: rows }
  }
  store.insertClearingAudit = async () => ({})
  try {
    await service.markReturnNotReceived(9998, orderId, { reason: 'warehouse did not receive' }, { actorUserId: 1 })
    assert.deepEqual(saved.map((d) => d.orderId), [orderId])

    saved = null
    postings = [{ ...postings[0], status: 'posted', zohoPaymentId: 'cn-9' }]
    await assert.rejects(
      () => service.markReturnNotReceived(9997, orderId, { reason: 'warehouse did not receive' }, { actorUserId: 1 }),
      (err) => err.code === 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_EXISTS'
    )
    assert.equal(saved, null)
  } finally {
    Object.assign(store, original)
  }
})

test('marking not received needs a recent Zoho refresh', async () => {
  const service = require('../src/services/amazonPaymentClearingService')
  const batch = notReceivedBatch({ returnDispositions: [] })
  const original = { getBatchById: store.getBatchById, listPostingsForBatch: store.listPostingsForBatch, updateReturnDispositions: store.updateReturnDispositions }
  let saved = null
  store.getBatchById = async () => batch
  store.listPostingsForBatch = async () => []
  store.updateReturnDispositions = async (_id, rows) => {
    saved = rows
    return { ...batch, returnDispositions: rows }
  }
  try {
    await assert.rejects(
      () => service.markReturnNotReceived(9999, '404-0828335-0868329', { reason: 'warehouse did not receive' }, { actorUserId: 1 }),
      (err) => err.code === 'AMAZON_PAYMENT_CLEARING_REFRESH_REQUIRED'
    )
    assert.equal(saved, null)
  } finally {
    Object.assign(store, original)
  }
})

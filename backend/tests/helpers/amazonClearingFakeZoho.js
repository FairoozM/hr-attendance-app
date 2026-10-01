/**
 * In-memory Zoho Books double for Amazon payment clearing tests. Records created
 * through it can be found again through the same list/get lookups the recovery
 * code uses, so tests exercise real matching instead of stubbed outcomes.
 */

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function timeoutError() {
  const err = new Error('Zoho API request timed out after 45000ms')
  err.code = 'ZOHO_API_TIMEOUT'
  return err
}

function createFakeZoho({ currency = 'SAR' } = {}) {
  const payments = new Map()
  const journals = new Map()
  const creditNotes = new Map()
  const refunds = new Map()
  const calls = { createPayment: 0, createJournal: 0, createCreditNote: 0, refundCreditNote: 0, lookups: 0 }
  let seq = 0
  const nextId = (prefix) => `${prefix}-${++seq}`

  function paymentFromRequest(request, id) {
    return {
      payment_id: id,
      payment_number: `PAY-${seq}`,
      customer_id: request.customerId,
      reference_number: request.referenceNumber,
      date: request.paymentDate,
      amount: round2(request.amount),
      account_id: request.depositToAccountId,
      currency_code: currency,
      invoices: (request.invoices || []).map((row) => ({ invoice_id: row.invoiceId, amount_applied: round2(row.amountApplied) })),
    }
  }

  function journalFromRequest(request, id) {
    const amount = round2(request.amount)
    if (Array.isArray(request.lineItems) && request.lineItems.length >= 2) {
      const lines = request.lineItems.map((l) => ({ account_id: l.accountId, debit_or_credit: l.debitOrCredit, amount: round2(l.amount) }))
      return {
        journal_id: id,
        entry_number: `JE-${seq}`,
        reference_number: request.referenceNumber,
        journal_date: request.date,
        total: round2(lines.filter((l) => l.debit_or_credit === 'debit').reduce((s, l) => s + l.amount, 0)),
        currency_code: currency,
        line_items: lines,
      }
    }
    return {
      journal_id: id,
      entry_number: `JE-${seq}`,
      reference_number: request.referenceNumber,
      journal_date: request.date,
      total: amount,
      currency_code: currency,
      line_items: [
        { account_id: request.debit?.accountId, debit_or_credit: 'debit', amount },
        { account_id: request.credit?.accountId, debit_or_credit: 'credit', amount },
      ],
    }
  }

  const byRef = (map, params) =>
    [...map.values()].filter(
      (row) => !params.reference_number_contains || String(row.reference_number || '').includes(params.reference_number_contains)
    )

  const lookup = {
    listCustomerPayments: async (params = {}) => {
      calls.lookups += 1
      return byRef(payments, params)
    },
    getCustomerPayment: async (id) => payments.get(String(id)) || null,
    listJournals: async (params = {}) => {
      calls.lookups += 1
      return byRef(journals, params)
    },
    getJournal: async (id) => journals.get(String(id)) || null,
    listCreditNotes: async (params = {}) => {
      calls.lookups += 1
      return byRef(creditNotes, params).filter((row) => !params.customer_id || row.customer_id === params.customer_id)
    },
    listCreditNoteRefunds: async (creditNoteId) => refunds.get(String(creditNoteId)) || [],
    getCreditNoteRefund: async (creditNoteId, refundId) =>
      (refunds.get(String(creditNoteId)) || []).find((row) => row.creditnote_refund_id === refundId) || null,
  }

  /**
   * @param {{ failWith?: Error, timeoutAfterCreate?: boolean, timeoutBeforeCreate?: boolean, onCall?: Function }} [behaviour]
   */
  function createPayment(behaviour = {}) {
    return async (request, meta = {}) => {
      calls.createPayment += 1
      if (behaviour.onCall) await behaviour.onCall(request, meta)
      if (behaviour.failWith) throw behaviour.failWith
      if (behaviour.timeoutBeforeCreate) throw timeoutError()
      const id = nextId('zp')
      payments.set(id, paymentFromRequest(request, id))
      if (behaviour.timeoutAfterCreate) throw timeoutError()
      return { zohoPaymentId: id, payment_id: id }
    }
  }

  function createManualJournal(behaviour = {}) {
    return async (request, meta = {}) => {
      calls.createJournal += 1
      if (behaviour.onCall) await behaviour.onCall(request, meta)
      if (behaviour.failWith) throw behaviour.failWith
      const id = nextId('zj')
      journals.set(id, journalFromRequest(request, id))
      if (behaviour.timeoutAfterCreate) throw timeoutError()
      return { zohoJournalId: id, zohoJournalNumber: journals.get(id).entry_number }
    }
  }

  function createCreditNote(behaviour = {}) {
    return async (payload, meta = {}) => {
      calls.createCreditNote += 1
      if (behaviour.onCall) await behaviour.onCall(payload, meta)
      if (behaviour.failWith) throw behaviour.failWith
      const id = nextId('zcn')
      const total = round2((payload.line_items || []).reduce((s, l) => s + Number(l.rate) * (Number(l.quantity) || 1), 0))
      creditNotes.set(id, {
        creditnote_id: id,
        creditnote_number: `CN-${seq}`,
        customer_id: payload.customer_id,
        reference_number: payload.reference_number,
        date: payload.date,
        total,
        currency_code: currency,
      })
      if (behaviour.timeoutAfterCreate) throw timeoutError()
      return { creditNoteId: id, creditNoteNumber: creditNotes.get(id).creditnote_number }
    }
  }

  function refundCreditNote(behaviour = {}) {
    return async (creditNoteId, payload, meta = {}) => {
      calls.refundCreditNote += 1
      if (behaviour.onCall) await behaviour.onCall(creditNoteId, payload, meta)
      if (behaviour.failWith) throw behaviour.failWith
      const id = nextId('zr')
      const list = refunds.get(String(creditNoteId)) || []
      list.push({
        creditnote_refund_id: id,
        date: payload.date,
        reference_number: payload.reference_number,
        amount: round2(payload.amount),
        from_account_id: payload.from_account_id,
      })
      refunds.set(String(creditNoteId), list)
      if (behaviour.timeoutAfterCreate) throw timeoutError()
      return { creditNoteRefundId: id }
    }
  }

  /** Wrap a test's own create fake so its results also exist in this Zoho double. */
  function recordPayments(fn) {
    return async (request, meta) => {
      const out = await fn(request, meta)
      const id = out?.zohoPaymentId || out?.payment_id
      if (id) payments.set(String(id), paymentFromRequest(request, String(id)))
      return out
    }
  }

  function recordJournals(fn) {
    return async (request, meta) => {
      const out = await fn(request, meta)
      if (out?.zohoJournalId) journals.set(String(out.zohoJournalId), journalFromRequest(request, String(out.zohoJournalId)))
      return out
    }
  }

  return {
    payments,
    journals,
    creditNotes,
    refunds,
    calls,
    lookup,
    paymentFromRequest,
    journalFromRequest,
    createPayment,
    createManualJournal,
    createCreditNote,
    refundCreditNote,
    recordPayments,
    recordJournals,
  }
}

/**
 * Posting store double with the same row semantics as the Postgres store,
 * including the write-ahead `pending` row and unique posting identities.
 */
function createFakePostingStore({ existing = [], previewFor = null, batch = null } = {}) {
  const postings = existing.map((row, idx) => ({ id: idx + 1, status: 'posted', mappingSnapshot: {}, ...row }))
  const audits = []
  let nextId = postings.length + 1
  const sameKey = (row, key) =>
    row.batchId === key.batchId &&
    row.paymentType === key.paymentType &&
    (key.invoiceId ? row.invoiceId === key.invoiceId : !row.invoiceId)
  const fake = {
    postings,
    audits,
    postedBy: null,
    markedPosted: 0,
    usedMappingIds: null,
    async getLatestPaymentPreviewForBatch(batchId) {
      return previewFor ? previewFor(batchId) : { paymentPreviewId: 1, batchId }
    },
    async getBatchById() {
      return batch
    },
    async listPostingsForBatch(batchId) {
      return postings.filter((row) => row.batchId === batchId).map((row) => ({ ...row }))
    },
    async findPosting(batchId, invoiceId, paymentType) {
      return postings.find((row) => row.batchId === batchId && row.invoiceId === invoiceId && row.paymentType === paymentType) || null
    },
    async findGroupedPosting(batchId, paymentType) {
      return postings.find((row) => row.batchId === batchId && row.paymentType === paymentType && !row.invoiceId) || null
    },
    async findPostingByKey(batchId, key) {
      const found = postings.find((row) => sameKey(row, { ...key, batchId }))
      return found ? { ...found } : null
    },
    async insertPosting(row) {
      const found = postings.find((r) => sameKey(r, row))
      if (found) return { ...found }
      const next = { id: nextId++, status: 'posted', mappingSnapshot: {}, ...row }
      postings.push(next)
      return { ...next }
    },
    async beginPosting(row) {
      const found = postings.find((r) => sameKey(r, row))
      if (!found) {
        const next = { id: nextId++, ...row, zohoPaymentId: '', status: 'pending', errorMessage: '' }
        postings.push(next)
        return { ...next }
      }
      if (found.status === 'failed') {
        Object.assign(found, row, { id: found.id, status: 'pending', errorMessage: '', zohoPaymentId: '' })
        return { ...found }
      }
      const err = new Error(`Posting ${row.paymentType} is already ${found.status}`)
      err.code = 'AMAZON_PAYMENT_CLEARING_POSTING_CONFLICT'
      err.status = 409
      throw err
    },
    async updatePostingOutcome(id, outcome) {
      const found = postings.find((row) => row.id === id)
      if (!found) throw new Error(`posting ${id} missing`)
      found.status = outcome.status
      if (outcome.zohoPaymentId) found.zohoPaymentId = outcome.zohoPaymentId
      if (outcome.zohoJournalNumber) found.zohoJournalNumber = outcome.zohoJournalNumber
      found.errorMessage = outcome.errorMessage || ''
      found.mappingSnapshot = { ...(found.mappingSnapshot || {}), ...(outcome.snapshotPatch || {}) }
      return { ...found }
    },
    async markBatchPosted(_batchId, postedBy) {
      fake.postedBy = postedBy
      fake.markedPosted += 1
      return { status: 'posted', postedBy }
    },
    async markFeeJournalMappingsUsed(ids) {
      fake.usedMappingIds = ids
      return Array.isArray(ids) ? ids.length : 0
    },
    async insertClearingAudit(row) {
      audits.push(row)
      return row
    },
  }
  return fake
}

const KSA_TEST_ENV = Object.freeze({
  AMAZON_KSA_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID: 'acct-1024',
  AMAZON_KSA_ZOHO_COMMISSION_ACCOUNT_ID: 'acct-1026',
  AMAZON_KSA_ZOHO_SHIPPING_FBA_ACCOUNT_ID: 'acct-1028',
})

module.exports = { createFakeZoho, createFakePostingStore, KSA_TEST_ENV, timeoutError }

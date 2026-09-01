const {
  listCreditNoteRefunds,
  refundCreditNote,
  listBankAccounts,
} = require('../../integrations/zoho/zohoBooksClient')
const { buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { positiveAmount } = require('./noonPaymentClearingRowPredicates')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const {
  buildReturnDescription,
  buildNoonReturnFeeBreakdown,
  collectReturnRows,
  TOLERANCE,
} = require('./noonPaymentClearingReturnService')
const store = require('./noonPaymentClearingStore')
const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')

const PAYMENT_TYPE = 'credit_note_refund'

/** Zoho CN refunds only accept Banking accounts (bank/cash). CoA 1066 as other asset → error 11016. */
let cachedRefundBankAccount = null

function bankAccountId(row) {
  return clean(row?.account_id || row?.accountId || row?.bankaccount_id || row?.bank_account_id || row?.id)
}

function bankAccountName(row) {
  return clean(row?.account_name || row?.accountName || row?.bankaccount_name || row?.bank_account_name || row?.name)
}

/**
 * Resolve a Zoho Banking account for credit-note refunds.
 * Prefer explicit bank env, then bank list match on Noon Undeposited name/code, then configured id if it is a bank.
 */
async function resolveCreditNoteRefundBankAccount(opts = {}) {
  if (cachedRefundBankAccount?.accountId && !opts.forceRefresh) return cachedRefundBankAccount

  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const undeposited = cfg.undepositedFundsAccount || {}
  const explicitBankId = clean(
    process.env.NOON_AE_ZOHO_CN_REFUND_BANK_ACCOUNT_ID ||
      process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_BANK_ACCOUNT_ID ||
      ''
  )
  const listBanks = opts.listBankAccounts || listBankAccounts
  let banks = []
  try {
    banks = await listBanks()
  } catch (err) {
    banks = []
    if (!explicitBankId && !clean(undeposited.accountId)) {
      const e = new Error(
        `Cannot list Zoho bank accounts for CN refunds: ${err.message || err}. Set NOON_AE_ZOHO_CN_REFUND_BANK_ACCOUNT_ID to a Banking account.`
      )
      e.code = 'NOON_CN_REFUND_BANK_ACCOUNT_UNRESOLVED'
      e.status = 422
      throw e
    }
  }

  const byId = new Map()
  for (const row of banks) {
    const id = bankAccountId(row)
    if (id) byId.set(id, row)
  }

  const targetName = clean(undeposited.accountName || 'Noon Undeposited Funds').toLowerCase()
  const targetCode = clean(undeposited.accountCode || '1066')

  let chosen = null
  if (explicitBankId) {
    chosen = byId.get(explicitBankId) || { account_id: explicitBankId, account_name: undeposited.accountName }
  }
  if (!chosen && clean(undeposited.accountId) && byId.has(clean(undeposited.accountId))) {
    chosen = byId.get(clean(undeposited.accountId))
  }
  if (!chosen) {
    chosen =
      banks.find((row) => bankAccountName(row).toLowerCase() === targetName) ||
      banks.find((row) => bankAccountName(row).toLowerCase().includes('noon') && bankAccountName(row).toLowerCase().includes('undeposited')) ||
      banks.find((row) => clean(row?.account_code || row?.accountCode) === targetCode) ||
      null
  }

  const accountId = bankAccountId(chosen)
  if (!accountId) {
    const e = new Error(
      `Zoho CN refund needs a Banking account (cash/bank), not CoA GL ${targetCode}. ` +
        `Create/open "Noon Undeposited Funds" under Banking, or set NOON_AE_ZOHO_CN_REFUND_BANK_ACCOUNT_ID. ` +
        `(Zoho 11016 = involved account types are not applicable.)`
    )
    e.code = 'NOON_CN_REFUND_BANK_ACCOUNT_UNRESOLVED'
    e.status = 422
    throw e
  }

  cachedRefundBankAccount = {
    accountId,
    accountName: bankAccountName(chosen) || undeposited.accountName || 'Noon Undeposited Funds',
    accountCode: clean(chosen?.account_code || chosen?.accountCode || undeposited.accountCode || '1066'),
    source: explicitBankId ? 'env' : 'bankaccounts',
  }
  return cachedRefundBankAccount
}

async function creditNoteRefundTotal(creditNoteId, referenceNumber = '', listRefunds = listCreditNoteRefunds) {
  const refunds = await listRefunds(creditNoteId)
  const refKey = clean(referenceNumber)
  let total = 0
  for (const row of refunds) {
    const rowRef = clean(row.reference_number || row.referenceNumber)
    if (refKey && rowRef && rowRef !== refKey) continue
    total = round2(total + num(row.amount ?? row.amount_bcy ?? row.amount_fcy))
  }
  return total
}

function resolveProductRefundAmount(row, batch) {
  const fromProduct = positiveAmount(row.productRefundAmount)
  if (fromProduct >= TOLERANCE) return fromProduct
  const fromCn = positiveAmount(row.creditNoteAmount)
  if (fromCn >= TOLERANCE) return fromCn
  const itemKey = clean(row.itemOrderId)
  if (!itemKey) return 0
  const returnRow = collectReturnRows(batch?.allRows || []).find(
    (candidate) => clean(candidate.itemOrderId) === itemKey
  )
  if (returnRow) {
    return buildNoonReturnFeeBreakdown(returnRow).productRefundAmount
  }
  const refundRow = (batch?.refundReturnRows || []).find(
    (candidate) => clean(candidate.itemOrderId) === itemKey
  )
  return positiveAmount(refundRow?.productRefundAmount)
}

function collectReturnRowsForApply(batch) {
  const byItem = new Map()
  for (const row of batch?.refundReturnRows || []) {
    const key = clean(row.itemOrderId)
    if (!key) continue
    byItem.set(key, { ...byItem.get(key), ...row, itemOrderId: key })
  }
  for (const row of batch?.matchedReturns || []) {
    const key = clean(row.itemOrderId)
    if (!key) continue
    const existing = byItem.get(key) || {}
    byItem.set(key, {
      ...existing,
      ...row,
      itemOrderId: key,
      productRefundAmount:
        positiveAmount(row.productRefundAmount) >= TOLERANCE
          ? row.productRefundAmount
          : existing.productRefundAmount,
      creditNoteAmount:
        positiveAmount(row.creditNoteAmount) >= TOLERANCE
          ? row.creditNoteAmount
          : existing.creditNoteAmount,
      zohoInvoiceId: clean(row.zohoInvoiceId) || clean(existing.zohoInvoiceId),
      zohoCreditNoteId: clean(row.zohoCreditNoteId) || clean(existing.zohoCreditNoteId),
    })
  }
  return [...byItem.values()]
}

async function resolvePlanRowAction(row, batch, opts = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const undeposited = cfg.undepositedFundsAccount
  const creditNoteId = clean(row.zohoCreditNoteId)
  const invoiceId = clean(row.zohoInvoiceId)
  const refundAmount = resolveProductRefundAmount(row, batch)
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const itemOrderId = clean(row.itemOrderId)
  const referenceNumber = buildEntryReference(metadata, 'noon_return', itemOrderId)
  const description = buildReturnDescription(
    { itemOrderId, netProceed: -refundAmount },
    metadata,
    'return'
  )

  const baseFields = {
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: clean(row.parentOrderId),
    productRefundAmount: refundAmount,
    creditNoteAmount: positiveAmount(row.creditNoteAmount),
    zohoInvoiceId: invoiceId,
    zohoInvoiceNumber: row.zohoInvoiceNumber || '',
    zohoCreditNoteId: creditNoteId,
    zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
    refundAccountCode: undeposited.accountCode,
    refundAccountName: undeposited.accountName,
    referenceNumber,
    description,
    blockCode: row.blockCode || '',
    blockingReason: row.blockingReason || '',
  }

  if (row.status === 'blocked' || row.creditNoteAction === 'blocked') {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: row.blockingReason || row.blockCode || 'Return credit note matching blocked.',
      refundAmount,
    }
  }

  if (!creditNoteId) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'No Zoho Credit Note found for this return.',
      refundAmount,
    }
  }

  if (!invoiceId) {
    // Zoho CN refund API needs only creditnote_id; invoice link is audit metadata.
    baseFields.zohoInvoiceId = ''
  }

  if (refundAmount <= TOLERANCE) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'Product refund amount is zero.',
      refundAmount,
    }
  }

  const existing = await store.findGroupedPosting(
    batch.batchId,
    PAYMENT_TYPE,
    `${PAYMENT_TYPE}:${itemOrderId}`
  )
  if (existing?.status === 'posted') {
    return {
      ...baseFields,
      action: 'skipped_already_posted',
      status: 'completed',
      refundAmount,
      zohoPaymentId: existing.zohoPaymentId,
    }
  }

  const listRefunds = opts.listRefunds || listCreditNoteRefunds
  const refunded = await creditNoteRefundTotal(creditNoteId, referenceNumber, listRefunds)
  if (refunded >= refundAmount - TOLERANCE) {
    return {
      ...baseFields,
      action: 'skipped_already_refunded',
      status: 'completed',
      refundAmount,
      amountAlreadyRefunded: refunded,
      blockCode: 'RETURN_CREDIT_NOTE_ALREADY_REFUNDED',
    }
  }

  const remaining = round2(refundAmount - refunded)
  let bankAccount
  try {
    bankAccount = await resolveCreditNoteRefundBankAccount(opts)
  } catch (err) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: err.message || String(err),
      blockCode: err.code || 'NOON_CN_REFUND_BANK_ACCOUNT_UNRESOLVED',
      refundAmount: remaining,
    }
  }
  const accountId = clean(bankAccount.accountId)
  return {
    ...baseFields,
    action: 'refund_existing',
    status: 'ready',
    refundAmount: remaining,
    amountAlreadyRefunded: refunded,
    refundAccountId: accountId,
    refundAccountCode: bankAccount.accountCode || undeposited.accountCode,
    refundAccountName: bankAccount.accountName || undeposited.accountName,
    zohoRefundRequest: {
      date: opts.paymentDate || zohoPaymentService.todayLocalDate(),
      refund_mode: 'Bank Transfer',
      reference_number: referenceNumber,
      amount: remaining,
      from_account_id: accountId,
      description,
    },
  }
}

async function buildCreditNoteApplyPlan(batch, opts = {}) {
  const rows = collectReturnRowsForApply(batch)
  const planRows = []
  for (const row of rows) {
    planRows.push(await resolvePlanRowAction(row, batch, opts))
  }
  const summary = planRows.reduce(
    (acc, row) => {
      acc.totalRows += 1
      if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_posted') {
        acc.skipped += 1
      }
      if (row.action === 'refund_existing') acc.refundExisting += 1
      if (row.action === 'blocked') acc.blocked += 1
      acc.totalRefundAmount = round2(acc.totalRefundAmount + num(row.refundAmount))
      return acc
    },
    { totalRows: 0, refundExisting: 0, skipped: 0, blocked: 0, totalRefundAmount: 0 }
  )
  const complete = planRows.every(
    (row) =>
      row.action === 'skipped_already_refunded' ||
      row.action === 'skipped_already_posted' ||
      row.status === 'completed'
  )
  return { planRows, summary, complete, paymentType: PAYMENT_TYPE }
}

async function applyCreditNotesForBatch(batch, opts = {}) {
  const dryRun = opts.dryRun !== false
  const plan = await buildCreditNoteApplyPlan(batch, opts)
  const results = []

  for (const row of plan.planRows) {
    if (row.action === 'blocked') {
      results.push({ ...row, posted: false, error: row.blockingReason })
      continue
    }
    if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_posted') {
      results.push({ ...row, posted: false, skipped: true })
      continue
    }
    if (row.action !== 'refund_existing') {
      results.push({ ...row, posted: false })
      continue
    }
    if (dryRun) {
      results.push({ ...row, posted: false, dryRun: true })
      continue
    }

    let refund
    try {
      refund = await refundCreditNote(row.zohoCreditNoteId, row.zohoRefundRequest)
    } catch (err) {
      results.push({ ...row, posted: false, error: err.message || String(err) })
      continue
    }

    // The refund already exists in Zoho at this point. A failure to record it
    // locally must not be reported as a failed refund, or a retry looks safe
    // when it would actually be a second refund.
    try {
      await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: row.zohoInvoiceId,
        itemOrderId: row.itemOrderId,
        paymentType: PAYMENT_TYPE,
        postingGroupKey: `${PAYMENT_TYPE}:${row.itemOrderId}`,
        zohoPaymentId: clean(refund?.creditnote_refund_id || refund?.refund_id || refund?.payment_id),
        amount: row.refundAmount,
        accountCode: row.refundAccountCode,
        referenceNumber: row.referenceNumber,
        description: row.description,
        mappingSnapshot: { zohoRefundRequest: row.zohoRefundRequest, zohoResponse: refund },
        status: 'posted',
      })
      results.push({ ...row, posted: true, zohoRefundId: refund })
    } catch (err) {
      results.push({
        ...row,
        posted: true,
        zohoRefundId: refund,
        warning: `Refunded in Zoho but not recorded locally: ${err.message || String(err)}`,
      })
    }
  }

  return { plan, results, dryRun }
}

function isCreditNoteApplyComplete(batch, plan = null) {
  if (!plan) return false
  const rows = plan.planRows || []
  if (!rows.length) return true
  return rows.every(
    (row) =>
      row.action !== 'refund_existing' &&
      row.action !== 'blocked' &&
      (row.action === 'skipped_already_refunded' ||
        row.action === 'skipped_already_posted' ||
        row.status === 'completed' ||
        row.posted === true)
  )
}

module.exports = {
  PAYMENT_TYPE,
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
  creditNoteRefundTotal,
  collectReturnRowsForApply,
  resolveCreditNoteRefundBankAccount,
}

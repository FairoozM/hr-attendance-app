const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')
const { fetchInvoicesByIds, invoiceBalanceDue } = require('../../integrations/zoho/zohoBooksClient')
const { round2, clean } = require('./noonPaymentClearingCategoryService')
const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE, assertNoStatementOverpayments } = require('./noonPaymentClearingPaymentPreviewService')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference, buildEntryReference, truncateZohoReference } = require('./noonPaymentClearingReferenceService')
const store = require('./noonPaymentClearingStore')

const chartAccountCache = { at: 0, rows: null }

const PAYMENT_TYPES = Object.freeze({
  NET_BALANCE: 'net_balance',
  COMMISSION: 'commission',
  FULFILLMENT_SHIPPING: 'fulfillment_shipping',
})

/** Fees first, net last — keeps invoice balance for 1067/1068 before residual 1066. */
const PAYMENT_POST_ORDER = [
  PAYMENT_TYPES.COMMISSION,
  PAYMENT_TYPES.FULFILLMENT_SHIPPING,
  PAYMENT_TYPES.NET_BALANCE,
]

function sortPaymentPostingRows(rows = []) {
  const rank = new Map(PAYMENT_POST_ORDER.map((t, i) => [t, i]))
  return [...rows].sort((a, b) => {
    const ra = rank.has(a.paymentType) ? rank.get(a.paymentType) : 50
    const rb = rank.has(b.paymentType) ? rank.get(b.paymentType) : 50
    if (ra !== rb) return ra - rb
    return String(a.paymentType || '').localeCompare(String(b.paymentType || ''))
  })
}

async function resolveNoonGlAccount(account = {}) {
  const accountId = clean(account.accountId)
  const accountCode = clean(account.accountCode)
  const accountName = clean(account.accountName)
  if (accountId) {
    return { accountId, accountName, accountCode }
  }
  if (!accountCode && !accountName) {
    return { accountId: '', accountName, accountCode }
  }
  try {
    const now = Date.now()
    if (!chartAccountCache.rows || now - chartAccountCache.at > 5 * 60 * 1000) {
      chartAccountCache.rows = await zohoPaymentService.listZohoChartAccounts()
      chartAccountCache.at = now
    }
    const hit = (chartAccountCache.rows || []).find((a) => {
      const aCode = clean(a.accountCode || a.account_code)
      const aName = clean(a.accountName || a.account_name)
      return (accountCode && aCode === accountCode) || (accountName && aName === accountName)
    })
    if (hit) {
      return {
        accountId: clean(hit.accountId || hit.account_id),
        accountName: clean(hit.accountName || hit.account_name) || accountName,
        accountCode: clean(hit.accountCode || hit.account_code) || accountCode,
      }
    }
  } catch (err) {
    console.warn('[noon-payment-clearing] chart account resolve failed:', err?.message || err)
  }
  return { accountId: '', accountName, accountCode }
}

async function enrichJournalLineItems(lineItems = []) {
  const out = []
  for (const item of Array.isArray(lineItems) ? lineItems : []) {
    const resolved = await resolveNoonGlAccount(item)
    out.push({
      accountId: resolved.accountId,
      accountName: resolved.accountName || clean(item.accountName),
      accountCode: resolved.accountCode || clean(item.accountCode),
      debitOrCredit: item.debitOrCredit,
      amount: item.amount,
    })
  }
  return out
}

/**
 * A live-balance block at post time must never be a dead end: persist the shortfalls
 * into the Step 6 (open balance reconcile) state so the user immediately gets the
 * Exclude buttons there, then rethrow with directions.
 */
async function surfaceOpenBalanceBlockInStep6(batch, paymentPreview, err) {
  const shortfalls = Array.isArray(paymentPreview?.invoiceBalanceShortfalls)
    ? paymentPreview.invoiceBalanceShortfalls
    : []
  if (err?.code !== 'NOON_PAYMENT_CLEARING_INVOICE_BALANCE_SHORT' || !shortfalls.length) throw err
  try {
    const snap = batch.reportSnapshot?.openBalanceReconcile || {}
    await store.updateBatchOpenBalanceReconcile(batch.batchId, {
      blockingIssues: [
        ...(batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT'),
        ...shortfalls.map((s) => ({
          code: 'OPEN_BALANCE_SHORT',
          severity: 'error',
          itemOrderId: s.itemOrderId,
          zohoInvoiceId: s.zohoInvoiceId,
          zohoInvoiceNumber: s.zohoInvoiceNumber,
          openBalance: s.openBalance,
          totalClearingAmount: s.totalClearingAmount,
          overBy: s.overBy,
          message: `${s.zohoInvoiceNumber || s.itemOrderId}: clearing ${s.totalClearingAmount} > open balance ${s.openBalance} (over by ${s.overBy}).`,
        })),
      ],
      openBalanceReconcile: {
        ...snap,
        checkedAt: new Date().toISOString(),
        shortfalls,
      },
    })
  } catch (persistErr) {
    console.warn('[noon-payment-clearing] could not persist post-time shortfalls:', persistErr?.message || persistErr)
  }
  err.message +=
    ' The blocked invoice(s) are now listed in Step 6 (Parent Charges & Open Balance) — exclude them there if they are already paid, or void the existing Zoho payments, then retry. If the previous post already succeeded in Zoho, no repost is needed.'
  throw err
}

async function ensureCanPostBatch(batch, paymentPreviewExists, options = {}) {
  const dryRun = options.dryRun !== false
  const allowPosted = options.allowPosted === true
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status === 'posted' && !dryRun && !allowPosted) {
    const err = new Error('Noon statement has already been posted.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }
  const postedButAllowed = batch.status === 'posted' && (dryRun || allowPosted)
  if (batch.status !== 'approved' && !postedButAllowed) {
    const err = new Error('Posting requires an approved Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary, PAYMENT_PREVIEW_TOLERANCE)) {
    const err = new Error('Posting requires a reconciled Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Posting requires zero unmatched item orders.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (!paymentPreviewExists) {
    const err = new Error('Posting requires a generated payment preview.')
    err.code = 'NOON_PAYMENT_CLEARING_PAYMENT_PREVIEW_REQUIRED'
    err.status = 422
    throw err
  }
  const feeLines = Array.isArray(options.feeJournalLines)
    ? options.feeJournalLines
    : Array.isArray(batch.feeJournalLines)
      ? batch.feeJournalLines
      : []
  if (!dryRun) {
    const unmapped = feeLines.filter((row) => row.mappingStatus === 'needs_mapping')
    if (unmapped.length > 0) {
      const err = new Error('Posting requires all Noon fee journal mappings to be mapped.')
      err.code = 'NOON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED'
      err.status = 422
      throw err
    }
    if (options.paymentPreview) {
      assertNoStatementOverpayments(options.paymentPreview)
    }
  }
}

function flattenInvoicePayments(paymentPreview) {
  const rows = []
  for (const payment of Array.isArray(paymentPreview?.invoicePayments) ? paymentPreview.invoicePayments : []) {
    if (!payment.zohoInvoiceId) continue
    if (payment.netBalancePayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.NET_BALANCE,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.netBalancePayment.amount,
        accountCode: payment.netBalancePayment.depositToAccountCode,
        accountName: payment.netBalancePayment.depositToAccountName,
        accountId: payment.netBalancePayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
    if (payment.commissionPayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.COMMISSION,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.commissionPayment.amount,
        accountCode: payment.commissionPayment.depositToAccountCode,
        accountName: payment.commissionPayment.depositToAccountName,
        accountId: payment.commissionPayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
    if (payment.fulfillmentPayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.FULFILLMENT_SHIPPING,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.fulfillmentPayment.amount,
        accountCode: payment.fulfillmentPayment.depositToAccountCode,
        accountName: payment.fulfillmentPayment.depositToAccountName,
        accountId: payment.fulfillmentPayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
  }
  return rows
}

function groupPayments(rows, customerId, paymentDate, metadata) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.paymentType)) {
      groups.set(row.paymentType, {
        paymentType: row.paymentType,
        amount: 0,
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountId: row.accountId,
        invoiceAllocations: [],
        _allocByInvoice: new Map(),
      })
    }
    const g = groups.get(row.paymentType)
    g.amount = round2(g.amount + row.amount)
    if (!g.accountId && row.accountId) g.accountId = row.accountId
    if (!g.accountName && row.accountName) g.accountName = row.accountName
    if (!g.accountCode && row.accountCode) g.accountCode = row.accountCode
    const invId = clean(row.invoiceId)
    if (!invId) continue
    const prev = g._allocByInvoice.get(invId)
    if (prev) {
      // Same Zoho invoice must appear once — duplicate lines sum past balance due (Zoho 24016).
      prev.amountApplied = round2((Number(prev.amountApplied) || 0) + (Number(row.amount) || 0))
      if (!prev.orderId && row.itemOrderId) prev.orderId = row.itemOrderId
      if (!prev.invoiceNumber && row.invoiceNumber) prev.invoiceNumber = row.invoiceNumber
    } else {
      const alloc = {
        invoiceId: invId,
        invoiceNumber: row.invoiceNumber,
        orderId: row.itemOrderId,
        amountApplied: round2(Number(row.amount) || 0),
      }
      g._allocByInvoice.set(invId, alloc)
      g.invoiceAllocations.push(alloc)
    }
  }
  return Array.from(groups.values()).map((group) => {
    delete group._allocByInvoice
    const referenceNumber = buildEntryReference(metadata, group.paymentType)
    return {
      ...group,
      postingGroupKey: group.paymentType,
      referenceNumber,
      description: `${buildSettlementReference(metadata)} ${group.paymentType}`,
      zohoPaymentRequest: {
        customerId,
        amount: group.amount,
        invoices: group.invoiceAllocations,
        depositToAccountCode: group.accountCode,
        depositToAccountName: group.accountName,
        depositToAccountId: group.accountId,
        paymentDate,
        referenceNumber,
        description: `${buildSettlementReference(metadata)} ${group.paymentType}`,
      },
    }
  })
}

/**
 * Skip only when the Zoho payment still exists with the expected amount.
 * Stale DB rows after a voided/deleted Zoho payment must be cleared and re-posted
 * (this caused only "commission" to appear after net_balance was deleted).
 */
async function resolveExistingPaymentSkip({
  batchId,
  row,
  getPayment = zohoPaymentService.getZohoCustomerPayment,
  clearPosting = null,
  findPosting = store.findGroupedPosting,
}) {
  const groupKey = clean(row.postingGroupKey) || null
  const existing = await findPosting(batchId, row.paymentType, groupKey)
  if (!existing || existing.status !== 'posted') {
    return { skip: false }
  }
  const clear = async () => {
    if (typeof clearPosting === 'function') {
      await clearPosting(batchId, row.paymentType)
      return
    }
    if (groupKey) {
      await store.clearPostingByGroupKey(batchId, groupKey)
    } else {
      await store.clearPostingForPaymentType(batchId, row.paymentType)
    }
  }
  const zohoPaymentId = clean(existing.zohoPaymentId)
  if (!zohoPaymentId) {
    await clear()
    return { skip: false, cleared: 'empty_zoho_payment_id' }
  }
  let payment = null
  try {
    payment = await getPayment(zohoPaymentId)
  } catch (err) {
    return {
      skip: false,
      error: `Could not verify Zoho payment ${zohoPaymentId} for ${row.paymentType}: ${err?.message || err}`,
      code: 'ZOHO_PAYMENT_VERIFY_FAILED',
    }
  }
  if (!payment) {
    await clear()
    return { skip: false, cleared: 'zoho_payment_missing' }
  }
  const zohoAmount = round2(Number(payment.amount ?? payment.total ?? payment.payment_amount ?? 0))
  if (Math.abs(zohoAmount - round2(row.amount)) > 0.05) {
    return {
      skip: false,
      error:
        `Zoho payment ${zohoPaymentId} (${row.paymentType}) still exists with amount ${zohoAmount}, ` +
        `but this preview needs ${round2(row.amount)}. Void that payment in Zoho, then post again.`,
      code: 'ZOHO_PAYMENT_AMOUNT_MISMATCH',
      zohoPaymentId,
    }
  }
  return { skip: true, existing, zohoPaymentId }
}

async function enrichPaymentGroupAccounts(postingRows) {
  for (const row of postingRows) {
    const resolved = await resolveNoonGlAccount({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
    })
    row.accountId = resolved.accountId || row.accountId
    row.accountName = resolved.accountName || row.accountName
    row.accountCode = resolved.accountCode || row.accountCode
    if (row.zohoPaymentRequest) {
      row.zohoPaymentRequest.depositToAccountId = row.accountId
      row.zohoPaymentRequest.depositToAccountName = row.accountName
      row.zohoPaymentRequest.depositToAccountCode = row.accountCode
    }
  }
  return postingRows
}

/**
 * Cap each invoice allocation to live Zoho balance due.
 * Drops zero-balance lines (common for orphan logistics on already-paid invoices)
 * so one dead line cannot kill the whole fulfillment_shipping payment.
 */
async function trimPaymentRowToLiveBalances(row, opts = {}) {
  const fetchByIds = opts.fetchInvoicesByIds || fetchInvoicesByIds
  const allocations = Array.isArray(row.invoiceAllocations) ? row.invoiceAllocations : []
  if (!allocations.length) {
    return { row, dropped: [], warnings: [] }
  }
  const invoiceMap = await fetchByIds(allocations.map((a) => a.invoiceId))
  const remainingByInvoice = new Map()
  const kept = []
  const dropped = []
  const warnings = []
  for (const alloc of allocations) {
    const wanted = round2(Number(alloc.amountApplied) || 0)
    if (wanted <= 0) continue
    const invId = clean(alloc.invoiceId)
    const invoice = invoiceMap.get(invId)
    let balance
    if (remainingByInvoice.has(invId)) {
      balance = remainingByInvoice.get(invId)
    } else {
      balance = invoiceBalanceDue(invoice)
      if (balance != null) remainingByInvoice.set(invId, balance)
    }
    if (balance == null) {
      // Could not read balance — keep allocation and let Zoho accept/reject.
      kept.push({ ...alloc, amountApplied: wanted })
      warnings.push(`No live balance for invoice ${alloc.invoiceNumber || alloc.invoiceId}; posting planned ${wanted}`)
      continue
    }
    if (balance < 0.01) {
      dropped.push({
        ...alloc,
        amountApplied: wanted,
        balance,
        reason: 'Invoice has zero open balance (already paid) — cannot receive payment',
      })
      continue
    }
    const applied = round2(Math.min(wanted, balance))
    remainingByInvoice.set(invId, round2(balance - applied))
    if (applied + 0.009 < wanted) {
      warnings.push(
        `${alloc.invoiceNumber || alloc.invoiceId}: wanted ${wanted}, balance ${balance}, applying ${applied}`
      )
    }
    if (applied >= 0.01) {
      kept.push({ ...alloc, amountApplied: applied, balanceBefore: balance })
    } else {
      dropped.push({ ...alloc, amountApplied: wanted, balance, reason: 'Balance too small' })
    }
  }
  // One line per invoice (Zoho rejects duplicate invoice_id lines / over-applied totals).
  const merged = new Map()
  for (const alloc of kept) {
    const invId = clean(alloc.invoiceId)
    const prev = merged.get(invId)
    if (prev) {
      prev.amountApplied = round2((Number(prev.amountApplied) || 0) + (Number(alloc.amountApplied) || 0))
    } else {
      merged.set(invId, { ...alloc })
    }
  }
  const mergedKept = Array.from(merged.values())
  const amount = round2(mergedKept.reduce((sum, a) => sum + (Number(a.amountApplied) || 0), 0))
  const next = {
    ...row,
    amount,
    invoiceAllocations: mergedKept,
    droppedAllocations: dropped,
    balanceWarnings: warnings,
    zohoPaymentRequest: {
      ...row.zohoPaymentRequest,
      amount,
      invoices: mergedKept,
    },
  }
  return { row: next, dropped, warnings }
}

function splitPaymentRowPerInvoice(row) {
  return (Array.isArray(row.invoiceAllocations) ? row.invoiceAllocations : [])
    .filter((a) => round2(Number(a.amountApplied) || 0) >= 0.01)
    .map((alloc, idx) => {
      const amount = round2(Number(alloc.amountApplied) || 0)
      const referenceNumber = truncateZohoReference(
        `${row.referenceNumber || row.paymentType}-${idx + 1}`
      )
      return {
        ...row,
        amount,
        postingGroupKey: `${row.postingGroupKey || row.paymentType}:${alloc.invoiceId}`,
        referenceNumber,
        invoiceAllocations: [alloc],
        zohoPaymentRequest: {
          ...row.zohoPaymentRequest,
          amount,
          invoices: [alloc],
          referenceNumber,
          description: `${row.description || row.paymentType} ${alloc.invoiceNumber || alloc.invoiceId}`,
        },
      }
    })
}

function paymentTypePostedOrSkipped(result, paymentType) {
  return (result.payments || []).some(
    (p) =>
      p.paymentType === paymentType &&
      (p.status === 'posted' || p.status === 'skipped' || p.status === 'dry_run')
  )
}

function evaluatePaymentCompleteness(result, postingRows, { dryRun }) {
  const requiredTypes = [...new Set((postingRows || []).map((r) => r.paymentType).filter(Boolean))]
  const missing = []
  for (const paymentType of requiredTypes) {
    const rows = (result.payments || []).filter((p) => p.paymentType === paymentType)
    const ok = rows.some(
      (row) =>
        row.status === 'posted' ||
        row.status === 'skipped' ||
        (dryRun && row.status === 'dry_run')
    )
    if (!ok) missing.push(paymentType)
  }
  return { requiredTypes, missing }
}

async function postApprovedBatch({
  batch,
  dryRun = true,
  allowPosted = false,
  postedBy,
  mappingRules = [],
  settlementBridgeAccount = null,
  inputVatAccount = null,
  commissionExpenseAccount = null,
  shippingExpenseAccount = null,
  unclearedCommissionAccount = null,
  unclearedShippingAccount = null,
  marketplaceConfig = null,
  createPayment = zohoPaymentService.createZohoCustomerPayment,
  buildPayloadPreview = zohoPaymentService.buildCustomerPaymentPayloadPreview,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
} = {}) {
  const latestPreview = await store.getLatestPaymentPreviewForBatch(batch.batchId)
  let paymentPreview = buildPaymentPreviewFromBatch(batch, mappingRules, inputVatAccount, {
    commissionExpenseAccount,
    shippingExpenseAccount,
    unclearedCommissionAccount,
    unclearedShippingAccount,
    inputVatAccount,
    paymentPreviewAccounts: marketplaceConfig?.paymentPreviewAccounts,
    vatRate: inputVatAccount?.vatRate,
  })
  if (!dryRun) {
    assertNoStatementOverpayments(paymentPreview)
  }
  const feeJournalLines = Array.isArray(paymentPreview.feeJournalLines) ? paymentPreview.feeJournalLines : []
  const unclearedReclassJournals = Array.isArray(paymentPreview.unclearedReclassJournals)
    ? paymentPreview.unclearedReclassJournals
    : []
  await ensureCanPostBatch(batch, Boolean(latestPreview), {
    dryRun,
    allowPosted,
    feeJournalLines: [...feeJournalLines, ...unclearedReclassJournals],
    paymentPreview,
  })
  const paymentRows = flattenInvoicePayments(paymentPreview)
  const customerId =
    clean(batch.zohoCustomerId) ||
    clean(paymentRows[0]?.customerId) ||
    ''
  if (paymentRows.length && !customerId) {
    const err = new Error('Grouped Zoho posting requires a Zoho customer ID.')
    err.code = 'NOON_PAYMENT_CLEARING_CUSTOMER_ID_MISSING'
    err.status = 422
    throw err
  }
  const paymentDate = zohoPaymentService.todayLocalDate()
  const metadata = batch.reportSnapshot || batch.metadata || {}
  let postingRows = paymentRows.length ? groupPayments(paymentRows, customerId, paymentDate, metadata) : []
  postingRows = await enrichPaymentGroupAccounts(postingRows)
  postingRows = sortPaymentPostingRows(postingRows)
  const settlementReference = buildSettlementReference(metadata)
  const journalLinesToPost = [
    ...feeJournalLines.map((line, idx) => ({
      ...line,
      paymentType: `fee_journal_${idx + 1}`,
    })),
    ...unclearedReclassJournals.map((line) => ({
      ...line,
      paymentType: line.paymentType || `uncleared_reclass_${line.feeType}`,
    })),
  ]
  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    message: '',
    summary: {
      invoicesPosted: new Set(paymentRows.map((r) => r.invoiceId)).size,
      paymentsCreated: 0,
      paymentsSkipped: 0,
      journalsCreated: 0,
      journalsSkipped: 0,
      errors: 0,
      requiredPaymentTypes: 0,
      missingPaymentTypes: 0,
    },
    payments: [],
    journals: [],
    errors: [],
    zohoPaymentIds: [],
    zohoJournalIds: [],
  }

  const run = async () => {
    const postOnePayment = async (row) => {
      if (!dryRun) {
        const existingDecision = await resolveExistingPaymentSkip({
          batchId: batch.batchId,
          row,
          getPayment: zohoPaymentService.getZohoCustomerPayment,
        })
        if (existingDecision.error) {
          result.summary.errors += 1
          const error = {
            ...row,
            status: 'error',
            error: existingDecision.error,
            code: existingDecision.code || 'ZOHO_PAYMENT_STALE',
            zohoPaymentId: existingDecision.zohoPaymentId || '',
          }
          result.errors.push(error)
          result.payments.push(error)
          return { ok: false }
        }
        if (existingDecision.skip) {
          result.summary.paymentsSkipped += 1
          result.payments.push({
            ...row,
            status: 'skipped',
            zohoPaymentId: existingDecision.zohoPaymentId || existingDecision.existing?.zohoPaymentId,
            reason: 'Already posted in Zoho for batch/payment type (verified).',
          })
          return { ok: true, skipped: true }
        }
      }

      let working = row
      if (!dryRun) {
        const trimmed = await trimPaymentRowToLiveBalances(row)
        working = trimmed.row
        if ((trimmed.dropped || []).length) {
          result.payments.push({
            paymentType: row.paymentType,
            status: 'warning',
            reason: `Dropped ${trimmed.dropped.length} invoice allocation(s) with no open Zoho balance`,
            droppedAllocations: trimmed.dropped,
          })
        }
        if (round2(working.amount) < 0.01) {
          result.summary.paymentsSkipped += 1
          result.payments.push({
            ...row,
            status: 'skipped',
            reason:
              'No open Zoho balance for this payment bucket (invoice(s) already paid or excluded in Step 6).',
            droppedAllocations: trimmed.dropped,
          })
          return { ok: true, skipped: true }
        }
        if (round2(working.amount) + 0.05 < round2(row.amount)) {
          result.payments.push({
            paymentType: row.paymentType,
            status: 'warning',
            reason: `Posting ${round2(working.amount)} of planned ${round2(row.amount)} — some invoices had no open balance`,
            plannedAmount: round2(row.amount),
            openBalanceAmount: round2(working.amount),
            droppedAllocations: trimmed.dropped,
          })
        }
      }

      let zohoPayloadPreview = null
      try {
        zohoPayloadPreview = await buildPayloadPreview(working.zohoPaymentRequest)
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...working,
          status: 'error',
          error: err?.message || 'Failed to build payment payload',
          code: err?.code || 'ZOHO_PAYMENT_PREVIEW_FAILED',
        }
        result.errors.push(error)
        result.payments.push(error)
        return { ok: false }
      }
      if (dryRun) {
        result.summary.paymentsCreated += 1
        result.payments.push({ ...working, status: 'dry_run', zohoPaymentId: '', zohoPayloadPreview })
        return { ok: true }
      }
      try {
        const created = await createPayment(working.zohoPaymentRequest)
        const zohoPaymentId = clean(
          created?.zohoPaymentId || created?.payment_id || created?.paymentId || created?.id
        )
        await store.insertPosting({
          batchId: batch.batchId,
          invoiceId: null,
          itemOrderId: null,
          paymentType: working.paymentType,
          postingGroupKey: working.postingGroupKey,
          zohoPaymentId,
          amount: working.amount,
          accountCode: working.accountCode,
          invoiceAllocations: working.invoiceAllocations,
          referenceNumber: working.referenceNumber,
          description: working.description,
          status: 'posted',
        })
        result.summary.paymentsCreated += 1
        result.zohoPaymentIds.push({ zohoPaymentId, referenceNumber: working.referenceNumber })
        result.payments.push({ ...working, status: 'posted', zohoPaymentId })
        return { ok: true, zohoPaymentId }
      } catch (err) {
        return {
          ok: false,
          error: err,
          working,
          zohoPayloadPreview,
        }
      }
    }

    let stopPayments = false
    for (const row of postingRows) {
      if (stopPayments) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          error: `Skipped — earlier payment failed. Void any Noon payments already created for this statement, then Force repost.`,
          code: 'NOON_PAYMENT_CLEARING_ABORTED_AFTER_FAILURE',
        }
        result.errors.push(error)
        result.payments.push(error)
        continue
      }
      const outcome = await postOnePayment(row)
      if (outcome.ok) continue

      stopPayments = true
      // Do NOT split into per-invoice payments (that created dozens of ship-1/ship-2 rows).
      // Zero-balance invoices are already dropped in trimPaymentRowToLiveBalances;
      // if the grouped payment still fails, surface one clear error and abort the rest.
      if (outcome.error) {
        result.summary.errors += 1
        const error = {
          ...(outcome.working || row),
          status: 'error',
          error: outcome.error?.message || 'Zoho payment failed',
          code: outcome.error?.code || 'ZOHO_PAYMENT_FAILED',
          zohoPayloadPreview: outcome.zohoPayloadPreview,
        }
        result.errors.push(error)
        result.payments.push(error)
      }
    }

    for (const line of journalLinesToPost) {
      const paymentType = line.paymentType
      // Never reclass uncleared GLs until the Record Payments that fund 1067/1068 succeeded.
      if (line.isUnclearedReclass && !dryRun) {
        const fee = clean(line.feeType || paymentType).toUpperCase()
        const needsCommission = fee.includes('COMMISSION')
        const needsShipping = fee.includes('SHIPPING') || fee.includes('FULFILLMENT')
        if (needsCommission && !paymentTypePostedOrSkipped(result, PAYMENT_TYPES.COMMISSION)) {
          result.summary.errors += 1
          const error = {
            ...line,
            paymentType,
            status: 'error',
            error:
              'Blocked uncleared commission reclass journal — commission payment (1067) did not post. Void this journal if it was created earlier, then post payments first.',
          }
          result.errors.push(error)
          result.journals.push(error)
          continue
        }
        if (needsShipping && !paymentTypePostedOrSkipped(result, PAYMENT_TYPES.FULFILLMENT_SHIPPING)) {
          result.summary.errors += 1
          const error = {
            ...line,
            paymentType,
            status: 'error',
            error:
              'Blocked uncleared shipping reclass journal — shipping payment (1068) did not post. Void this journal if it was created earlier, then post payments first.',
          }
          result.errors.push(error)
          result.journals.push(error)
          continue
        }
      }
      const existing = await store.findGroupedPosting(batch.batchId, paymentType)
      // Dry run always previews the full journal plan — never hide advertising as "skipped"
      // just because a prior live post left a local row.
      if (existing && existing.status === 'posted' && !dryRun) {
        result.summary.journalsSkipped += 1
        result.journals.push({
          ...line,
          paymentType,
          status: 'skipped',
          zohoJournalId: existing.zohoPaymentId,
          reason:
            'Already posted for this batch (local record). Void that Zoho journal if it should be recreated, then Force repost.',
        })
        continue
      }
      if (line.mappingStatus === 'needs_mapping' && !dryRun) {
        result.summary.errors += 1
        const error = {
          ...line,
          paymentType,
          status: 'error',
          error: line.isUnclearedReclass
            ? 'Uncleared→expense reclass accounts not resolved (2143/2162/1085)'
            : 'Fee journal unmapped',
        }
        result.errors.push(error)
        result.journals.push(error)
        continue
      }
      const enrichedLineItems = await enrichJournalLineItems(
        Array.isArray(line.lineItems) ? line.lineItems : []
      )
      const debit = await resolveNoonGlAccount(line.debit || {})
      const credit = await resolveNoonGlAccount(line.credit || {})
      const journalRequest = {
        feeType: line.feeType,
        description: line.displayLabel || line.title || line.feeType,
        amount: line.amount,
        debit,
        credit,
        // Amazon-style: no customer on fee / uncleared-reclass journals
        customerId: '',
        lineItems: enrichedLineItems.length >= 2 ? enrichedLineItems : undefined,
        vatBreakdown: line.vatBreakdown || null,
        referenceNumber: buildEntryReference(metadata, line.feeType || paymentType),
        date: paymentDate,
      }
      let zohoPayloadPreview = null
      try {
        zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest)
      } catch (err) {
        // Still surface the planned journal on dry run — do not hide uncleared→expense work.
        if (dryRun) {
          result.summary.journalsCreated += 1
          result.journals.push({
            ...line,
            paymentType,
            status: 'dry_run',
            warning: err?.message || 'Journal account resolve failed; posting will need Zoho CoA IDs',
            zohoPayloadPreview: {
              line_items: (enrichedLineItems.length ? enrichedLineItems : line.lineItems || []).map((item) => ({
                account_id: item.accountId || '',
                account_name: item.accountName || '',
                account_code: item.accountCode || '',
                debit_or_credit: item.debitOrCredit,
                amount: item.amount,
              })),
            },
            lineItems: enrichedLineItems.length ? enrichedLineItems : line.lineItems,
          })
          continue
        }
        result.summary.errors += 1
        const error = {
          ...line,
          paymentType,
          status: 'error',
          error: err?.message || 'Journal preview failed',
        }
        result.errors.push(error)
        result.journals.push(error)
        continue
      }
      if (dryRun) {
        result.summary.journalsCreated += 1
        result.journals.push({
          ...line,
          paymentType,
          status: 'dry_run',
          zohoPayloadPreview,
          lineItems: enrichedLineItems.length ? enrichedLineItems : line.lineItems,
        })
        continue
      }
      try {
        const created = await createManualJournal(journalRequest)
        const zohoJournalId = clean(created?.journal_id || created?.journalId || created?.zohoJournalId || created?.id)
        const zohoJournalNumber = clean(created?.journal_number || created?.journalNumber || created?.zohoJournalNumber)
        await store.insertPosting({
          batchId: batch.batchId,
          paymentType,
          postingGroupKey: paymentType,
          zohoPaymentId: zohoJournalId,
          zohoJournalNumber,
          amount: line.amount,
          referenceNumber: journalRequest.referenceNumber,
          description: journalRequest.description,
          mappingSnapshot: {
            feeType: line.feeType,
            parentOrderId: line.parentOrderId,
            isUnclearedReclass: Boolean(line.isUnclearedReclass),
          },
          status: 'posted',
        })
        result.summary.journalsCreated += 1
        result.zohoJournalIds.push({ zohoJournalId, zohoJournalNumber })
        result.journals.push({ ...line, paymentType, status: 'posted', zohoJournalId, zohoJournalNumber })
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...line,
          paymentType,
          status: 'error',
          error: err?.message || 'Zoho journal failed',
        }
        result.errors.push(error)
        result.journals.push(error)
      }
    }

    const completeness = evaluatePaymentCompleteness(result, postingRows, { dryRun })
    result.summary.requiredPaymentTypes = completeness.requiredTypes.length
    result.summary.missingPaymentTypes = completeness.missing.length
    result.missingPaymentTypes = completeness.missing

    if (!dryRun && (result.summary.errors > 0 || completeness.missing.length > 0)) {
      result.success = false
      result.status = 'error'
      result.message =
        completeness.missing.length > 0
          ? `Incomplete Zoho posting. Missing payment type(s): ${completeness.missing.join(', ')}. ` +
            `Need net_balance (1066) + commission (1067) + fulfillment_shipping (1068). Fix errors and post again.`
          : `Zoho posting finished with ${result.summary.errors} error(s). Nothing was marked fully posted.`
    } else if (!dryRun && result.summary.errors === 0 && completeness.missing.length === 0) {
      await store.markBatchPosted(batch.batchId, postedBy, {
        reference: settlementReference,
        zohoPaymentIds: result.zohoPaymentIds,
        zohoJournalIds: result.zohoJournalIds,
        summary: result.summary,
      })
      result.status = 'posted'
      result.message = `Posted ${result.summary.paymentsCreated} payment(s) and ${result.summary.journalsCreated} journal(s) to Zoho.`
    } else if (dryRun) {
      result.message = `Dry run: ${result.summary.paymentsCreated} payment(s) and ${result.summary.journalsCreated} journal(s) ready.`
    }
    return result
  }

  if (dryRun) return run()
  return store.withBatchPostingLock(batch.batchId, run)
}

async function forceRepostBatch({
  batch,
  reason,
  actorUserId,
  mappingRules = [],
  settlementBridgeAccount = null,
  inputVatAccount = null,
  commissionExpenseAccount = null,
  shippingExpenseAccount = null,
  unclearedCommissionAccount = null,
  unclearedShippingAccount = null,
  marketplaceConfig = null,
}) {
  // Approved OR posted (including partial/stuck “already posted” DB rows).
  if (!batch || (batch.status !== 'approved' && batch.status !== 'posted' && !batch.postedToZoho)) {
    const err = new Error('Force repost requires an approved or previously posted Noon batch.')
    err.code = 'NOON_PAYMENT_CLEARING_FORCE_REPOST_NOT_ALLOWED'
    err.status = 422
    throw err
  }
  if (!clean(reason) || clean(reason).length < 4) {
    const err = new Error('Force repost requires a reason (min 4 characters).')
    err.code = 'NOON_PAYMENT_CLEARING_FORCE_REPOST_REASON'
    err.status = 422
    throw err
  }
  const prior = await store.listPostingsForBatch(batch.batchId)
  await store.insertAudit({
    batchId: batch.batchId,
    action: 'force_repost',
    reason,
    actorUserId,
    previousZohoPaymentIds: prior.map((p) => p.zohoPaymentId).filter(Boolean),
    details: {
      priorPaymentTypes: prior.map((p) => p.paymentType).filter(Boolean),
      priorStatus: batch.status,
    },
  })
  // Wipe local “already posted” rows so net_balance / shipping are not skipped.
  await store.clearPostingsForBatch(batch.batchId)
  await store.resetBatchToApprovedForRepost(batch.batchId)
  const refreshed = (await store.getBatchById(batch.batchId)) || { ...batch, status: 'approved', postedToZoho: false }
  return postApprovedBatch({
    batch: refreshed,
    dryRun: false,
    allowPosted: true,
    postedBy: actorUserId,
    mappingRules,
    settlementBridgeAccount,
    inputVatAccount,
    commissionExpenseAccount,
    shippingExpenseAccount,
    unclearedCommissionAccount,
    unclearedShippingAccount,
    marketplaceConfig,
  })
}

module.exports = {
  ensureCanPostBatch,
  surfaceOpenBalanceBlockInStep6,
  postApprovedBatch,
  forceRepostBatch,
  flattenInvoicePayments,
  resolveExistingPaymentSkip,
  evaluatePaymentCompleteness,
  trimPaymentRowToLiveBalances,
  sortPaymentPostingRows,
  splitPaymentRowPerInvoice,
  PAYMENT_TYPES,
  PAYMENT_POST_ORDER,
}

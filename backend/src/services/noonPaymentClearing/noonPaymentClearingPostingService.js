const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')
const { fetchInvoicesByIds, invoiceBalanceDue } = require('../../integrations/zoho/zohoBooksClient')
const { round2, clean } = require('./noonPaymentClearingCategoryService')
const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE } = require('./noonPaymentClearingPaymentPreviewService')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
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
      })
    }
    const g = groups.get(row.paymentType)
    g.amount = round2(g.amount + row.amount)
    if (!g.accountId && row.accountId) g.accountId = row.accountId
    if (!g.accountName && row.accountName) g.accountName = row.accountName
    if (!g.accountCode && row.accountCode) g.accountCode = row.accountCode
    g.invoiceAllocations.push({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      orderId: row.itemOrderId,
      amountApplied: row.amount,
    })
  }
  return Array.from(groups.values()).map((group) => {
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
  const kept = []
  const dropped = []
  const warnings = []
  for (const alloc of allocations) {
    const wanted = round2(Number(alloc.amountApplied) || 0)
    if (wanted <= 0) continue
    const invoice = invoiceMap.get(clean(alloc.invoiceId))
    const balance = invoiceBalanceDue(invoice)
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
  const amount = round2(kept.reduce((sum, a) => sum + (Number(a.amountApplied) || 0), 0))
  const next = {
    ...row,
    amount,
    invoiceAllocations: kept,
    droppedAllocations: dropped,
    balanceWarnings: warnings,
    zohoPaymentRequest: {
      ...row.zohoPaymentRequest,
      amount,
      invoices: kept,
    },
  }
  return { row: next, dropped, warnings }
}

function splitPaymentRowPerInvoice(row) {
  return (Array.isArray(row.invoiceAllocations) ? row.invoiceAllocations : [])
    .filter((a) => round2(Number(a.amountApplied) || 0) >= 0.01)
    .map((alloc, idx) => {
      const amount = round2(Number(alloc.amountApplied) || 0)
      const referenceNumber = `${row.referenceNumber || row.paymentType}-p${idx + 1}`
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
  const paymentPreview = buildPaymentPreviewFromBatch(batch, mappingRules, inputVatAccount, {
    commissionExpenseAccount,
    shippingExpenseAccount,
    unclearedCommissionAccount,
    unclearedShippingAccount,
    inputVatAccount,
    paymentPreviewAccounts: marketplaceConfig?.paymentPreviewAccounts,
    vatRate: inputVatAccount?.vatRate,
  })
  const feeJournalLines = Array.isArray(paymentPreview.feeJournalLines) ? paymentPreview.feeJournalLines : []
  const unclearedReclassJournals = Array.isArray(paymentPreview.unclearedReclassJournals)
    ? paymentPreview.unclearedReclassJournals
    : []
  await ensureCanPostBatch(batch, Boolean(latestPreview), {
    dryRun,
    allowPosted,
    feeJournalLines: [...feeJournalLines, ...unclearedReclassJournals],
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
          result.summary.errors += 1
          const error = {
            ...row,
            status: 'error',
            error:
              row.paymentType === PAYMENT_TYPES.FULFILLMENT_SHIPPING
                ? 'Shipping payment (1068) is 0 after balance check — invoices already fully paid or no open balance. Void net/commission over-payments or leave balance for shipping, then Force repost.'
                : `Payment ${row.paymentType} is 0 after live invoice balance check.`,
            code: 'ZOHO_PAYMENT_NO_OPEN_BALANCE',
            droppedAllocations: trimmed.dropped,
          }
          result.errors.push(error)
          result.payments.push(error)
          return { ok: false }
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

    for (const row of postingRows) {
      const outcome = await postOnePayment(row)
      if (outcome.ok) continue

      // One dead invoice must not kill the entire shipping bucket — retry per invoice.
      if (
        !dryRun &&
        row.paymentType === PAYMENT_TYPES.FULFILLMENT_SHIPPING &&
        outcome.error &&
        Array.isArray(row.invoiceAllocations) &&
        row.invoiceAllocations.length > 1
      ) {
        const splits = splitPaymentRowPerInvoice(outcome.working || row)
        let anyOk = false
        for (const piece of splits) {
          const pieceOut = await postOnePayment(piece)
          if (pieceOut.ok) anyOk = true
          else if (pieceOut.error) {
            result.summary.errors += 1
            const error = {
              ...piece,
              status: 'error',
              error: pieceOut.error?.message || outcome.error?.message || 'Zoho shipping payment failed',
              code: pieceOut.error?.code || outcome.error?.code || 'ZOHO_PAYMENT_FAILED',
            }
            result.errors.push(error)
            result.payments.push(error)
          }
        }
        if (!anyOk && outcome.error) {
          result.summary.errors += 1
          const error = {
            ...row,
            status: 'error',
            error:
              (outcome.error?.message || 'Zoho fulfillment_shipping payment failed') +
              ' — also failed when split per invoice.',
            code: outcome.error?.code || 'ZOHO_PAYMENT_FAILED',
          }
          result.errors.push(error)
          result.payments.push(error)
        }
        continue
      }

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
      const existing = await store.findGroupedPosting(batch.batchId, paymentType)
      if (existing && existing.status === 'posted') {
        result.summary.journalsSkipped += 1
        result.journals.push({
          ...line,
          paymentType,
          status: 'skipped',
          zohoJournalId: existing.zohoPaymentId,
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

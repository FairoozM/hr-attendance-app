const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')
const { round2, clean } = require('./noonPaymentClearingCategoryService')
const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE } = require('./noonPaymentClearingPaymentPreviewService')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const store = require('./noonPaymentClearingStore')

const chartAccountCache = { at: 0, rows: null }

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
const PAYMENT_TYPES = Object.freeze({
  NET_BALANCE: 'net_balance',
  COMMISSION: 'commission',
  FULFILLMENT_SHIPPING: 'fulfillment_shipping',
})

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
  clearPosting = store.clearPostingForPaymentType,
  findPosting = store.findGroupedPosting,
}) {
  const existing = await findPosting(batchId, row.paymentType)
  if (!existing || existing.status !== 'posted') {
    return { skip: false }
  }
  const zohoPaymentId = clean(existing.zohoPaymentId)
  if (!zohoPaymentId) {
    await clearPosting(batchId, row.paymentType)
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
    await clearPosting(batchId, row.paymentType)
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

function evaluatePaymentCompleteness(result, postingRows, { dryRun }) {
  const requiredTypes = [...new Set((postingRows || []).map((r) => r.paymentType).filter(Boolean))]
  const missing = []
  for (const paymentType of requiredTypes) {
    const row = (result.payments || []).find((p) => p.paymentType === paymentType)
    const ok =
      row &&
      (row.status === 'posted' ||
        row.status === 'skipped' ||
        (dryRun && row.status === 'dry_run'))
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
    for (const row of postingRows) {
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
          continue
        }
        if (existingDecision.skip) {
          result.summary.paymentsSkipped += 1
          result.payments.push({
            ...row,
            status: 'skipped',
            zohoPaymentId: existingDecision.zohoPaymentId || existingDecision.existing?.zohoPaymentId,
            reason: 'Already posted in Zoho for batch/payment type (verified).',
          })
          continue
        }
      }
      let zohoPayloadPreview = null
      try {
        zohoPayloadPreview = await buildPayloadPreview(row.zohoPaymentRequest)
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          error: err?.message || 'Failed to build payment payload',
          code: err?.code || 'ZOHO_PAYMENT_PREVIEW_FAILED',
        }
        result.errors.push(error)
        result.payments.push(error)
        continue
      }
      if (dryRun) {
        result.summary.paymentsCreated += 1
        result.payments.push({ ...row, status: 'dry_run', zohoPaymentId: '', zohoPayloadPreview })
        continue
      }
      try {
        const created = await createPayment(row.zohoPaymentRequest)
        const zohoPaymentId = clean(
          created?.zohoPaymentId || created?.payment_id || created?.paymentId || created?.id
        )
        await store.insertPosting({
          batchId: batch.batchId,
          invoiceId: null,
          itemOrderId: null,
          paymentType: row.paymentType,
          postingGroupKey: row.postingGroupKey,
          zohoPaymentId,
          amount: row.amount,
          accountCode: row.accountCode,
          invoiceAllocations: row.invoiceAllocations,
          referenceNumber: row.referenceNumber,
          description: row.description,
          status: 'posted',
        })
        result.summary.paymentsCreated += 1
        result.zohoPaymentIds.push({ zohoPaymentId, referenceNumber: row.referenceNumber })
        result.payments.push({ ...row, status: 'posted', zohoPaymentId })
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          error: err?.message || 'Zoho payment failed',
          code: err?.code || 'ZOHO_PAYMENT_FAILED',
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
  if (!batch || (batch.status !== 'posted' && !batch.postedToZoho)) {
    const err = new Error('Force repost requires a previously posted batch.')
    err.code = 'NOON_PAYMENT_CLEARING_NOT_POSTED'
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
  })
  await store.clearPostingsForBatch(batch.batchId)
  return postApprovedBatch({
    batch,
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
  PAYMENT_TYPES,
}

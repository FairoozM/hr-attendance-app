const store = require('./noonPaymentClearingStore')
const { parseNoonStatementReportBuffer } = require('./noonStatementParserService')
const {
  buildPreview,
  buildFeeJournalPreviewLines,
  summarizeFeeJournalVat,
} = require('./noonPaymentClearingPreviewService')
const { matchZohoInvoicesForNoonRows, matchNoonRowsToInvoices, mapInvoice } = require('./noonPaymentClearingZohoMatcher')
const {
  applyParentOrderChargeFallbackWithSynthetics,
  needsParentOrderFallback,
} = require('./noonPaymentClearingParentChargeFallback')
const { buildNoonOrderHierarchy } = require('./noonPaymentClearingHierarchyService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const {
  buildPaymentPreviewFromBatch,
  assertNoStatementOverpayments,
  buildInvoicePaymentPlansFromBatch,
  aggregatePaymentPlansByInvoice,
  annotateInvoicePaymentsWithLiveBalances,
} = require('./noonPaymentClearingPaymentPreviewService')
const {
  postApprovedBatch,
  forceRepostBatch,
  surfaceOpenBalanceBlockInStep6,
} = require('./noonPaymentClearingPostingService')
const { clean, matchKey } = require('./noonOrderIdHelper')
const { ROW_CLASS } = require('./noonPaymentClearingCategoryService')
const { matchNoonReturnsForRows } = require('./noonPaymentClearingReturnMatchingService')
const { collectReturnRows, RETURN_BLOCK_CODES } = require('./noonPaymentClearingReturnService')
const {
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
} = require('./noonPaymentClearingCreditNotePostingService')
const {
  buildReturnFeePlan,
  proveUnclearedReturnAccountsNetToZero,
} = require('./noonPaymentClearingReturnFeeService')
const {
  postReturnFeeJournalsForBatch,
  isReturnFeePostComplete,
} = require('./noonPaymentClearingPostingService')
const { fetchInvoicesByIds, fetchInvoices } = require('../../integrations/zoho/zohoBooksClient')
const { deriveInvoiceRange } = require('./noonPaymentClearingZohoMatcher')

const OPEN_BALANCE_CHECK_MAX_AGE_MS = 60 * 60 * 1000

function isPseudoFetchShortfall(shortfall) {
  return String(shortfall?.reason || '').includes('Could not fetch Zoho invoice')
}

/** Batched by-id fetch, then customer invoice list for any still missing. */
async function fetchNoonInvoiceBalancesForBatch(batch, invoiceIds = []) {
  const ids = [...new Set((Array.isArray(invoiceIds) ? invoiceIds : []).map(clean).filter(Boolean))]
  const map = await fetchInvoicesByIds(ids, { concurrency: 5, retries: 2 })
  const missing = ids.filter((id) => !map.has(clean(id)))
  if (!missing.length) return map

  const customerId = clean(batch?.zohoCustomerId)
  if (!customerId) return map

  try {
    const range = deriveInvoiceRange(batch?.allRows || [])
    const fetched = await fetchInvoices(range.fromDate, range.toDate, customerId)
    const rows = Array.isArray(fetched?.rows) ? fetched.rows : []
    const need = new Set(missing.map(clean))
    for (const inv of rows) {
      const id = clean(inv.invoice_id || inv.id)
      if (id && need.has(id)) map.set(id, inv)
    }
  } catch (err) {
    console.warn('[noon-payment-clearing] invoice list fallback for balances failed:', err?.message || err)
  }
  return map
}

async function resolveAccountByCodeOrName(target) {
  const code = clean(target?.accountCode)
  const name = clean(target?.accountName)
  if (clean(target?.accountId)) return target
  if (!code && !name) return target || {}
  try {
    const { listZohoChartAccounts } = require('../amazonPaymentClearingZohoPaymentService')
    const accounts = await listZohoChartAccounts()
    const hit = (Array.isArray(accounts) ? accounts : []).find((a) => {
      const aCode = clean(a.accountCode || a.account_code)
      const aName = clean(a.accountName || a.account_name)
      return (code && aCode === code) || (name && aName === name)
    })
    if (hit) {
      return {
        accountId: clean(hit.accountId || hit.account_id),
        accountName: clean(hit.accountName || hit.account_name) || name,
        accountCode: clean(hit.accountCode || hit.account_code) || code,
      }
    }
  } catch {
    // Preview/tests can run with codes only.
  }
  return target || {}
}

async function loadMappingContext() {
  const mappingRules = await store.listFeeJournalMappings('AE').catch(() => [])
  const inputVatSettings = await store.getInputVatSettings('AE').catch(() => null)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const undeposited = await resolveAccountByCodeOrName(cfg.undepositedFundsAccount)
  const unclearedCommission = await resolveAccountByCodeOrName(cfg.unclearedCommissionAccount)
  const unclearedShipping = await resolveAccountByCodeOrName(cfg.unclearedShippingAccount)
  const commissionExpense = await resolveAccountByCodeOrName(cfg.commissionExpenseAccount)
  const shippingExpense = await resolveAccountByCodeOrName(cfg.shippingExpenseAccount)
  const inputVatDefault = await resolveAccountByCodeOrName(cfg.inputVatAccount)
  const inputVatAccount = {
    ...inputVatDefault,
    ...(inputVatSettings || {}),
    accountId: clean(inputVatSettings?.accountId || inputVatSettings?.inputVatAccountId) || inputVatDefault.accountId,
    accountName:
      clean(inputVatSettings?.accountName || inputVatSettings?.inputVatAccountName) ||
      inputVatDefault.accountName,
    accountCode:
      clean(inputVatSettings?.accountCode || inputVatSettings?.inputVatAccountCode) ||
      inputVatDefault.accountCode,
    vatRate: inputVatSettings?.vatRate ?? cfg.vatRate,
  }
  // Patch cfg-style payment accounts with resolved IDs for this request.
  cfg.undepositedFundsAccount = undeposited
  cfg.unclearedCommissionAccount = unclearedCommission
  cfg.unclearedShippingAccount = unclearedShipping
  cfg.commissionExpenseAccount = commissionExpense
  cfg.shippingExpenseAccount = shippingExpense
  cfg.inputVatAccount = inputVatDefault
  cfg.paymentPreviewAccounts = {
    NET_BALANCE: {
      depositToAccountCode: undeposited.accountCode,
      depositToAccountName: undeposited.accountName,
      depositToAccountId: undeposited.accountId,
    },
    COMMISSION: {
      depositToAccountCode: unclearedCommission.accountCode,
      depositToAccountName: unclearedCommission.accountName,
      depositToAccountId: unclearedCommission.accountId,
    },
    FULFILLMENT_SHIPPING: {
      depositToAccountCode: unclearedShipping.accountCode,
      depositToAccountName: unclearedShipping.accountName,
      depositToAccountId: unclearedShipping.accountId,
    },
  }
  return {
    mappingRules,
    /** Advertising / default fee-journal counter (Amazon 1024 parallel). */
    settlementBridgeAccount: undeposited,
    unclearedShippingAccount: unclearedShipping,
    unclearedCommissionAccount: unclearedCommission,
    commissionExpenseAccount: commissionExpense,
    shippingExpenseAccount: shippingExpense,
    inputVatAccount,
    zohoCustomerName: cfg.zohoCustomerName,
    marketplaceConfig: cfg,
  }
}

async function enrichPreviewWithReturnMatching(preview, matchResult, options = {}) {
  const returnRows = collectReturnRows(preview?.allRows || [])
  if (!returnRows.length) {
    return {
      ...preview,
      refundReturnRows: [],
      matchedReturns: [],
      creditNoteBlockingRows: [],
    }
  }
  try {
    const returnMatch = await matchNoonReturnsForRows(preview.allRows, {
      invoices: matchResult?.invoices || [],
      customerId: preview.zohoCustomerId || matchResult?.zohoCustomerId,
      customerName: preview.zohoCustomerName || matchResult?.zohoCustomerName,
    })
    const blockingIssues = [...(preview.blockingIssues || [])].filter(
      (issue) => !Object.values(RETURN_BLOCK_CODES).includes(issue.code)
    )
    for (const row of returnMatch.creditNoteBlockingRows || []) {
      if (!row?.blockCode) continue
      blockingIssues.push({
        code: row.blockCode,
        severity: 'block',
        message: row.blockingReason || row.blockCode,
        itemOrderId: row.itemOrderId,
        rowNumber: row.rowNumber,
      })
    }
    const hasReturnBlockers = (returnMatch.creditNoteBlockingRows || []).some((row) => row.blockCode)
    return {
      ...preview,
      refundReturnRows: returnMatch.refundReturnRows || [],
      matchedReturns: returnMatch.matchedReturns || [],
      creditNoteBlockingRows: returnMatch.creditNoteBlockingRows || [],
      blockingIssues,
      isCleanForApproval: Boolean(preview.isCleanForApproval) && !hasReturnBlockers,
      totals: {
        ...(preview.totals || {}),
        returnRowCount: returnRows.length,
        matchedReturnCount: (returnMatch.matchedReturns || []).filter((r) => r.status === 'matched').length,
        returnBlockerCount: (returnMatch.creditNoteBlockingRows || []).length,
      },
    }
  } catch (err) {
    if (options.allowMatchFailure) {
      return {
        ...preview,
        warnings: [...(preview.warnings || []), err.message || 'Return credit note match failed'],
        refundReturnRows: [],
        matchedReturns: [],
        creditNoteBlockingRows: [],
      }
    }
    throw err
  }
}

async function buildPreviewFromUpload(buffer, fileName, options = {}) {
  const parsed = parseNoonStatementReportBuffer(buffer, fileName)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const customerName = clean(options.customerName) || cfg.zohoCustomerName
  const { mappingRules, inputVatAccount } = await loadMappingContext()

  let matchResult
  if (options.skipZohoMatch || options.invoices) {
    const invoiceList = options.invoices || []
    matchResult = matchNoonRowsToInvoices(parsed.rows, invoiceList)
    matchResult.zohoCustomerName = customerName
    matchResult.zohoCustomerId = options.customerId || ''
    matchResult.invoices = invoiceList.map((inv) =>
      inv && inv.zohoInvoiceId ? inv : mapInvoice(inv)
    )
  } else {
    try {
      matchResult = await matchZohoInvoicesForNoonRows(parsed.rows, {
        customerName,
        customerId: options.customerId,
      })
    } catch (err) {
      if (options.allowMatchFailure) {
        matchResult = matchNoonRowsToInvoices(parsed.rows, [])
        matchResult.zohoCustomerName = customerName
        parsed.warnings.push(err.message || 'Zoho invoice match failed')
      } else {
        throw err
      }
    }
  }

  const preview = buildPreview({
    rows: parsed.rows,
    metadata: parsed.metadata,
    matchResult,
    mappingRules,
    inputVatAccount,
    zohoCustomerId: matchResult.zohoCustomerId || options.customerId || '',
    zohoCustomerName: matchResult.zohoCustomerName || customerName,
    warnings: parsed.warnings,
  })
  const enrichedPreview = await enrichPreviewWithReturnMatching(preview, matchResult, {
    allowMatchFailure: options.allowMatchFailure,
  })

  const batch = await store.savePreviewBatch(enrichedPreview, options.createdBy)
  // Early open-balance check (before approve / payment preview).
  try {
    await reconcileOpenBalances(batch.batchId)
  } catch (err) {
    console.warn('[noon-payment-clearing] open balance reconcile after upload failed:', err?.message || err)
  }
  return getBatchPreview(batch.batchId)
}

async function getBatchPreview(batchId) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const { mappingRules, settlementBridgeAccount, inputVatAccount, marketplaceConfig } =
    await loadMappingContext()
  // Rebuild fee journals live so mapping / VAT / Amazon-style clearing counters apply.
  const feeJournalLines = buildFeeJournalPreviewLines(batch.allRows || [], mappingRules, inputVatAccount)
  const feeJournalVatSummary = summarizeFeeJournalVat(feeJournalLines)
  const batchWithExclusions = reapplyExcludedInvoices(batch)
  const openBalanceShortfalls = getActiveOpenBalanceShortfalls(batchWithExclusions)
  const openBalanceExcluded = batch.reportSnapshot?.openBalanceReconcile?.excludedShortfalls || []
  const openBalanceCheckedAt = batch.reportSnapshot?.openBalanceReconcile?.checkedAt || null
  const openBalanceCheckWarning = batch.reportSnapshot?.openBalanceReconcile?.warning || null
  const hasOpenBalanceBlock =
    openBalanceShortfalls.length > 0 ||
    !openBalanceCheckedAt ||
    (batch.blockingIssues || []).some((i) => i.code === 'OPEN_BALANCE_SHORT')
  return {
    batch,
    batchId: batch.batchId,
    metadata: batch.reportSnapshot,
    allRows: batch.allRows,
    hierarchy: batch.hierarchy,
    matchedOrders: batch.matchedOrders,
    unmatchedOrders: batch.unmatchedOrders,
    multipleMatchItems: batch.multipleMatchItems,
    parentCharges: batch.parentCharges,
    adjustments: batch.adjustments,
    statementFees: batch.statementFees,
    reconciliationSummary: batch.reconciliationSummary,
    feeJournalLines,
    feeJournalVatSummary,
    settlementBridgeAccount,
    paymentPreviewAccounts: marketplaceConfig?.paymentPreviewAccounts,
    inputVatAccount,
    blockingIssues: batch.blockingIssues,
    warnings: batch.warnings,
    refundReturnRows: batch.refundReturnRows || [],
    matchedReturns: batch.matchedReturns || [],
    creditNoteBlockingRows: batch.creditNoteBlockingRows || [],
    zohoCustomerId: batch.zohoCustomerId,
    zohoCustomerName: batch.zohoCustomerName,
    openBalanceShortfalls,
    openBalanceExcluded,
    openBalanceCheckedAt,
    openBalanceCheckWarning,
    totals: {
      ...(batch.totals || {}),
      feeJournalInputVat: feeJournalVatSummary.inputVat,
      feeJournalNetExpense: feeJournalVatSummary.netExpense,
      openBalanceShortfallCount: openBalanceShortfalls.length,
    },
    // Fee journal mappings are Step 9 — they must not block Step 8 approval.
    // Open-balance shortfalls DO block approval (fix in Parent Charges step).
    isCleanForApproval:
      isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary) &&
      !(batch.unmatchedOrders || []).length &&
      !(batch.multipleMatchItems || []).length &&
      !(batch.blockingIssues || []).some((i) => i.code === 'UNEXPLAINED_OTHER') &&
      !(batch.blockingIssues || []).some((i) =>
        Object.values(RETURN_BLOCK_CODES).includes(i.code)
      ) &&
      !hasOpenBalanceBlock,
    status: batch.status,
    postedToZoho: batch.postedToZoho,
    postingSummary: batch.postingSummary,
    approvedAt: batch.approvedAt,
    postedAt: batch.postedAt,
  }
}

/**
 * Early reconcile: compare planned clearing vs live Zoho open balance.
 * Stores shortfalls on the batch so Step 6 / Approve can show + rectify them.
 *
 * Detection always includes excluded invoices (they land in excludedShortfalls) so
 * "Check open balances" never wipes visible rows by skipping excluded plans.
 */
async function reconcileOpenBalances(batchId) {
  let batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  batch = reapplyExcludedInvoices(batch)
  const snap = batch.reportSnapshot?.openBalanceReconcile || {}
  const prevShortfalls = Array.isArray(snap.shortfalls) ? snap.shortfalls : []
  const prevExcludedShortfalls = Array.isArray(snap.excludedShortfalls) ? snap.excludedShortfalls : []

  const fullPlans = aggregatePaymentPlansByInvoice(
    buildInvoicePaymentPlansFromBatch(batch, {}, { ignoreExclusions: true })
  )
  const ids = [...new Set(fullPlans.map((p) => clean(p.zohoInvoiceId)).filter(Boolean))]
  let invoiceById = new Map()
  let fetchWarning = ''
  try {
    invoiceById = await fetchNoonInvoiceBalancesForBatch(batch, ids)
  } catch (err) {
    fetchWarning = err?.message || 'Could not fetch Zoho invoice balances'
  }
  const unfetchedIds = new Set(ids.filter((id) => !invoiceById.has(clean(id))))

  const { invoiceBalanceShortfalls: detected } = annotateInvoicePaymentsWithLiveBalances(fullPlans, invoiceById)
  const excludedInvoiceIds = collectExcludedInvoiceIds(batch)
  const excludedItemOrderIds = collectExcludedItemOrderIds(batch)

  const shortfallKey = (s) => `${clean(s?.zohoInvoiceId)}|${matchKey(s?.itemOrderId)}`
  const activeByKey = new Map()
  const excludedByKey = new Map()

  for (const s of detected) {
    const entry = { ...s, excluded: isExcludedShortfall(s, excludedInvoiceIds, excludedItemOrderIds) }
    if (entry.excluded) excludedByKey.set(shortfallKey(s), entry)
    else activeByKey.set(shortfallKey(s), entry)
  }

  // If Zoho fetch missed an invoice, keep a prior real shortfall — never resurrect fetch-failure noise.
  for (const s of [...prevShortfalls, ...prevExcludedShortfalls]) {
    if (isPseudoFetchShortfall(s)) continue
    const invId = clean(s.zohoInvoiceId)
    if (!invId || !unfetchedIds.has(invId)) continue
    const entry = { ...s, reason: s.reason || 'Could not re-fetch Zoho invoice — showing last known shortfall' }
    if (isExcludedShortfall(s, excludedInvoiceIds, excludedItemOrderIds)) {
      if (!excludedByKey.has(shortfallKey(s))) excludedByKey.set(shortfallKey(s), { ...entry, excluded: true })
    } else if (!activeByKey.has(shortfallKey(s))) {
      activeByKey.set(shortfallKey(s), entry)
    }
  }

  const activeShortfalls = [...activeByKey.values()]
  const excludedShortfalls = mergeExcludedShortfalls(prevExcludedShortfalls, [...excludedByKey.values()])

  const warnings = []
  if (fetchWarning) warnings.push(fetchWarning)
  if (unfetchedIds.size) {
    warnings.push(
      `Could not verify open balance for ${unfetchedIds.size} invoice(s) — those rows are not blocking. Retry the check or fix Zoho access.`
    )
  }

  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT')
  for (const s of activeShortfalls) {
    blockingIssues.push({
      code: 'OPEN_BALANCE_SHORT',
      severity: 'error',
      itemOrderId: s.itemOrderId,
      zohoInvoiceId: s.zohoInvoiceId,
      zohoInvoiceNumber: s.zohoInvoiceNumber,
      openBalance: s.openBalance,
      totalClearingAmount: s.totalClearingAmount,
      overBy: s.overBy,
      message: `${s.zohoInvoiceNumber || s.itemOrderId}: clearing ${s.totalClearingAmount} > open balance ${s.openBalance ?? '?'} (over by ${s.overBy}). Exclude already-paid logistics or void Zoho payments first.`,
    })
  }

  await store.updateBatchOpenBalanceReconcile(batch.batchId, {
    openBalanceReconcile: {
      ...snap,
      checkedAt: new Date().toISOString(),
      shortfalls: activeShortfalls,
      excludedShortfalls,
      excludedInvoiceIds: [...excludedInvoiceIds],
      excludedItemOrderIds: [...excludedItemOrderIds],
      balanceCheckInvoiceCount: ids.length,
      balanceCheckFetchedCount: invoiceById.size,
      warning: warnings.length ? warnings.join(' ') : null,
    },
    blockingIssues,
  })
  return getBatchPreview(batch.batchId)
}

/**
 * Rectify: exclude logistics / logistics-only matches on already-paid invoices
 * so they are not sent as Record Payments (user handles offline if needed).
 */
async function excludeOpenBalanceShortfalls(
  batchId,
  { zohoInvoiceIds = [], itemOrderIds = [], restore = false } = {}
) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const snap = batch.reportSnapshot?.openBalanceReconcile || {}
  const shortfalls = snap.shortfalls || []
  const excludedShortfalls = snap.excludedShortfalls || []

  const targetInv = new Set((zohoInvoiceIds || []).map((id) => clean(id)).filter(Boolean))
  const targetItem = new Set((itemOrderIds || []).map((id) => matchKey(id)).filter(Boolean))
  // Nothing specified = act on every row currently listed for this step.
  if (!targetInv.size && !targetItem.size) {
    for (const s of restore ? excludedShortfalls : shortfalls) {
      if (s.zohoInvoiceId) targetInv.add(clean(s.zohoInvoiceId))
      if (s.itemOrderId) targetItem.add(matchKey(s.itemOrderId))
    }
  }
  if (!targetInv.size && !targetItem.size) {
    const err = new Error(
      restore ? 'No excluded invoices to restore.' : 'No open-balance shortfall invoices to exclude.'
    )
    err.code = 'NOON_PAYMENT_CLEARING_NO_SHORTFALLS'
    err.status = 422
    throw err
  }
  // Excluding by invoice must also pin the item order id (and vice versa), otherwise a
  // rematch re-folds the same logistics onto the invoice and the row never clears.
  for (const s of [...shortfalls, ...excludedShortfalls]) {
    const inv = clean(s.zohoInvoiceId)
    const item = matchKey(s.itemOrderId)
    if ((inv && targetInv.has(inv)) || (item && targetItem.has(item))) {
      if (inv) targetInv.add(inv)
      if (item) targetItem.add(item)
    }
  }

  const isTarget = (inv, item) =>
    Boolean((inv && targetInv.has(inv)) || (item && targetItem.has(item)))

  const matchedOrders = (batch.matchedOrders || []).map((m) => {
    if (!isTarget(clean(m.zohoInvoiceId), matchKey(m.itemOrderId))) return m
    if (restore) {
      const { excludeFromPaymentClearing, excludeReason, ...rest } = m
      return rest
    }
    return { ...m, excludeFromPaymentClearing: true, excludeReason: 'open_balance_short_already_paid', paidInvoiceSubsidy: false }
  })

  const allRows = (batch.allRows || []).map((row) => {
    const assignedInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    const assignedItem = matchKey(row.assignedItemOrderId || row.itemOrderId)
    if (!isTarget(assignedInv, assignedItem)) return row
    if (restore) {
      if (row.excludeReason && row.excludeReason !== 'open_balance_short_already_paid') return row
      const { excludeFromPaymentClearing, excludeReason, ...rest } = row
      return rest
    }
    // Exclude every statement row tied to this invoice/item — not only parent-charge rows.
    return {
      ...row,
      excludeFromPaymentClearing: true,
      excludeReason: 'open_balance_short_already_paid',
      paidInvoiceSubsidy: num(row.total) >= 0.01,
    }
  })

  const restoredItems = restore
    ? excludedShortfalls.filter((s) => isTarget(clean(s.zohoInvoiceId), matchKey(s.itemOrderId)))
    : []
  const nextShortfalls = restore
    ? [...shortfalls, ...restoredItems]
    : shortfalls.filter((s) => !isTarget(clean(s.zohoInvoiceId), matchKey(s.itemOrderId)))
  const nextExcludedShortfalls = restore
    ? excludedShortfalls.filter(
        (s) => !isTarget(clean(s.zohoInvoiceId), matchKey(s.itemOrderId))
      )
    : mergeExcludedShortfalls(
        excludedShortfalls,
        shortfalls.filter((s) => isTarget(clean(s.zohoInvoiceId), matchKey(s.itemOrderId)))
      )

  const prevInv = new Set((snap.excludedInvoiceIds || []).map((id) => clean(id)).filter(Boolean))
  const prevItem = new Set((snap.excludedItemOrderIds || []).map((id) => matchKey(id)).filter(Boolean))
  if (restore) {
    for (const id of targetInv) prevInv.delete(id)
    for (const id of targetItem) prevItem.delete(id)
  } else {
    for (const id of targetInv) prevInv.add(id)
    for (const id of targetItem) prevItem.add(id)
  }

  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT')
  for (const s of nextShortfalls) {
    blockingIssues.push({
      code: 'OPEN_BALANCE_SHORT',
      severity: 'error',
      itemOrderId: s.itemOrderId,
      zohoInvoiceId: s.zohoInvoiceId,
      zohoInvoiceNumber: s.zohoInvoiceNumber,
      openBalance: s.openBalance,
      totalClearingAmount: s.totalClearingAmount,
      overBy: s.overBy,
      message: `${s.zohoInvoiceNumber || s.itemOrderId}: clearing ${s.totalClearingAmount} > open balance ${s.openBalance} (over by ${s.overBy}). Exclude already-paid logistics or void Zoho payments first.`,
    })
  }

  const parentCharges = allRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  await store.updateBatchOpenBalanceReconcile(batch.batchId, {
    allRows,
    matchedOrders,
    parentCharges,
    blockingIssues,
    openBalanceReconcile: {
      ...snap,
      checkedAt: snap.checkedAt || new Date().toISOString(),
      shortfalls: nextShortfalls,
      excludedShortfalls: nextExcludedShortfalls,
      lastExcludeAt: new Date().toISOString(),
      excludedInvoiceIds: [...prevInv],
      excludedItemOrderIds: [...prevItem],
    },
  })
  // Do NOT re-run live Zoho reconcile here — it re-fetches every invoice (slow / 504) and
  // orphan rematch could undo exclusions. User clicks "Check open balances" when they want a refresh.
  return getBatchPreview(batch.batchId)
}

/**
 * Approve uses the Step 6 open-balance snapshot — never re-hits Zoho here (that caused CloudFront 504s).
 */
async function prepareBatchForApproval(batchId) {
  let batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status === 'approved' || batch.status === 'posted') return batch

  batch = reapplyExcludedInvoices(batch)
  const snap = batch.reportSnapshot?.openBalanceReconcile || {}
  const checkedAt = snap.checkedAt ? Date.parse(snap.checkedAt) : 0
  if (!checkedAt || Date.now() - checkedAt > OPEN_BALANCE_CHECK_MAX_AGE_MS) {
    const err = new Error(
      'Approval requires a recent open-balance check. Go to Step 6 (Parent Charges & Open Balance) and click "Check open balances (Zoho)".'
    )
    err.code = 'NOON_PAYMENT_CLEARING_BALANCE_CHECK_REQUIRED'
    err.status = 422
    throw err
  }

  const excludedInvoiceIds = collectExcludedInvoiceIds(batch)
  const excludedItemOrderIds = collectExcludedItemOrderIds(batch)
  const activeShortfalls = getActiveOpenBalanceShortfalls(batch)
  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT')
  for (const s of activeShortfalls) {
    blockingIssues.push({
      code: 'OPEN_BALANCE_SHORT',
      severity: 'error',
      itemOrderId: s.itemOrderId,
      zohoInvoiceId: s.zohoInvoiceId,
      zohoInvoiceNumber: s.zohoInvoiceNumber,
      openBalance: s.openBalance,
      totalClearingAmount: s.totalClearingAmount,
      overBy: s.overBy,
      message: `${s.zohoInvoiceNumber || s.itemOrderId}: clearing ${s.totalClearingAmount} > open balance ${s.openBalance} (over by ${s.overBy}). Exclude already-paid logistics or void Zoho payments first.`,
    })
  }

  await store.updateBatchOpenBalanceReconcile(batch.batchId, {
    allRows: batch.allRows,
    matchedOrders: batch.matchedOrders,
    parentCharges: batch.parentCharges,
    blockingIssues,
    openBalanceReconcile: {
      ...snap,
      shortfalls: activeShortfalls,
      excludedInvoiceIds: [...excludedInvoiceIds],
      excludedItemOrderIds: [...excludedItemOrderIds],
    },
  })
  return store.getBatchById(batchId)
}

async function approveSavedBatch(batchId, approvedBy) {
  const batch = await prepareBatchForApproval(batchId)
  if (batch.status === 'approved' || batch.status === 'posted') return batch
  validateBatchReadyForApproval(batch)
  return store.approveBatch(batchId, approvedBy)
}

async function rematchOrphanParentLogistics(batch) {
  if (!batch) return batch
  const rows = Array.isArray(batch.allRows) ? batch.allRows : []
  const excludedInvoiceIds = collectExcludedInvoiceIds(batch)
  const excludedItemOrderIds = collectExcludedItemOrderIds(batch)
  const orphans = rows.filter(
    (r) =>
      !r.excludeFromPaymentClearing &&
      needsParentOrderFallback(r) &&
      (!clean(r.assignedItemOrderId) || r.parentFallbackStatus === 'no_matched_child')
  )
  if (!orphans.length) return batch

  const matchResult = await matchZohoInvoicesForNoonRows(rows, {
    customerName: batch.zohoCustomerName,
    customerId: batch.zohoCustomerId,
  })
  const parentAssign = applyParentOrderChargeFallbackWithSynthetics(
    rows,
    batch.matchedOrders || [],
    matchResult.invoices || []
  )
  // Never wipe user exclusions when rematching orphans.
  const allRows = preserveRowExclusions(rows, parentAssign.rows).map((row) => {
    const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    if (inv && excludedInvoiceIds.has(inv) && needsParentOrderFallback(row)) {
      return {
        ...row,
        excludeFromPaymentClearing: true,
        excludeReason: row.excludeReason || 'open_balance_short_already_paid',
      }
    }
    return row
  })
  const existingMatched = Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []
  const matchedOrders = [
    ...existingMatched.map((m) => {
      const inv = clean(m.zohoInvoiceId)
      const item = matchKey(m.itemOrderId)
      if (
        (inv && excludedInvoiceIds.has(inv)) ||
        (item && excludedItemOrderIds.has(item)) ||
        m.excludeFromPaymentClearing
      ) {
        return {
          ...m,
          excludeFromPaymentClearing: true,
          excludeReason: m.excludeReason || 'open_balance_short_already_paid',
        }
      }
      return m
    }),
    ...(parentAssign.syntheticMatchedOrders || [])
      .filter(
        (syn) =>
          !excludedInvoiceIds.has(clean(syn.zohoInvoiceId)) &&
          !excludedItemOrderIds.has(matchKey(syn.itemOrderId)) &&
          !existingMatched.some(
            (m) =>
              clean(m.zohoInvoiceId) === clean(syn.zohoInvoiceId) ||
              matchKey(m.itemOrderId) === matchKey(syn.itemOrderId)
          )
      )
      .map((syn) => syn),
  ]
  const hierarchy = buildNoonOrderHierarchy(allRows)
  const parentCharges = allRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const stillOrphan = allRows.filter(
    (r) => !r.excludeFromPaymentClearing && r.parentFallbackStatus === 'no_matched_child'
  )
  const blockingIssues = (batch.blockingIssues || []).filter((i) => i.code !== 'ORPHAN_PARENT_LOGISTICS')
  for (const row of stillOrphan) {
    blockingIssues.push({
      code: 'ORPHAN_PARENT_LOGISTICS',
      severity: 'warning',
      rowNumber: row.rowNumber,
      parentOrderId: row.parentOrderId || row.originalParentOrderId || '',
      message: `Parent logistics ${clean(row.parentOrderId || row.originalParentOrderId)} has no matched child in this statement and no Zoho invoice for that Noon order id.`,
    })
  }
  return store.updateBatchParentAssignments(batch.batchId, {
    allRows,
    matchedOrders,
    parentCharges,
    hierarchy,
    blockingIssues,
  })
}

function collectExcludedInvoiceIds(batch) {
  const ids = new Set()
  for (const id of batch?.reportSnapshot?.openBalanceReconcile?.excludedInvoiceIds || []) {
    const c = clean(id)
    if (c) ids.add(c)
  }
  for (const m of batch?.matchedOrders || []) {
    if (m?.excludeFromPaymentClearing && clean(m.zohoInvoiceId)) ids.add(clean(m.zohoInvoiceId))
  }
  for (const row of batch?.allRows || []) {
    if (!row?.excludeFromPaymentClearing) continue
    const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    if (inv) ids.add(inv)
  }
  return ids
}

function collectExcludedItemOrderIds(batch) {
  const ids = new Set()
  for (const id of batch?.reportSnapshot?.openBalanceReconcile?.excludedItemOrderIds || []) {
    const c = matchKey(id)
    if (c) ids.add(c)
  }
  for (const m of batch?.matchedOrders || []) {
    if (m?.excludeFromPaymentClearing && matchKey(m.itemOrderId)) ids.add(matchKey(m.itemOrderId))
  }
  return ids
}

function isExcludedShortfall(shortfall, invoiceIds, itemOrderIds) {
  const inv = clean(shortfall?.zohoInvoiceId)
  const item = matchKey(shortfall?.itemOrderId)
  return Boolean((inv && invoiceIds.has(inv)) || (item && itemOrderIds.has(item)))
}

function getActiveOpenBalanceShortfalls(batch) {
  const shortfalls = batch?.reportSnapshot?.openBalanceReconcile?.shortfalls || []
  const excludedInvoiceIds = collectExcludedInvoiceIds(batch)
  const excludedItemOrderIds = collectExcludedItemOrderIds(batch)
  return shortfalls.filter(
    (s) => !isPseudoFetchShortfall(s) && !isExcludedShortfall(s, excludedInvoiceIds, excludedItemOrderIds)
  )
}

function validateBatchReadyForApproval(batch) {
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary)) {
    const err = new Error('Approval blocked: statement is not reconciled.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Approval blocked: required child invoices are missing.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.multipleMatchItems) && batch.multipleMatchItems.length > 0) {
    const err = new Error('Approval blocked: duplicate invoice matches must be resolved.')
    err.code = 'NOON_PAYMENT_CLEARING_MULTIPLE_MATCHES'
    err.status = 422
    throw err
  }
  const unexplained = (batch.blockingIssues || []).filter((i) => i.code === 'UNEXPLAINED_OTHER')
  if (unexplained.length) {
    const err = new Error('Approval blocked: unexplained transaction amounts remain.')
    err.code = 'NOON_PAYMENT_CLEARING_UNEXPLAINED_OTHER'
    err.status = 422
    throw err
  }
  const returnBlockers = (batch.blockingIssues || []).filter((i) =>
    Object.values(RETURN_BLOCK_CODES).includes(i.code)
  )
  if (returnBlockers.length) {
    const err = new Error(
      `Approval blocked: ${returnBlockers.length} return(s) require a matched Zoho Credit Note.`
    )
    err.code = returnBlockers[0]?.code || 'RETURN_CREDIT_NOTE_MISSING'
    err.status = 422
    err.details = { returnBlockers }
    throw err
  }
  const shortfalls = getActiveOpenBalanceShortfalls(batch)
  if (shortfalls.length) {
    const sample =
      (shortfalls[0] &&
        `${shortfalls[0].zohoInvoiceNumber || shortfalls[0].itemOrderId}: clearing ${shortfalls[0].totalClearingAmount} > open balance ${shortfalls[0].openBalance}`) ||
      ''
    const err = new Error(
      `Approval blocked: ${shortfalls.length} invoice(s) lack open Zoho balance. Go to Step 6 and exclude already-paid logistics (or void Zoho payments). ${sample}`
    )
    err.code = 'NOON_PAYMENT_CLEARING_OPEN_BALANCE_SHORT'
    err.status = 422
    err.details = { invoiceBalanceShortfalls: shortfalls }
    throw err
  }
}

/** Keep excluded rows visible in Step 6 (with refreshed live numbers) instead of vanishing. */
function mergeExcludedShortfalls(previous = [], current = []) {
  const key = (s) => `${clean(s?.zohoInvoiceId)}|${matchKey(s?.itemOrderId)}`
  const byKey = new Map()
  for (const s of previous || []) byKey.set(key(s), { ...s, excluded: true })
  for (const s of current || []) byKey.set(key(s), { ...(byKey.get(key(s)) || {}), ...s, excluded: true })
  return [...byKey.values()]
}

function preserveRowExclusions(oldRows = [], newRows = []) {
  const byNumber = new Map(
    (Array.isArray(oldRows) ? oldRows : [])
      .filter((r) => r && r.rowNumber != null)
      .map((r) => [Number(r.rowNumber), r])
  )
  return (Array.isArray(newRows) ? newRows : []).map((row) => {
    const prev = byNumber.get(Number(row.rowNumber))
    if (!prev?.excludeFromPaymentClearing) return row
    return {
      ...row,
      excludeFromPaymentClearing: true,
      excludeReason: prev.excludeReason || row.excludeReason || 'open_balance_short_already_paid',
    }
  })
}

/** Re-apply persisted exclusions after rematch / reload. */
function reapplyExcludedInvoices(batch) {
  if (!batch) return batch
  const excludedInvoiceIds = collectExcludedInvoiceIds(batch)
  const excludedItemOrderIds = collectExcludedItemOrderIds(batch)
  if (!excludedInvoiceIds.size && !excludedItemOrderIds.size) return batch
  const matchedOrders = (batch.matchedOrders || []).map((m) => {
    if (
      !excludedInvoiceIds.has(clean(m.zohoInvoiceId)) &&
      !excludedItemOrderIds.has(matchKey(m.itemOrderId))
    ) {
      return m
    }
    return {
      ...m,
      excludeFromPaymentClearing: true,
      excludeReason: m.excludeReason || 'open_balance_short_already_paid',
    }
  })
  const allRows = (batch.allRows || []).map((row) => {
    const inv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
    if (!inv || !excludedInvoiceIds.has(inv)) return row
    if (
      row.rowClass !== ROW_CLASS.PARENT_ORDER_CHARGE &&
      row.rowClass !== ROW_CLASS.ORDER_ADJUSTMENT &&
      !(Math.abs(Number(row.netProceed) || 0) < 0.01)
    ) {
      return row
    }
    return {
      ...row,
      excludeFromPaymentClearing: true,
      excludeReason: row.excludeReason || 'open_balance_short_already_paid',
    }
  })
  return {
    ...batch,
    matchedOrders,
    allRows,
    parentCharges: allRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE),
    reportSnapshot: {
      ...(batch.reportSnapshot || {}),
      openBalanceReconcile: {
        ...(batch.reportSnapshot?.openBalanceReconcile || {}),
        excludedInvoiceIds: [...excludedInvoiceIds],
        excludedItemOrderIds: [...excludedItemOrderIds],
      },
    },
  }
}

async function generatePaymentPreview(batchId, createdBy) {
  let batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'approved' && batch.status !== 'posted') {
    const err = new Error(
      `Payment preview requires an approved statement (current status: ${batch.status || 'unknown'}). Go to Step 8 and click Approve settlement.`
    )
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  batch = reapplyExcludedInvoices(batch)
  const snap = batch.reportSnapshot?.openBalanceReconcile || {}
  if (!snap.checkedAt) {
    const err = new Error(
      'Run "Check open balances (Zoho)" in Step 6 before generating the payment preview.'
    )
    err.code = 'NOON_PAYMENT_CLEARING_BALANCE_CHECK_REQUIRED'
    err.status = 422
    throw err
  }
  const activeShortfalls = getActiveOpenBalanceShortfalls(batch)
  if (activeShortfalls.length) {
    const err = new Error(
      `Payment preview blocked: ${activeShortfalls.length} invoice(s) lack open Zoho balance. Go to Step 6 and exclude already-paid logistics.`
    )
    err.code = 'NOON_PAYMENT_CLEARING_INVOICE_BALANCE_SHORT'
    err.status = 422
    err.details = { invoiceBalanceShortfalls: activeShortfalls }
    await surfaceOpenBalanceBlockInStep6(batch, { invoiceBalanceShortfalls: activeShortfalls }, err)
  }
  if (collectExcludedInvoiceIds(batch).size || collectExcludedItemOrderIds(batch).size) {
    await store.updateBatchOpenBalanceReconcile(batch.batchId, {
      allRows: batch.allRows,
      matchedOrders: batch.matchedOrders,
      parentCharges: batch.parentCharges,
      openBalanceReconcile: {
        ...snap,
        excludedInvoiceIds: [...collectExcludedInvoiceIds(batch)],
        excludedItemOrderIds: [...collectExcludedItemOrderIds(batch)],
        shortfalls: snap.shortfalls || [],
        checkedAt: snap.checkedAt || null,
      },
      blockingIssues: (batch.blockingIssues || []).filter((i) => i.code !== 'OPEN_BALANCE_SHORT'),
    })
    batch = (await store.getBatchById(batch.batchId)) || batch
    batch = reapplyExcludedInvoices(batch)
  }
  const ctx = await loadMappingContext()
  const paymentPreview = buildPaymentPreviewFromBatch(batch, ctx.mappingRules, ctx.inputVatAccount, {
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    inputVatAccount: ctx.inputVatAccount,
    paymentPreviewAccounts: ctx.marketplaceConfig?.paymentPreviewAccounts,
    vatRate: ctx.inputVatAccount?.vatRate,
  })
  // Open balance is gated once in Step 6 — never re-fetch all Zoho balances here.
  assertNoStatementOverpayments(paymentPreview)
  return store.savePaymentPreview(batchId, paymentPreview, createdBy)
}

async function postBatchToZoho(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const ctx = await loadMappingContext()
  return postApprovedBatch({
    batch,
    dryRun: options.dryRun !== false,
    allowPosted: options.allowPosted === true,
    postedBy: options.postedBy,
    mappingRules: ctx.mappingRules,
    settlementBridgeAccount: ctx.settlementBridgeAccount,
    inputVatAccount: ctx.inputVatAccount,
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    marketplaceConfig: ctx.marketplaceConfig,
    createPayment: options.createPayment,
    buildPayloadPreview: options.buildPayloadPreview,
    createManualJournal: options.createManualJournal,
    buildJournalPayloadPreview: options.buildJournalPayloadPreview,
  })
}

async function forceRepost(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  const ctx = await loadMappingContext()
  return forceRepostBatch({
    batch,
    reason: options.reason,
    actorUserId: options.actorUserId,
    mappingRules: ctx.mappingRules,
    settlementBridgeAccount: ctx.settlementBridgeAccount,
    inputVatAccount: ctx.inputVatAccount,
    commissionExpenseAccount: ctx.commissionExpenseAccount,
    shippingExpenseAccount: ctx.shippingExpenseAccount,
    unclearedCommissionAccount: ctx.unclearedCommissionAccount,
    unclearedShippingAccount: ctx.unclearedShippingAccount,
    marketplaceConfig: ctx.marketplaceConfig,
  })
}

async function getCreditNoteApplyPlanForBatch(batchId) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const plan = await buildCreditNoteApplyPlan(batch)
  return { success: true, ...plan }
}

async function applyCreditNotesForBatchId(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'approved' && batch.status !== 'posted') {
    const err = new Error('Credit note apply requires an approved Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (options.dryRun === false && batch.status !== 'posted' && !batch.postedToZoho) {
    const err = new Error('Credit note apply requires sales payments to be posted first (Step 11 phase 1).')
    err.code = 'NOON_PAYMENT_CLEARING_SALES_NOT_POSTED'
    err.status = 422
    throw err
  }
  return applyCreditNotesForBatch(batch, {
    dryRun: options.dryRun !== false,
    postedBy: options.postedBy,
  })
}

async function getReturnFeePlanForBatch(batchId) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  const plan = buildReturnFeePlan(batch, batch.allRows || [])
  const cnPlan = await buildCreditNoteApplyPlan(batch)
  return {
    success: true,
    ...plan,
    unclearedAccountProof: proveUnclearedReturnAccountsNetToZero(batch, batch.allRows || []),
    creditNoteApplyComplete: isCreditNoteApplyComplete(batch, cnPlan),
    returnFeePostComplete: await isReturnFeePostComplete(batch.batchId, batch),
  }
}

async function postReturnFeeJournalsForBatchId(batchId, options = {}) {
  const batch = await store.getBatchById(batchId)
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  return postReturnFeeJournalsForBatch({
    batch,
    dryRun: options.dryRun !== false,
    postedBy: options.postedBy,
  })
}

module.exports = {
  buildPreviewFromUpload,
  getBatchPreview,
  reconcileOpenBalances,
  excludeOpenBalanceShortfalls,
  approveSavedBatch,
  validateBatchReadyForApproval,
  generatePaymentPreview,
  postBatchToZoho,
  forceRepost,
  getCreditNoteApplyPlanForBatch,
  applyCreditNotesForBatchId,
  getReturnFeePlanForBatch,
  postReturnFeeJournalsForBatchId,
  listSavedBatches: store.listSavedBatches,
  listFeeJournalMappings: store.listFeeJournalMappings,
  saveFeeJournalMapping: store.saveFeeJournalMapping,
  deactivateFeeJournalMapping: store.deactivateFeeJournalMapping,
  getInputVatSettings: store.getInputVatSettings,
  saveInputVatSettings: store.saveInputVatSettings,
  getNoonPaymentClearingMarketplaceConfig,
}

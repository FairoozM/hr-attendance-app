const {
  CATEGORY,
  CATEGORY_ORDER,
  isFeeCategory,
  isSalesCategory,
  hasOrderId,
  ROW_CLASS,
  categorizeSettlementRow,
  isNonOrderLinkedAmazonFee,
  normalizeAmazonFeeType,
  NORMALIZED_FEE_TYPE,
} = require('./amazonPaymentClearingCategoryService')
const { buildSettlementReference, referenceNumberFor } = require('./amazonPaymentClearingReferenceService')
const { matchSettlementRowsToInvoices } = require('./amazonPaymentClearingZohoMatcher')
const { buildOrderFeeBreakdown, detectNetNegativeOrderRefundRows, isNetNegativeOrderReturn, isSettlementReturnRow, collectInvoicePaymentExcludedOrderIds, orderHasSalePrincipalInSettlement, round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildReconciliationSummary } = require('./amazonPaymentClearingReconciliationService')

function sum(rows, predicate = () => true) {
  return round2((Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    if (!predicate(row)) return acc
    return acc + (Number(row.amount) || 0)
  }, 0))
}

function buildPivot(rows) {
  const byCategory = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const category = row.category || CATEGORY.OTHER
    const entry = byCategory.get(category) || { category, count: 0, total: 0 }
    entry.count += 1
    entry.total = round2(entry.total + (Number(row.amount) || 0))
    byCategory.set(category, entry)
  }
  return orderCategoryEntries(byCategory)
}

function orderCategoryEntries(byCategory) {
  const ordered = []
  for (const category of CATEGORY_ORDER) {
    if (byCategory.has(category)) ordered.push(byCategory.get(category))
  }
  for (const entry of byCategory.values()) {
    if (!CATEGORY_ORDER.includes(entry.category)) ordered.push(entry)
  }
  return ordered
}

function buildSettlementLevelFees(rows) {
  const byCategory = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (hasOrderId(row) && !isNonOrderLinkedAmazonFee(row)) continue
    const amount = Number(row.amount) || 0
    if (!amount && !row.transactionType && !row.amountType && !row.amountDescription) continue
    const category = row.category || categorizeSettlementRow(row)
    const entry = byCategory.get(category) || { category, count: 0, total: 0 }
    entry.count += 1
    entry.total = round2(entry.total + amount)
    byCategory.set(category, entry)
  }
  return orderCategoryEntries(byCategory)
}

const DEFAULT_FEE_JOURNAL_ACCOUNT_SUGGESTIONS = Object.freeze({
  [NORMALIZED_FEE_TYPE.STORAGE]: {
    debitAccountName: 'KSA Amazon Storage Exp',
    creditAccountName: 'KSA-Amazon Undeposited Funds',
  },
  [NORMALIZED_FEE_TYPE.ADVERTISING]: {
    debitAccountName: 'KSA-Amazon Advertising Exp',
    creditAccountName: 'KSA-Amazon Undeposited Funds',
  },
  [NORMALIZED_FEE_TYPE.PREMIUM_SERVICES]: {
    debitAccountName: 'KSA Amazon Commission Exp',
    creditAccountName: 'KSA-Amazon Uncleared Commission Exp',
  },
  [NORMALIZED_FEE_TYPE.COMMISSION]: {
    debitAccountName: 'KSA Amazon Commission Exp',
    creditAccountName: 'KSA-Amazon Uncleared Commission Exp',
  },
  [NORMALIZED_FEE_TYPE.SHIPPING_FBA]: {
    debitAccountName: 'KSA Amazon Shipping Exp',
    creditAccountName: 'KSA-Amazon Uncleared Shipping Exp',
  },
  [NORMALIZED_FEE_TYPE.OTHER_ACCOUNT_LEVEL_FEE]: {
    debitAccountName: '',
    creditAccountName: '',
  },
})

function suggestedAccountsForNormalizedFeeType(normalizedFeeType) {
  const fallback = DEFAULT_FEE_JOURNAL_ACCOUNT_SUGGESTIONS[normalizedFeeType] || DEFAULT_FEE_JOURNAL_ACCOUNT_SUGGESTIONS[NORMALIZED_FEE_TYPE.OTHER_ACCOUNT_LEVEL_FEE]
  return {
    debitAccountName: fallback.debitAccountName || '',
    debitAccountId: '',
    creditAccountName: fallback.creditAccountName || '',
    creditAccountId: '',
  }
}

function mappingStatus(accounts, amount = 0, rule = null) {
  if (Math.abs(round2(Number(amount) || 0)) <= 0.01) return 'not_required'
  if (rule && rule.isActive === false) return 'inactive_mapping'
  if (rule && rule.isSuspense === true) return 'suspense_mapping_used'
  return accounts.debitAccountId && accounts.creditAccountId ? 'mapped' : 'needs_mapping'
}

function journalReferenceNumber(report = {}, paymentType = 'advertising') {
  const settlementRef = buildSettlementReference({ report, marketplace: report.marketplace || 'KSA' })
  return referenceNumberFor(settlementRef, paymentType)
}

function journalNotes(report = {}, paymentType = 'advertising') {
  const referenceNumber = journalReferenceNumber(report, paymentType)
  return `Transferring Amazon KSA payment from ${referenceNumber} to Expenses accounts`
}

function matchesDescriptionPattern(pattern, description) {
  const p = String(pattern || '').trim()
  if (!p) return true
  const value = String(description || '').trim()
  if (p.startsWith('/') && p.lastIndexOf('/') > 0) {
    const last = p.lastIndexOf('/')
    try {
      return new RegExp(p.slice(1, last), p.slice(last + 1) || 'i').test(value)
    } catch {
      return false
    }
  }
  return value.toLowerCase().includes(p.toLowerCase())
}

function findFeeJournalMappingRule(entry, rules = []) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => {
      if (String(rule.marketplace || 'KSA').toUpperCase() !== String(entry.marketplace || 'KSA').toUpperCase()) return false
      if (String(rule.normalizedFeeType || '') !== String(entry.normalizedFeeType || '')) return false
      if (rule.rawTransactionType && String(rule.rawTransactionType).trim().toLowerCase() !== String(entry.rawTransactionType || '').trim().toLowerCase()) return false
      if (!matchesDescriptionPattern(rule.descriptionPattern, entry.description)) return false
      return rule.isActive !== false
    })
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0))[0] || null
}

function buildNonOrderLinkedAmazonFeeMappings(rows, report = {}, mappingRules = []) {
  const marketplace = String(report.marketplace || 'KSA').toUpperCase()
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isNonOrderLinkedAmazonFee(row)) continue
    const feeType = row.category || CATEGORY.OTHER_AMAZON_FEE
    const normalizedFeeType = normalizeAmazonFeeType(row)
    const rawTransactionType = row.transactionType || ''
    const description = row.amountDescription || row.amountType || ''
    const key = [marketplace, normalizedFeeType, rawTransactionType, description].join('|')
    const entry = groups.get(key) || {
      key,
      classification: ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE,
      marketplace,
      feeType,
      normalizedFeeType,
      rawTransactionType,
      description,
      rowCount: 0,
      totalAmount: 0,
      rowNumbers: [],
    }
    entry.rowCount += 1
    entry.totalAmount = round2(entry.totalAmount + (Number(row.amount) || 0))
    if (row.rowNumber != null) entry.rowNumbers.push(row.rowNumber)
    groups.set(key, entry)
  }
  return Array.from(groups.values())
    .map((entry) => {
      const rule = findFeeJournalMappingRule(entry, mappingRules)
      const suggestion = suggestedAccountsForNormalizedFeeType(entry.normalizedFeeType)
      const accounts = rule
        ? {
            debitAccountName: rule.debitAccountName || '',
            debitAccountId: rule.debitAccountId || '',
            creditAccountName: rule.creditAccountName || '',
            creditAccountId: rule.creditAccountId || '',
          }
        : suggestion
      return {
        ...entry,
        ...accounts,
        mappingRuleId: rule?.id || null,
        mappingRuleUsed: rule || null,
        lastUsedAt: rule?.lastUsedAt || null,
        mappingStatus: mappingStatus(accounts, entry.totalAmount, rule),
        journalPreview: {
          referenceNumber: journalReferenceNumber(report, entry.normalizedFeeType || entry.feeType),
          notes: journalNotes(report, entry.normalizedFeeType || entry.feeType),
          debit: {
            accountId: accounts.debitAccountId,
            accountName: accounts.debitAccountName,
            amount: Math.abs(round2(entry.totalAmount)),
          },
          credit: {
            accountId: accounts.creditAccountId,
            accountName: accounts.creditAccountName,
            amount: Math.abs(round2(entry.totalAmount)),
          },
        },
      }
    })
    .sort((a, b) => a.normalizedFeeType.localeCompare(b.normalizedFeeType) || a.rawTransactionType.localeCompare(b.rawTransactionType))
}

function groupRowsByOrder(rows) {
  const groups = new Map()
  const missingOrderIdRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.orderId) {
      missingOrderIdRows.push(row)
      continue
    }
    if (!groups.has(row.orderId)) groups.set(row.orderId, [])
    groups.get(row.orderId).push(row)
  }
  return { groups, missingOrderIdRows }
}

function isRefundReturnRow(row) {
  return isSettlementReturnRow(row)
}

function refundReturnKey(row) {
  if (row?.settlementDerivedReturn) {
    return `derived|${String(row?.orderId || '').trim().toLowerCase()}`
  }
  return [
    String(row?.orderId || '').trim().toLowerCase(),
    String(row?.amountType || '').trim().toLowerCase(),
    String(row?.amountDescription || '').trim().toLowerCase(),
    Math.abs(round2(Number(row?.amount ?? row?.amazonRefundAmount) || 0)),
  ].join('|')
}

const BLOCKING_ISSUE_LABELS = {
  MISSING_ORDER_ID: 'Settlement rows missing an Amazon order ID',
  UNMATCHED_SALES: 'Sales orders with no matching Zoho invoice',
  MISSING_CREDIT_NOTE: 'Refund/return rows with no matching Zoho credit note',
  NET_NEGATIVE_ORDER: 'Net-negative orders that must be cleared via Zoho credit notes',
  CREDIT_NOTE_DIFF: 'Refund/return rows where the credit note amount differs',
  SETTLEMENT_MISMATCH: 'Settlement total does not match the expected deposit',
  UNKNOWN_ROWS: 'Settlement rows that could not be classified',
}

/**
 * Builds a unified, row-numbered view of every parsed settlement row with a
 * resolved status + blocking reason so the UI can drill from any warning down
 * to the exact rows.
 */
function buildAllRows(rows, context) {
  const {
    unmatchedOrderIds = [],
    matchedOrderIds = [],
    matchedReturns = [],
    creditNoteBlockingRows = [],
    netNegativeReturnOrderIds = [],
  } = context || {}
  const unmatchedSet = new Set(unmatchedOrderIds.map((id) => String(id)))
  const matchedSet = new Set(matchedOrderIds.map((id) => String(id)))
  const netNegativeSet = new Set(netNegativeReturnOrderIds.map((id) => String(id)))
  const blockedByKey = new Map()
  for (const blocked of creditNoteBlockingRows) blockedByKey.set(refundReturnKey(blocked), blocked)
  const matchedReturnByKey = new Map()
  for (const matched of matchedReturns) matchedReturnByKey.set(refundReturnKey(matched), matched)

  return (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const orderId = String(row.orderId || '').trim()
    let status = 'ok'
    let blockingReason = ''
    if (isRefundReturnRow(row)) {
      const key = refundReturnKey(row)
      const blocked = blockedByKey.get(key)
      const matched = matchedReturnByKey.get(key)
      if (blocked) {
        status = 'blocked'
        blockingReason = blocked.blockingReason || 'Refund/return credit note reconciliation is not clean.'
      } else if (matched) {
        if (matched.status === 'matched') {
          status = 'matched'
        } else if (matched.status === 'ready_to_create') {
          status = 'ready_to_create'
        } else {
          status = 'blocked'
          blockingReason = matched.blockingReason || ''
        }
      } else {
        status = 'review'
      }
    } else if (isNonOrderLinkedAmazonFee(row)) {
      status = 'account_level_fee'
      blockingReason = 'Order ID not required for this Amazon fee.'
    } else if (!orderId) {
      status = 'missing_order_id'
      blockingReason = 'Settlement row is missing Amazon order ID.'
    } else if (
      netNegativeSet.has(orderId) &&
      !orderHasSalePrincipalInSettlement(rows, orderId)
    ) {
      status = 'blocked'
      blockingReason =
        'Net-negative order in settlement must be cleared via a Zoho sales return / credit note, not an invoice payment.'
    } else if (unmatchedSet.has(orderId)) {
      status = 'unmatched'
      blockingReason = 'No Zoho invoice found with matching PO number or invoice_number.'
    } else if (row.rowClass === ROW_CLASS.ADJUSTMENT || row.category === CATEGORY.ADJUSTMENT) {
      status = 'review'
    } else if (matchedSet.has(orderId)) {
      status = 'matched'
    } else if (row.rowClass === ROW_CLASS.UNKNOWN) {
      status = 'unknown'
    }
    return {
      rowNumber: idx + 1,
      category: row.category || CATEGORY.OTHER,
      rowClass: row.rowClass || ROW_CLASS.UNKNOWN,
      orderId,
      amount: round2(Number(row.amount) || 0),
      currency: row.currency || '',
      settlementDate: row.postedDate || row.settlementEndDate || row.settlementStartDate || row.depositDate || '',
      transactionType: row.transactionType || '',
      amountType: row.amountType || '',
      amountDescription: row.amountDescription || '',
      status,
      blockingReason,
    }
  })
}

function buildAmountDifferences(matchedOrders) {
  return (Array.isArray(matchedOrders) ? matchedOrders : [])
    .map((order) => {
      const amazonTotal = round2(Number(order.amazonOrderTotal) || 0)
      const zohoTotal = round2(Number(order.zohoInvoiceTotal) || 0)
      const difference = round2(amazonTotal - zohoTotal)
      return {
        orderId: order.orderId || '',
        zohoInvoiceNumber: order.zohoInvoiceNumber || '',
        zohoInvoiceId: order.zohoInvoiceId || '',
        amazonOrderTotal: amazonTotal,
        zohoInvoiceTotal: zohoTotal,
        difference,
      }
    })
    .filter((row) => Math.abs(row.difference) > 0.01)
}

function buildBlockingIssues({
  allRows,
  unmatchedOrders,
  creditNoteBlockingRows,
  reconciliationStatus,
  netNegativeReturnOrders = [],
}) {
  const issues = []
  const add = (code, predicateRows, extra = {}) => {
    const rowNumbers = predicateRows.map((row) => row.rowNumber).filter((n) => Number.isFinite(n))
    const orderIds = Array.from(new Set(predicateRows.map((row) => row.orderId).filter(Boolean)))
    const count = extra.count != null ? extra.count : (rowNumbers.length || orderIds.length)
    if (!count) return
    issues.push({ code, label: BLOCKING_ISSUE_LABELS[code], count, rowNumbers, orderIds })
  }

  add('MISSING_ORDER_ID', allRows.filter((row) => row.status === 'missing_order_id'))
  add(
    'UNMATCHED_SALES',
    allRows.filter((row) => row.status === 'unmatched'),
    { count: (unmatchedOrders || []).length || allRows.filter((row) => row.status === 'unmatched').length }
  )

  const missingCn = (creditNoteBlockingRows || []).filter(
    (row) => row.creditNoteAction === 'blocked' && (!row.zohoCreditNoteId || /missing|no zoho/i.test(row.blockingReason || ''))
  )
  const diffCn = (creditNoteBlockingRows || []).filter(
    (row) => row.creditNoteAction === 'blocked' && row.zohoCreditNoteId && /differ/i.test(row.blockingReason || '')
  )
  if (missingCn.length) {
    issues.push({
      code: 'MISSING_CREDIT_NOTE',
      label: BLOCKING_ISSUE_LABELS.MISSING_CREDIT_NOTE,
      count: missingCn.length,
      rowNumbers: [],
      orderIds: Array.from(new Set(missingCn.map((row) => row.orderId).filter(Boolean))),
    })
  }
  if (diffCn.length) {
    issues.push({
      code: 'CREDIT_NOTE_DIFF',
      label: BLOCKING_ISSUE_LABELS.CREDIT_NOTE_DIFF,
      count: diffCn.length,
      rowNumbers: [],
      orderIds: Array.from(new Set(diffCn.map((row) => row.orderId).filter(Boolean))),
    })
  }
  const derivedNetNegative = (netNegativeReturnOrders || []).filter((row) => row.requiresCreditNote !== false)
  if (derivedNetNegative.length) {
    issues.push({
      code: 'NET_NEGATIVE_ORDER',
      label: BLOCKING_ISSUE_LABELS.NET_NEGATIVE_ORDER,
      count: derivedNetNegative.length,
      rowNumbers: [],
      orderIds: derivedNetNegative.map((row) => row.orderId).filter(Boolean),
    })
  }
  if (reconciliationStatus === 'mismatch') {
    issues.push({
      code: 'SETTLEMENT_MISMATCH',
      label: BLOCKING_ISSUE_LABELS.SETTLEMENT_MISMATCH,
      count: 1,
      rowNumbers: [],
      orderIds: [],
    })
  }
  add('UNKNOWN_ROWS', allRows.filter((row) => row.status === 'unknown'))
  return issues
}

function orderSummary(orderId, rows, invoice = null, status = 'matched', reason = '') {
  const breakdown = buildOrderFeeBreakdown(rows)
  const out = {
    orderId,
    ...breakdown,
    // Legacy aliases used elsewhere in totals/store
    feesTotal: breakdown.totalFees,
    netAmount: breakdown.netSettlementAmount,
    status,
  }
  if (invoice) {
    out.zohoInvoiceId = invoice.zohoInvoiceId
    out.zohoInvoiceNumber = invoice.zohoInvoiceNumber
    out.zohoPoNumber = invoice.zohoPoNumber || ''
    out.zohoCustomerId = invoice.zohoCustomerId || ''
    out.zohoCustomerName = invoice.zohoCustomerName
    out.zohoInvoiceTotal = invoice.zohoInvoiceTotal
    out.matchType = invoice.matchType || 'po_number'
  }
  if (reason) out.reason = reason
  return out
}

function buildOrderReconciliation(rows, matchResult, netNegativeReturnOrderIds = []) {
  const netNegativeSet = new Set((netNegativeReturnOrderIds || []).map((id) => String(id)))
  const { groups } = groupRowsByOrder(rows)
  const matchedByOrder = new Map()
  for (const row of matchResult.matchedRows || []) {
    if (row.orderId && row.zohoInvoice && !matchedByOrder.has(row.orderId)) {
      matchedByOrder.set(row.orderId, { ...row.zohoInvoice, matchType: row.matchType })
    }
  }
  const matchedOrders = []
  const unmatchedOrders = []
  const netNegativeReturnOrders = []
  for (const [orderId, orderRows] of groups.entries()) {
    const breakdown = buildOrderFeeBreakdown(orderRows)
    const invoice = matchedByOrder.get(orderId)
    if (netNegativeSet.has(orderId) || isNetNegativeOrderReturn(breakdown)) {
      netNegativeReturnOrders.push({
        ...orderSummary(orderId, orderRows, invoice || null, 'net_negative_return'),
        requiresCreditNote: true,
        settlementDerivedReturn: true,
      })
      continue
    }
    if (invoice) {
      matchedOrders.push(orderSummary(orderId, orderRows, invoice, 'matched'))
    } else {
      unmatchedOrders.push(orderSummary(
        orderId,
        orderRows,
        null,
        'unmatched',
        'No Zoho invoice found with matching PO number or invoice_number'
      ))
    }
  }
  matchedOrders.sort((a, b) => a.orderId.localeCompare(b.orderId))
  unmatchedOrders.sort((a, b) => a.orderId.localeCompare(b.orderId))
  netNegativeReturnOrders.sort((a, b) => a.orderId.localeCompare(b.orderId))
  return { matchedOrders, unmatchedOrders, netNegativeReturnOrders }
}

function augmentCreditNoteBlockingForNetNegative(preview) {
  if (!preview) return preview
  const matchedReturnByOrder = new Map()
  for (const row of preview.matchedReturns || []) {
    if (row?.orderId && row.zohoCreditNoteId) matchedReturnByOrder.set(row.orderId, row)
  }
  const blockingByOrder = new Set(
    (preview.creditNoteBlockingRows || []).map((row) => row.orderId).filter(Boolean)
  )
  const nextBlocking = [...(preview.creditNoteBlockingRows || [])]
  const nextReady = [...(preview.matchedReturns || [])]
  for (const order of preview.netNegativeReturnOrders || []) {
    const orderId = order?.orderId
    if (!orderId || matchedReturnByOrder.has(orderId) || blockingByOrder.has(orderId)) continue
    const readyRow = {
      orderId,
      rowClass: ROW_CLASS.RETURN,
      category: CATEGORY.RETURN,
      amazonRefundAmount: Math.abs(round2(Number(order.principalTotal) || 0)),
      zohoInvoiceId: order.zohoInvoiceId || '',
      zohoInvoiceNumber: order.zohoInvoiceNumber || '',
      zohoPoNumber: order.zohoPoNumber || '',
      zohoCreditNoteId: '',
      zohoCreditNoteNumber: '',
      creditNoteAmount: 0,
      creditNoteDifference: 0,
      creditNoteAction: order.zohoInvoiceId ? 'ready_to_create' : 'blocked',
      status: order.zohoInvoiceId ? 'ready_to_create' : 'blocked',
      blockingReason: order.zohoInvoiceId ? '' : 'No Zoho invoice found for net-negative order return.',
    }
    if (readyRow.status === 'ready_to_create') {
      nextReady.push(readyRow)
    } else {
      nextBlocking.push(readyRow)
      blockingByOrder.add(orderId)
    }
  }
  preview.matchedReturns = nextReady
  preview.creditNoteBlockingRows = nextBlocking
  return preview
}

function removeReturnOrdersFromMatchedSales(preview, allRows) {
  if (!preview) return preview
  const excludedOrderIds = collectInvoicePaymentExcludedOrderIds(allRows, {
    netNegativeReturnOrders: preview.netNegativeReturnOrders,
  })
  if (!excludedOrderIds.size) return preview

  const before = Array.isArray(preview.matchedOrders) ? preview.matchedOrders.length : 0
  preview.matchedOrders = (preview.matchedOrders || []).filter(
    (order) => !excludedOrderIds.has(String(order.orderId || ''))
  )
  if (preview.matchedOrders.length === before) return preview

  const explicitRefundTotal = sum(allRows.filter(isRefundReturnRow))
  const syntheticRefundRows = detectNetNegativeOrderRefundRows(allRows)
  const derivedRefundTotal = round2(
    syntheticRefundRows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0)
  )
  preview.refundReturnTotal = round2(explicitRefundTotal + derivedRefundTotal)
  preview.reconciliationSummary = buildReconciliationSummary({
    matchedOrders: preview.matchedOrders,
    refundReturnTotal: preview.refundReturnTotal,
    settlementLevelFees: preview.settlementLevelFees || [],
    actualAmazonSettlement: preview.totals?.amazonSettlementTotal ?? sum(allRows),
  })
  preview.amountDifferences = buildAmountDifferences(preview.matchedOrders)
  const netNegativeOnlyIds = syntheticRefundRows.map((row) => row.orderId).filter(Boolean)
  const unifiedRows = buildAllRows(allRows, {
    unmatchedOrderIds: preview.unmatchedOrderIds || [],
    matchedOrderIds: preview.matchedOrders.map((order) => order.orderId),
    matchedReturns: preview.matchedReturns || [],
    creditNoteBlockingRows: preview.creditNoteBlockingRows || [],
    netNegativeReturnOrderIds: netNegativeOnlyIds,
  })
  preview.allRows = unifiedRows
  preview.blockingIssues = buildBlockingIssues({
    allRows: unifiedRows,
    unmatchedOrders: preview.unmatchedOrders,
    creditNoteBlockingRows: preview.creditNoteBlockingRows,
    reconciliationStatus: preview.reconciliationSummary?.reconciliationStatus,
    netNegativeReturnOrders: preview.netNegativeReturnOrders || [],
  })
  return preview
}

function applyNetNegativeOrderAdjustments(preview, rows = []) {
  if (!preview) return preview
  const allRows = Array.isArray(rows) ? rows : preview.allRows || []
  removeReturnOrdersFromMatchedSales(preview, allRows)
  const priorMatchedByOrder = new Map(
    (Array.isArray(preview.matchedOrders) ? preview.matchedOrders : []).map((order) => [order.orderId, order])
  )
  const syntheticRefundRows = detectNetNegativeOrderRefundRows(allRows)
  const netNegativeReturnOrderIds = syntheticRefundRows.map((row) => row.orderId).filter(Boolean)
  if (!netNegativeReturnOrderIds.length) {
    preview.netNegativeReturnOrders = preview.netNegativeReturnOrders || []
    preview.syntheticRefundRows = preview.syntheticRefundRows || []
    return preview
  }

  const salesAndFeeRows = allRows.filter((row) => !isRefundReturnRow(row) && !isNonOrderLinkedAmazonFee(row))
  const salesRows = salesAndFeeRows.filter((row) => {
    const orderId = String(row.orderId || '').trim()
    return !(orderId && netNegativeReturnOrderIds.includes(orderId))
  })
  const matchResult = matchSettlementRowsToInvoices(salesRows, preview.invoices || [])
  const reconciled = buildOrderReconciliation(salesAndFeeRows, matchResult, netNegativeReturnOrderIds)

  preview.matchedOrders = reconciled.matchedOrders
  preview.unmatchedOrders = reconciled.unmatchedOrders
  preview.netNegativeReturnOrders = reconciled.netNegativeReturnOrders.map((order) => {
    const prior = priorMatchedByOrder.get(order.orderId)
    if (!prior) return order
    return {
      ...order,
      zohoInvoiceId: order.zohoInvoiceId || prior.zohoInvoiceId,
      zohoInvoiceNumber: order.zohoInvoiceNumber || prior.zohoInvoiceNumber,
      zohoPoNumber: order.zohoPoNumber || prior.zohoPoNumber,
      zohoCustomerId: order.zohoCustomerId || prior.zohoCustomerId,
      zohoCustomerName: order.zohoCustomerName || prior.zohoCustomerName,
      zohoInvoiceTotal: order.zohoInvoiceTotal ?? prior.zohoInvoiceTotal,
      matchType: order.matchType || prior.matchType,
    }
  })
  preview.syntheticRefundRows = syntheticRefundRows
  preview.matchedRows = matchResult.matchedRows
  preview.unmatchedRows = matchResult.unmatchedRows
  preview.matchedInvoices = matchResult.matchedInvoices
  preview.unmatchedOrderIds = matchResult.unmatchedOrderIds
  preview.duplicateZohoInvoiceNumbers = matchResult.duplicateZohoInvoiceNumbers
  preview.duplicateZohoPoNumbers = matchResult.duplicateZohoPoNumbers
  preview.missingOrderIdRows = matchResult.missingOrderIdRows
  augmentCreditNoteBlockingForNetNegative(preview)

  const explicitRefundTotal = sum(allRows.filter(isRefundReturnRow))
  const derivedRefundTotal = round2(
    syntheticRefundRows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0)
  )
  preview.refundReturnTotal = round2(explicitRefundTotal + derivedRefundTotal)
  preview.totals = {
    ...(preview.totals || {}),
    refundReturnTotal: preview.refundReturnTotal,
    returnsTotal: sum(allRows, (row) => row.category === CATEGORY.RETURN),
    refundsTotal: sum(allRows, (row) => row.category === CATEGORY.REFUND),
  }
  preview.reconciliationSummary = buildReconciliationSummary({
    matchedOrders: preview.matchedOrders,
    refundReturnTotal: preview.refundReturnTotal,
    settlementLevelFees: preview.settlementLevelFees || [],
    actualAmazonSettlement: preview.totals?.amazonSettlementTotal ?? sum(allRows),
  })

  const unifiedRows = buildAllRows(allRows, {
    unmatchedOrderIds: matchResult.unmatchedOrderIds,
    matchedOrderIds: preview.matchedOrders.map((order) => order.orderId),
    matchedReturns: preview.matchedReturns || [],
    creditNoteBlockingRows: preview.creditNoteBlockingRows || [],
    netNegativeReturnOrderIds,
  })
  preview.allRows = unifiedRows
  preview.blockingIssues = buildBlockingIssues({
    allRows: unifiedRows,
    unmatchedOrders: preview.unmatchedOrders,
    creditNoteBlockingRows: preview.creditNoteBlockingRows,
    reconciliationStatus: preview.reconciliationSummary?.reconciliationStatus,
    netNegativeReturnOrders: preview.netNegativeReturnOrders,
  })
  preview.amountDifferences = buildAmountDifferences(preview.matchedOrders)

  const derivedBlocking = (preview.creditNoteBlockingRows || []).filter((row) =>
    syntheticRefundRows.some((synthetic) => synthetic.orderId === row.orderId)
  )
  if (derivedBlocking.length) {
    preview.warnings = [
      ...(Array.isArray(preview.warnings) ? preview.warnings : []),
      `${derivedBlocking.length} net-negative order(s) block approval until matched to Zoho credit notes.`,
    ]
  } else if (preview.netNegativeReturnOrders.length) {
    preview.warnings = [
      ...(Array.isArray(preview.warnings) ? preview.warnings : []),
      `${preview.netNegativeReturnOrders.length} net-negative order(s) were removed from invoice payment clearing and must use Zoho credit notes.`,
    ]
  }
  return preview
}

function buildPreview({
  report = {},
  rows = [],
  invoices = [],
  matchedReturns = [],
  missingCreditNotes = [],
  creditNoteBlockingRows = [],
  parserWarnings = [],
  rawRowCount = rows.length,
  feeJournalMappingRules = [],
  syntheticRefundRows = [],
  netNegativeReturnOrderIds = [],
}) {
  const allRows = Array.isArray(rows) ? rows : []
  const detectedSynthetic = syntheticRefundRows.length
    ? syntheticRefundRows
    : detectNetNegativeOrderRefundRows(allRows)
  const netNegativeIds = netNegativeReturnOrderIds.length
    ? netNegativeReturnOrderIds
    : detectedSynthetic.map((row) => row.orderId).filter(Boolean)
  const refundReturnRows = allRows.filter(isRefundReturnRow)
  const salesAndFeeRows = allRows.filter((row) => !isRefundReturnRow(row) && !isNonOrderLinkedAmazonFee(row))
  const salesRows = salesAndFeeRows.filter((row) => {
    const orderId = String(row.orderId || '').trim()
    return !(orderId && netNegativeIds.includes(orderId))
  })
  const matchResult = matchSettlementRowsToInvoices(salesRows, invoices)
  const { matchedOrders, unmatchedOrders, netNegativeReturnOrders } = buildOrderReconciliation(
    salesAndFeeRows,
    matchResult,
    netNegativeIds
  )
  const pivot = buildPivot(allRows)
  const settlementLevelFees = buildSettlementLevelFees(allRows)
  const adjustmentRows = allRows.filter((row) => row.rowClass === ROW_CLASS.ADJUSTMENT || row.category === CATEGORY.ADJUSTMENT)
  const orderLevelFeeRows = salesAndFeeRows.filter((row) => hasOrderId(row) && isFeeCategory(row.category))
  const settlementLevelFeeRows = allRows.filter((row) => isNonOrderLinkedAmazonFee(row) || (!hasOrderId(row) && isFeeCategory(row.category)))
  const rowsWithNumbers = allRows.map((row, idx) => ({ ...row, rowNumber: idx + 1 }))
  const nonOrderLinkedAmazonFeeMappings = buildNonOrderLinkedAmazonFeeMappings(rowsWithNumbers, report, feeJournalMappingRules)
  const matchedInvoiceTotal = round2(
    matchedOrders.reduce((acc, row) => acc + (Number(row.zohoInvoiceTotal) || 0), 0)
  )
  const unmatchedOrderTotal = round2(
    unmatchedOrders.reduce((acc, row) => acc + (Number(row.amazonOrderTotal) || 0), 0)
  )
  const amazonSettlementTotal = sum(allRows)
  const derivedRefundTotal = round2(
    detectedSynthetic.reduce((acc, row) => acc + (Number(row.amount) || 0), 0)
  )
  const refundReturnTotal = round2(sum(refundReturnRows) + derivedRefundTotal)
  const reconciliationSummary = buildReconciliationSummary({
    matchedOrders,
    refundReturnTotal,
    settlementLevelFees,
    actualAmazonSettlement: amazonSettlementTotal,
  })
  const warnings = [...(Array.isArray(parserWarnings) ? parserWarnings : [])]
  if (matchResult.duplicateZohoInvoiceNumbers.length > 0) {
    warnings.push(`Duplicate Zoho invoice numbers: ${matchResult.duplicateZohoInvoiceNumbers.join(', ')}`)
  }
  if (matchResult.duplicateZohoPoNumbers.length > 0) {
    warnings.push(`Duplicate Zoho PO numbers: ${matchResult.duplicateZohoPoNumbers.join(', ')}`)
  }
  if (matchResult.missingOrderIdRows.length > 0) {
    warnings.push(`${matchResult.missingOrderIdRows.length} settlement row(s) were not matchable because order ID is missing.`)
  }
  const unmappedFeeJournalMappings = nonOrderLinkedAmazonFeeMappings.filter((row) => row.mappingStatus === 'needs_mapping')
  if (unmappedFeeJournalMappings.length > 0) {
    warnings.push(`${unmappedFeeJournalMappings.length} account-level Amazon fee group(s) require manual journal mapping before posting.`)
  }
  if (creditNoteBlockingRows.length > 0) {
    warnings.push(`${creditNoteBlockingRows.length} refund/return row(s) block approval because credit note reconciliation is not clean.`)
  }
  if (reconciliationSummary.reconciliationStatus === 'mismatch') {
    warnings.push('Settlement total does not match calculated expected deposit.')
  }

  const unifiedRows = buildAllRows(allRows, {
    unmatchedOrderIds: matchResult.unmatchedOrderIds,
    matchedOrderIds: matchedOrders.map((order) => order.orderId),
    matchedReturns,
    creditNoteBlockingRows,
    netNegativeReturnOrderIds: netNegativeIds,
  })
  const amountDifferences = buildAmountDifferences(matchedOrders)
  const blockingIssues = buildBlockingIssues({
    allRows: unifiedRows,
    unmatchedOrders,
    creditNoteBlockingRows,
    reconciliationStatus: reconciliationSummary.reconciliationStatus,
    netNegativeReturnOrders,
  })

  return {
    marketplace: 'KSA',
    invoices,
    report: {
      reportId: report.reportId || '',
      reportDocumentId: report.reportDocumentId || '',
      settlementId: report.settlementId || '',
      settlementStartDate: report.settlementStartDate || '',
      settlementEndDate: report.settlementEndDate || '',
      depositDate: report.depositDate || '',
      currency: report.currency || 'SAR',
    },
    totals: {
      amazonSettlementTotal,
      productSalesTotal: sum(rows, (row) => isSalesCategory(row.category)),
      feesTotal: sum(rows, (row) => isFeeCategory(row.category)),
      orderLevelFeesTotal: sum(orderLevelFeeRows),
      settlementLevelFeesTotal: sum(settlementLevelFeeRows),
      refundsTotal: sum(rows, (row) => row.category === CATEGORY.REFUND),
      returnsTotal: sum(rows, (row) => row.category === CATEGORY.RETURN),
      refundReturnTotal,
      adjustmentsTotal: sum(rows, (row) => row.category === CATEGORY.ADJUSTMENT),
      matchedInvoiceTotal,
      unmatchedOrderTotal,
      difference: round2(amazonSettlementTotal - matchedInvoiceTotal),
    },
    pivot,
    settlementLevelFees,
    nonOrderLinkedAmazonFeeMappings,
    refundReturnRows,
    matchedReturns,
    missingCreditNotes,
    creditNoteBlockingRows,
    adjustmentRows,
    reconciliationSummary,
    matchedOrders,
    unmatchedOrders,
    netNegativeReturnOrders,
    syntheticRefundRows: detectedSynthetic,
    allRows: unifiedRows,
    amountDifferences,
    blockingIssues,
    warnings,
    rawRowCount,
    matchedRows: matchResult.matchedRows,
    unmatchedRows: matchResult.unmatchedRows,
    matchedInvoices: matchResult.matchedInvoices,
    unmatchedOrderIds: matchResult.unmatchedOrderIds,
    duplicateZohoInvoiceNumbers: matchResult.duplicateZohoInvoiceNumbers,
    duplicateZohoPoNumbers: matchResult.duplicateZohoPoNumbers,
    missingOrderIdRows: matchResult.missingOrderIdRows,
  }
}

module.exports = {
  buildPreview,
  buildPivot,
  buildSettlementLevelFees,
  buildNonOrderLinkedAmazonFeeMappings,
  buildOrderReconciliation,
  buildAllRows,
  buildAmountDifferences,
  buildBlockingIssues,
  applyNetNegativeOrderAdjustments,
  groupRowsByOrder,
  orderSummary,
  round2,
}

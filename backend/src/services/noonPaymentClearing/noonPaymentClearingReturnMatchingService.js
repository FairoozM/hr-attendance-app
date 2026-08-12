const { fetchCreditNotes } = require('../../integrations/zoho/zohoBooksClient')
const {
  mapInvoice,
  findExactInvoiceMatches,
  deriveInvoiceRange,
  resolveZohoCustomerByName,
  indexInvoices,
} = require('./noonPaymentClearingZohoMatcher')
const { matchKey } = require('./noonOrderIdHelper')
const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const {
  RETURN_BLOCK_CODES,
  TOLERANCE,
  collectReturnRows,
  buildNoonReturnFeeBreakdown,
  itemOrderIdForRow,
} = require('./noonPaymentClearingReturnService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')

function creditNoteNumber(creditNote) {
  return clean(
    creditNote?.creditnote_number ||
      creditNote?.credit_note_number ||
      creditNote?.number ||
      creditNote?.reference_number
  )
}

function creditNoteReference(creditNote) {
  return clean(creditNote?.reference_number || creditNote?.reference || creditNote?.notes)
}

function creditNoteInvoiceIds(creditNote) {
  const ids = new Set()
  for (const key of ['invoice_id', 'invoiceId']) {
    if (creditNote?.[key]) ids.add(clean(creditNote[key]))
  }
  for (const invoice of Array.isArray(creditNote?.invoices) ? creditNote.invoices : []) {
    if (invoice?.invoice_id || invoice?.invoiceId) ids.add(clean(invoice.invoice_id || invoice.invoiceId))
  }
  return Array.from(ids).filter(Boolean)
}

function mapCreditNote(creditNote) {
  return {
    zohoCreditNoteId: clean(creditNote?.creditnote_id || creditNote?.credit_note_id || creditNote?.id),
    zohoCreditNoteNumber: creditNoteNumber(creditNote),
    referenceNumber: creditNoteReference(creditNote),
    zohoCustomerId: clean(creditNote?.customer_id || creditNote?.customerId),
    zohoCustomerName: clean(creditNote?.customer_name || creditNote?.customerName),
    invoiceIds: creditNoteInvoiceIds(creditNote),
    amount: num(creditNote?.total ?? creditNote?.creditnote_total ?? creditNote?.amount),
    balance: num(creditNote?.balance ?? creditNote?.balance_due),
    status: clean(creditNote?.status),
    raw: creditNote,
  }
}

function creditNoteMatchesInvoiceOrOrder(creditNote, invoice, itemOrderId) {
  const cn = mapCreditNote(creditNote)
  const itemKey = matchKey(itemOrderId)
  const invoiceIdKey = matchKey(invoice?.zohoInvoiceId)
  const invoiceNumberKey = matchKey(invoice?.zohoInvoiceNumber)

  if (invoiceIdKey && cn.invoiceIds.some((id) => matchKey(id) === invoiceIdKey)) {
    return true
  }
  if (itemKey && matchKey(cn.zohoCreditNoteNumber) === itemKey) {
    return true
  }
  if (invoiceNumberKey && matchKey(cn.referenceNumber) === invoiceNumberKey) {
    return true
  }

  const refs = [
    cn.referenceNumber,
    cn.zohoCreditNoteNumber,
    ...(Array.isArray(cn.invoiceIds) ? cn.invoiceIds : []),
  ]
    .map(matchKey)
    .filter(Boolean)
  const needles = [
    itemOrderId,
    invoice?.zohoInvoiceId,
    invoice?.zohoInvoiceNumber,
    invoice?.zohoPoNumber,
    invoice?.zohoOrderNumber,
  ]
    .map(matchKey)
    .filter(Boolean)

  return needles.some((needle) => refs.some((ref) => ref === needle || ref.includes(needle) || needle.includes(ref)))
}

function blockedReturnRow(base, code, reason, extra = {}) {
  return {
    ...base,
    ...extra,
    creditNoteAction: 'blocked',
    status: 'blocked',
    blockCode: code,
    blockingReason: reason,
  }
}

function indexMappedInvoices(invoices) {
  const byInvoiceNumber = new Map()
  const byOrderRef = new Map()
  for (const mapped of Array.isArray(invoices) ? invoices : []) {
    const inv =
      mapped?.zohoInvoiceId && Array.isArray(mapped.matchKeys)
        ? mapped
        : mapInvoice(mapped?.raw || mapped)
    const invoiceKey = matchKey(inv.zohoInvoiceNumber)
    if (invoiceKey) {
      if (!byInvoiceNumber.has(invoiceKey)) byInvoiceNumber.set(invoiceKey, [])
      byInvoiceNumber.get(invoiceKey).push(inv)
    }
    for (const rawKey of inv.matchKeys || []) {
      const key = matchKey(rawKey)
      if (!key) continue
      if (!byOrderRef.has(key)) byOrderRef.set(key, [])
      byOrderRef.get(key).push(inv)
    }
  }
  return { byInvoiceNumber, byOrderRef }
}

function matchNoonReturnRowsToCreditNotes(returnRows, invoices, creditNotes) {
  const { byInvoiceNumber, byOrderRef } = indexMappedInvoices(invoices)
  const matchedReturns = []
  const creditNoteBlockingRows = []
  const refundReturnRows = []

  for (const row of Array.isArray(returnRows) ? returnRows : []) {
    const itemOrderId = itemOrderIdForRow(row)
    const breakdown = buildNoonReturnFeeBreakdown(row)
    const productRefundAmount = breakdown.productRefundAmount
    const base = {
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      itemOrderId,
      parentOrderId: clean(row.parentOrderId || row.originalParentOrderId),
      productRefundAmount,
      commissionReversalGross: breakdown.commissionReversalGross,
      netSettlementEffect: breakdown.netSettlementEffect,
      transactionType: clean(row.transactionType),
      originalRawRow: row.originalRawRow || row,
    }
    refundReturnRows.push(base)

    if (!itemOrderId) {
      const blocked = blockedReturnRow(
        base,
        RETURN_BLOCK_CODES.RETURN_INVOICE_MISSING,
        'Return row is missing item-level Noon order ID.'
      )
      creditNoteBlockingRows.push(blocked)
      matchedReturns.push(blocked)
      continue
    }

    const { matches } = findExactInvoiceMatches(itemOrderId, byOrderRef, byInvoiceNumber)
    if (matches.length === 0) {
      const blocked = blockedReturnRow(
        base,
        RETURN_BLOCK_CODES.RETURN_INVOICE_MISSING,
        `No Zoho invoice found for item order ${itemOrderId}.`
      )
      creditNoteBlockingRows.push(blocked)
      matchedReturns.push(blocked)
      continue
    }
    if (matches.length > 1) {
      const blocked = blockedReturnRow(
        base,
        RETURN_BLOCK_CODES.RETURN_INVOICE_MULTIPLE_MATCHES,
        `Multiple Zoho invoices match item order ${itemOrderId}.`,
        { candidateInvoiceNumbers: matches.map((inv) => inv.zohoInvoiceNumber).filter(Boolean) }
      )
      creditNoteBlockingRows.push(blocked)
      matchedReturns.push(blocked)
      continue
    }

    const invoice = matches[0]
    const invoiceFields = {
      zohoInvoiceId: invoice.zohoInvoiceId,
      zohoInvoiceNumber: invoice.zohoInvoiceNumber,
      zohoPoNumber: invoice.zohoPoNumber,
      zohoCustomerId: invoice.zohoCustomerId,
      zohoCustomerName: invoice.zohoCustomerName,
      zohoInvoiceTotal: invoice.zohoInvoiceTotal,
      matchType: 'order_number',
    }

    const creditNoteMatches = (Array.isArray(creditNotes) ? creditNotes : []).filter((cn) =>
      creditNoteMatchesInvoiceOrOrder(cn, invoice, itemOrderId)
    )
    const mappedCns = creditNoteMatches.map(mapCreditNote)

    if (mappedCns.length === 0) {
      const blocked = blockedReturnRow(
        { ...base, ...invoiceFields },
        RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_MISSING,
        `No Zoho Credit Note found for item order ${itemOrderId} / invoice ${invoice.zohoInvoiceNumber}.`
      )
      creditNoteBlockingRows.push(blocked)
      matchedReturns.push(blocked)
      continue
    }
    if (mappedCns.length > 1) {
      const blocked = blockedReturnRow(
        { ...base, ...invoiceFields },
        RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_MULTIPLE_MATCHES,
        `Multiple Zoho Credit Notes match item order ${itemOrderId}.`,
        {
          candidateCreditNoteNumbers: mappedCns.map((cn) => cn.zohoCreditNoteNumber).filter(Boolean),
        }
      )
      creditNoteBlockingRows.push(blocked)
      matchedReturns.push(blocked)
      continue
    }

    const creditNote = mappedCns[0]
    const creditNoteAmount = Math.abs(round2(creditNote.amount))
    const creditNoteDifference = round2(creditNoteAmount - productRefundAmount)
    const invoiceTotal = Math.abs(round2(invoice.zohoInvoiceTotal))
    const itemKey = matchKey(itemOrderId)
    const matchesOrderLinkedCn =
      itemKey &&
      matchKey(creditNote.zohoCreditNoteNumber) === itemKey &&
      invoiceTotal > 0 &&
      Math.abs(creditNoteAmount - invoiceTotal) <= TOLERANCE
    const matchesInvoiceTotal =
      invoiceTotal > 0 && Math.abs(creditNoteAmount - invoiceTotal) <= TOLERANCE
    const matchesPrincipal = Math.abs(creditNoteDifference) <= TOLERANCE
    const isMatched = matchesPrincipal || matchesInvoiceTotal || matchesOrderLinkedCn

    const out = {
      ...base,
      ...invoiceFields,
      zohoCreditNoteId: creditNote.zohoCreditNoteId,
      zohoCreditNoteNumber: creditNote.zohoCreditNoteNumber,
      creditNoteAmount,
      creditNoteBalance: Math.abs(round2(creditNote.balance)),
      creditNoteStatus: creditNote.status,
      creditNoteDifference,
      creditNoteAction: isMatched ? 'matched_existing' : 'blocked',
      status: isMatched ? 'matched' : 'blocked',
      blockCode: isMatched ? '' : RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_AMOUNT_MISMATCH,
      blockingReason: isMatched
        ? ''
        : `Credit Note amount ${creditNoteAmount} differs from product refund ${productRefundAmount}.`,
    }
    matchedReturns.push(out)
    if (!isMatched) {
      out.creditNoteAction = 'blocked'
      creditNoteBlockingRows.push(out)
    }
  }

  return {
    refundReturnRows,
    matchedReturns,
    creditNoteBlockingRows,
    creditNotes: (Array.isArray(creditNotes) ? creditNotes : []).map(mapCreditNote),
  }
}

async function matchNoonReturnsForRows(allRows, options = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const customerName = clean(options.customerName) || cfg.zohoCustomerName
  const customerId =
    clean(options.customerId) || (await resolveZohoCustomerByName(customerName))
  if (!customerId) {
    const err = new Error(`Zoho customer "${customerName}" was not found.`)
    err.code = 'NOON_PAYMENT_CLEARING_CUSTOMER_NOT_FOUND'
    err.status = 422
    throw err
  }

  const returnRows = collectReturnRows(allRows)
  const range = deriveInvoiceRange(allRows)
  const creditNoteFetch = await fetchCreditNotes(range.fromDate, range.toDate, customerId || null)
  const creditNotes = Array.isArray(creditNoteFetch?.rows)
    ? creditNoteFetch.rows
    : Array.isArray(creditNoteFetch)
      ? creditNoteFetch
      : []

  const invoices = (Array.isArray(options.invoices) ? options.invoices : []).map((inv) =>
    inv.zohoInvoiceId ? inv : mapInvoice(inv.raw || inv)
  )

  const result = matchNoonReturnRowsToCreditNotes(returnRows, invoices, creditNotes)
  return {
    ...result,
    zohoCustomerId: customerId,
    zohoCustomerName: customerName,
    creditNoteDateRange: range,
    creditNoteCount: creditNotes.length,
    creditNoteFetchTruncated: Boolean(creditNoteFetch?.truncated),
  }
}

module.exports = {
  mapCreditNote,
  creditNoteMatchesInvoiceOrOrder,
  matchNoonReturnRowsToCreditNotes,
  matchNoonReturnsForRows,
}

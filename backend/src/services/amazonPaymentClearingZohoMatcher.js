const { fetchCustomers, fetchInvoices, fetchCreditNotes } = require('../integrations/zoho/zohoBooksClient')
const { normalizeSettlementDate } = require('./amazonSettlementParserService')
const { ROW_CLASS, isNonOrderLinkedAmazonFee } = require('./amazonPaymentClearingCategoryService')
const { detectNetNegativeOrderRefundRows, round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildReturnFeeBreakdown } = require('./amazonPaymentClearingReturnFeeService')

const KSA_ZOHO_CUSTOMER_NAME = 'KSA-Amazon'
/** Zoho invoice date is often weeks before Amazon settlement payout. */
const INVOICE_LOOKBACK_DAYS = 120

let cachedKsaCustomerId = null

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function matchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function dateOnly(value) {
  return normalizeSettlementDate(value)
}

function shiftDateIso(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function deriveInvoiceRange(rows, lookbackDays = INVOICE_LOOKBACK_DAYS) {
  const dates = []
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const raw of [row.settlementStartDate, row.settlementEndDate, row.postedDate, row.depositDate]) {
      const d = dateOnly(raw)
      if (d) dates.push(d)
    }
  }
  dates.sort()
  const today = new Date().toISOString().slice(0, 10)
  const fallbackTo = today
  const fallbackFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const settlementFromDate = dates[0] || fallbackFrom
  const settlementToDate = dates[dates.length - 1] || fallbackTo
  // Zoho invoices are often created after the settlement period ends (backfilled PO
  // numbers, delayed Books entry). Extend the fetch window through today so late
  // invoices still match when a batch is previewed or reopened.
  const toDate = settlementToDate >= today ? settlementToDate : today
  return {
    fromDate: shiftDateIso(settlementFromDate, -lookbackDays),
    toDate,
    settlementFromDate,
    settlementToDate,
    lookbackDays,
  }
}

async function resolveKsaZohoCustomerId(options = {}) {
  if (options.customerId) return clean(options.customerId)
  const fromEnv = clean(process.env.AMAZON_KSA_ZOHO_CUSTOMER_ID)
  if (fromEnv) return fromEnv
  if (cachedKsaCustomerId) return cachedKsaCustomerId
  const customers = await fetchCustomers()
  const hit = (Array.isArray(customers) ? customers : []).find(
    (customer) => clean(customer?.contact_name || customer?.customer_name) === KSA_ZOHO_CUSTOMER_NAME
  )
  cachedKsaCustomerId = clean(hit?.contact_id || hit?.customer_id)
  return cachedKsaCustomerId || null
}

function invoiceNumber(invoice) {
  return clean(invoice?.invoice_number || invoice?.number)
}

function poNumber(invoice) {
  return clean(
    invoice?.reference_number ||
      invoice?.purchaseorder_number ||
      invoice?.purchase_order_number ||
      invoice?.po_number ||
      invoice?.poNumber
  )
}

function mapInvoice(invoice) {
  return {
    zohoInvoiceId: clean(invoice?.invoice_id || invoice?.id),
    zohoInvoiceNumber: invoiceNumber(invoice),
    zohoPoNumber: poNumber(invoice),
    zohoCustomerId: clean(invoice?.customer_id || invoice?.customerId),
    zohoCustomerName: clean(invoice?.customer_name || invoice?.customerName),
    zohoInvoiceTotal: num(invoice?.total),
    status: clean(invoice?.status),
    raw: invoice,
  }
}

function creditNoteNumber(creditNote) {
  return clean(creditNote?.creditnote_number || creditNote?.credit_note_number || creditNote?.number)
}

function creditNoteReference(creditNote) {
  return clean(
    creditNote?.reference_number ||
      creditNote?.referenceNumber ||
      creditNote?.invoice_number ||
      creditNote?.invoiceNumber ||
      creditNote?.notes
  )
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
    status: clean(creditNote?.status),
    raw: creditNote,
  }
}

function indexInvoices(invoices) {
  const byInvoiceNumber = new Map()
  const byPoNumber = new Map()
  const duplicateZohoInvoiceNumbers = []
  const duplicateZohoPoNumbers = []
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    const mapped = mapInvoice(invoice)
    const invoiceKey = matchKey(mapped.zohoInvoiceNumber)
    if (invoiceKey) {
      if (!byInvoiceNumber.has(invoiceKey)) {
        byInvoiceNumber.set(invoiceKey, [])
      }
      byInvoiceNumber.get(invoiceKey).push(mapped)
    }
    const poKey = matchKey(mapped.zohoPoNumber)
    if (poKey) {
      if (!byPoNumber.has(poKey)) {
        byPoNumber.set(poKey, [])
      }
      byPoNumber.get(poKey).push(mapped)
    }
  }
  for (const matches of byInvoiceNumber.values()) {
    if (matches.length > 1) duplicateZohoInvoiceNumbers.push(matches[0].zohoInvoiceNumber)
  }
  for (const matches of byPoNumber.values()) {
    if (matches.length > 1) duplicateZohoPoNumbers.push(matches[0].zohoPoNumber)
  }
  return { byInvoiceNumber, byPoNumber, duplicateZohoInvoiceNumbers, duplicateZohoPoNumbers }
}

function invoiceMatchesForOrder(orderId, invoices) {
  const { byInvoiceNumber, byPoNumber } = indexInvoices(invoices)
  const orderKey = matchKey(orderId)
  const poMatches = byPoNumber.get(orderKey) || []
  const invoiceMatches = poMatches.length > 0 ? [] : (byInvoiceNumber.get(orderKey) || [])
  return {
    matches: poMatches.length > 0 ? poMatches : invoiceMatches,
    matchType: poMatches.length > 0 ? 'po_number' : 'invoice_number_fallback',
  }
}

function matchSettlementRowsToInvoices(rows, invoices) {
  const settlementRows = Array.isArray(rows) ? rows : []
  const { byInvoiceNumber, byPoNumber, duplicateZohoInvoiceNumbers, duplicateZohoPoNumbers } = indexInvoices(invoices)
  const matchedRows = []
  const unmatchedRows = []
  const matchedInvoices = []
  const unmatchedOrderIdsSet = new Set()
  const missingOrderIdRows = []

  for (const row of settlementRows) {
    const orderId = clean(row.orderId)
    const orderKey = matchKey(orderId)
    if (isNonOrderLinkedAmazonFee(row)) {
      continue
    }
    if (!orderId) {
      missingOrderIdRows.push(row)
      unmatchedRows.push({ ...row, reason: 'Settlement row is missing Amazon order ID' })
      continue
    }
    const poMatches = byPoNumber.get(orderKey) || []
    const invoiceMatches = poMatches.length > 0 ? [] : (byInvoiceNumber.get(orderKey) || [])
    const matches = poMatches.length > 0 ? poMatches : invoiceMatches
    if (matches.length > 0) {
      const invoice = matches[0]
      const matchType = poMatches.length > 0 ? 'po_number' : 'invoice_number_fallback'
      matchedRows.push({ ...row, zohoInvoice: invoice, matchType })
      matchedInvoices.push({ ...invoice, matchType })
    } else {
      unmatchedRows.push({ ...row, reason: 'No Zoho invoice found with matching PO number or invoice_number' })
      unmatchedOrderIdsSet.add(orderId)
    }
  }

  const uniqueMatchedInvoices = []
  const seen = new Set()
  for (const invoice of matchedInvoices) {
    const key = invoice.zohoInvoiceId || invoice.zohoInvoiceNumber
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniqueMatchedInvoices.push(invoice)
  }

  return {
    matchedRows,
    unmatchedRows,
    matchedInvoices: uniqueMatchedInvoices,
    unmatchedOrderIds: Array.from(unmatchedOrderIdsSet).sort(),
    duplicateZohoInvoiceNumbers,
    duplicateZohoPoNumbers,
    missingOrderIdRows,
  }
}

function isRefundReturnRow(row) {
  return row?.rowClass === ROW_CLASS.REFUND || row?.rowClass === ROW_CLASS.RETURN
}

function creditNoteMatchesInvoiceOrOrder(creditNote, invoice, orderId) {
  const cn = mapCreditNote(creditNote)
  const orderKey = matchKey(orderId)
  const invoiceIdKey = matchKey(invoice?.zohoInvoiceId)
  const invoiceNumberKey = matchKey(invoice?.zohoInvoiceNumber)

  if (invoiceIdKey && cn.invoiceIds.some((id) => matchKey(id) === invoiceIdKey)) {
    return true
  }
  if (orderKey && matchKey(cn.zohoCreditNoteNumber) === orderKey) {
    return true
  }
  if (invoiceNumberKey && matchKey(cn.referenceNumber) === invoiceNumberKey) {
    return true
  }

  const refs = [
    cn.referenceNumber,
    cn.zohoCreditNoteNumber,
    ...(Array.isArray(cn.invoiceIds) ? cn.invoiceIds : []),
  ].map(matchKey).filter(Boolean)
  const needles = [
    orderId,
    invoice?.zohoInvoiceId,
    invoice?.zohoInvoiceNumber,
    invoice?.zohoPoNumber,
  ].map(matchKey).filter(Boolean)

  return needles.some((needle) => refs.some((ref) => ref === needle || ref.includes(needle) || needle.includes(ref)))
}

function groupRefundRowsByOrder(rows) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRefundReturnRow(row)) continue
    const orderId = clean(row.orderId)
    if (!orderId) continue
    if (!groups.has(orderId)) groups.set(orderId, [])
    groups.get(orderId).push(row)
  }
  return groups
}

function principalRefundAmountForOrderRows(orderRows) {
  const breakdown = buildReturnFeeBreakdown(orderRows)
  return Math.abs(round2(breakdown.customerRefundAmount))
}

function representativeRefundRowForOrder(orderId, orderRows) {
  const principal = principalRefundAmountForOrderRows(orderRows)
  const principalRow = orderRows.find(
    (row) => clean(row.amountType) === 'ItemPrice' && clean(row.amountDescription).toLowerCase() === 'principal'
  )
  const representative = principalRow || orderRows[0]
  return {
    ...representative,
    orderId,
    amount: principal > 0 ? -principal : representative.amount,
    amazonRefundAmount: principal,
  }
}

function matchRefundReturnRowsToCreditNotes(rows, invoices, creditNotes) {
  const refundRowsByOrder = groupRefundRowsByOrder(rows)
  const mappedCreditNotes = (Array.isArray(creditNotes) ? creditNotes : []).map(mapCreditNote)
  const matchedReturns = []
  const missingCreditNotes = []
  const blockingRows = []

  for (const [orderId, orderRows] of refundRowsByOrder.entries()) {
    const row = representativeRefundRowForOrder(orderId, orderRows)
    const amazonRefundAmount = principalRefundAmountForOrderRows(orderRows) || Math.abs(round2(row.amount))
    const base = {
      rowClass: row.rowClass,
      category: row.category,
      orderId,
      amazonRefundAmount,
      transactionType: row.transactionType || '',
      amountType: row.amountType || '',
      amountDescription: row.amountDescription || '',
      originalRawRow: row.originalRawRow || row.rawRow || row,
    }

    function blocked(reason, extra = {}) {
      const out = {
        ...base,
        ...extra,
        creditNoteAction: 'blocked',
        status: 'blocked',
        blockingReason: reason,
        creditNoteDifference: round2(Number(extra.creditNoteAmount || 0) - amazonRefundAmount),
      }
      blockingRows.push(out)
      missingCreditNotes.push(out)
      return out
    }

    if (!orderId) {
      blocked('Amazon refund/return row is missing order ID.')
      continue
    }

    const invoiceMatch = invoiceMatchesForOrder(orderId, invoices)
    if (invoiceMatch.matches.length === 0) {
      blocked('No Zoho invoice found for the refund/return Amazon order ID.')
      continue
    }
    if (invoiceMatch.matches.length > 1) {
      blocked('Multiple Zoho invoices match this Amazon order ID; invoice relationship is unclear.', {
        candidateInvoiceNumbers: invoiceMatch.matches.map((invoice) => invoice.zohoInvoiceNumber).filter(Boolean),
      })
      continue
    }

    const invoice = invoiceMatch.matches[0]
    const creditNoteMatches = (Array.isArray(creditNotes) ? creditNotes : [])
      .filter((creditNote) => creditNoteMatchesInvoiceOrOrder(creditNote, invoice, orderId))
      .map(mapCreditNote)
    const invoiceFields = {
      zohoInvoiceId: invoice.zohoInvoiceId,
      zohoInvoiceNumber: invoice.zohoInvoiceNumber,
      zohoPoNumber: invoice.zohoPoNumber,
      zohoCustomerId: invoice.zohoCustomerId,
      zohoCustomerName: invoice.zohoCustomerName,
      matchType: invoiceMatch.matchType,
    }

    if (creditNoteMatches.length === 0) {
      matchedReturns.push({
        ...base,
        ...invoiceFields,
        creditNoteAction: 'ready_to_create',
        status: 'ready_to_create',
        creditNoteAmount: 0,
        creditNoteDifference: round2(0 - amazonRefundAmount),
        blockingReason: '',
        originalRawRow: row.originalRawRow || row.rawRow || row,
      })
      continue
    }
    if (creditNoteMatches.length > 1) {
      blocked('Multiple Zoho credit notes match this Amazon refund/return; credit-note relationship is unclear.', {
        ...invoiceFields,
        candidateCreditNoteNumbers: creditNoteMatches.map((creditNote) => creditNote.zohoCreditNoteNumber).filter(Boolean),
      })
      continue
    }

    const creditNote = creditNoteMatches[0]
    const creditNoteAmount = Math.abs(round2(creditNote.amount))
    const invoiceTotal = Math.abs(round2(invoice.zohoInvoiceTotal))
    const creditNoteDifference = round2(creditNoteAmount - amazonRefundAmount)
    const orderKey = matchKey(orderId)
    const matchesOrderLinkedCn =
      orderKey &&
      matchKey(creditNote.zohoCreditNoteNumber) === orderKey &&
      invoiceTotal > 0 &&
      Math.abs(creditNoteAmount - invoiceTotal) <= 0.01
    const matchesInvoiceTotal =
      invoiceTotal > 0 && Math.abs(creditNoteAmount - invoiceTotal) <= 0.01
    const matchesPrincipal = Math.abs(creditNoteDifference) <= 0.01
    const isMatched = matchesPrincipal || matchesInvoiceTotal || matchesOrderLinkedCn
    const out = {
      ...base,
      ...invoiceFields,
      zohoCreditNoteId: creditNote.zohoCreditNoteId,
      zohoCreditNoteNumber: creditNote.zohoCreditNoteNumber,
      creditNoteAmount,
      creditNoteStatus: creditNote.status,
      creditNoteDifference,
      creditNoteAction: 'matched_existing',
      status: isMatched ? 'matched' : 'blocked',
      blockingReason: isMatched
        ? ''
        : 'Credit note amount differs from Amazon refund/return amount by more than 0.01.',
      originalRawRow: row.originalRawRow || row.rawRow || row,
    }
    matchedReturns.push(out)
    if (out.status !== 'matched') {
      out.creditNoteAction = 'blocked'
      blockingRows.push(out)
      missingCreditNotes.push(out)
    }
  }

  return {
    matchedReturns,
    missingCreditNotes,
    creditNoteBlockingRows: blockingRows,
    creditNotes: mappedCreditNotes,
  }
}

async function fetchZohoInvoicesForSettlementRows(rows, options = {}) {
  const range = {
    ...deriveInvoiceRange(rows),
    ...(options.fromDate ? { fromDate: options.fromDate } : {}),
    ...(options.toDate ? { toDate: options.toDate } : {}),
  }
  const customerId = await resolveKsaZohoCustomerId(options)
  if (Array.isArray(options.invoices)) {
    return {
      rows: options.invoices,
      truncated: false,
      pages: 0,
      ...range,
      customerId,
      customerName: KSA_ZOHO_CUSTOMER_NAME,
    }
  }
  const result = await fetchInvoices(range.fromDate, range.toDate, customerId || null)
  return {
    rows: Array.isArray(result?.rows) ? result.rows : [],
    truncated: Boolean(result?.truncated),
    pages: Number(result?.pages) || 0,
    ...range,
    customerId,
    customerName: KSA_ZOHO_CUSTOMER_NAME,
  }
}

async function fetchZohoCreditNotesForSettlementRows(rows, options = {}) {
  const range = {
    ...deriveInvoiceRange(rows),
    ...(options.fromDate ? { fromDate: options.fromDate } : {}),
    ...(options.toDate ? { toDate: options.toDate } : {}),
  }
  const customerId = await resolveKsaZohoCustomerId(options)
  if (Array.isArray(options.creditNotes)) {
    return {
      rows: options.creditNotes,
      truncated: false,
      pages: 0,
      ...range,
      customerId,
      customerName: KSA_ZOHO_CUSTOMER_NAME,
    }
  }
  const result = await fetchCreditNotes(range.fromDate, range.toDate, customerId || null)
  return {
    rows: Array.isArray(result?.rows) ? result.rows : [],
    truncated: Boolean(result?.truncated),
    pages: Number(result?.pages) || 0,
    ...range,
    customerId,
    customerName: KSA_ZOHO_CUSTOMER_NAME,
  }
}

function buildZohoFetchWarnings(zohoFetch) {
  const warnings = []
  if (!zohoFetch) return warnings
  if (!zohoFetch.rows.length) {
    warnings.push('No Zoho invoices were loaded for matching. Check Zoho API credentials and limits, then re-run preview.')
    return warnings
  }
  if (zohoFetch.truncated) {
    warnings.push(
      `Zoho invoice fetch was truncated at 4,000 rows for ${zohoFetch.customerName || 'KSA-Amazon'} (${zohoFetch.fromDate} to ${zohoFetch.toDate}). Some matches may be missing.`
    )
  }
  if (!zohoFetch.customerId) {
    warnings.push(`Could not resolve Zoho customer "${KSA_ZOHO_CUSTOMER_NAME}". Set AMAZON_KSA_ZOHO_CUSTOMER_ID or verify the customer exists in Zoho Books.`)
  }
  return warnings
}

function buildCreditNoteFetchWarnings(creditNoteFetch, refundRows) {
  const warnings = []
  if (!refundRows.length || !creditNoteFetch) return warnings
  if (!creditNoteFetch.rows.length) {
    warnings.push('No Zoho credit notes were loaded for matching Amazon refund/return rows.')
  }
  if (creditNoteFetch.truncated) {
    warnings.push(
      `Zoho credit note fetch was truncated for ${creditNoteFetch.customerName || 'KSA-Amazon'} (${creditNoteFetch.fromDate} to ${creditNoteFetch.toDate}). Some refund/return matches may be missing.`
    )
  }
  return warnings
}

async function matchZohoInvoicesForRows(rows, options = {}) {
  const settlementRows = Array.isArray(rows) ? rows : []
  const zohoFetch = await fetchZohoInvoicesForSettlementRows(settlementRows, options)
  const creditNoteFetch = await fetchZohoCreditNotesForSettlementRows(settlementRows, options)
  const invoices = zohoFetch.rows
  const syntheticRefundRows = detectNetNegativeOrderRefundRows(settlementRows)
  const netNegativeReturnOrderIds = new Set(syntheticRefundRows.map((row) => clean(row.orderId)).filter(Boolean))
  const explicitRefundRows = settlementRows.filter(isRefundReturnRow)
  const refundRows = [...explicitRefundRows, ...syntheticRefundRows]
  const creditNoteMatch = matchRefundReturnRowsToCreditNotes(refundRows, invoices, creditNoteFetch.rows)
  const salesRows = settlementRows.filter((row) => {
    if (isRefundReturnRow(row) || isNonOrderLinkedAmazonFee(row)) return false
    const orderId = clean(row.orderId)
    return !(orderId && netNegativeReturnOrderIds.has(orderId))
  })
  return {
    invoices,
    creditNotes: creditNoteMatch.creditNotes,
    zohoFetch,
    creditNoteFetch,
    syntheticRefundRows,
    netNegativeReturnOrderIds: Array.from(netNegativeReturnOrderIds).sort(),
    zohoFetchWarnings: [
      ...buildZohoFetchWarnings(zohoFetch),
      ...buildCreditNoteFetchWarnings(creditNoteFetch, refundRows),
      ...(syntheticRefundRows.length
        ? [
            `${syntheticRefundRows.length} order(s) have negative principal/net in this settlement and must be cleared via Zoho credit notes, not invoice payments.`,
          ]
        : []),
    ],
    ...creditNoteMatch,
    ...matchSettlementRowsToInvoices(salesRows, invoices),
  }
}

module.exports = {
  KSA_ZOHO_CUSTOMER_NAME,
  INVOICE_LOOKBACK_DAYS,
  deriveInvoiceRange,
  matchSettlementRowsToInvoices,
  matchRefundReturnRowsToCreditNotes,
  matchZohoInvoicesForRows,
  fetchZohoInvoicesForSettlementRows,
  fetchZohoCreditNotesForSettlementRows,
  buildZohoFetchWarnings,
  resolveKsaZohoCustomerId,
  _internals: {
    indexInvoices,
    mapInvoice,
    mapCreditNote,
    invoiceNumber,
    poNumber,
    matchKey,
    shiftDateIso,
    groupRefundRowsByOrder,
    principalRefundAmountForOrderRows,
    creditNoteMatchesInvoiceOrOrder,
  },
}

'use strict'

/**
 * Pure Tabby settlement rules: row normalization, statement reconciliation, order matching,
 * the complete posting plan (built before any Zoho write) and a ledger simulation of that plan.
 * No I/O. Amounts are integer fils until a Zoho payload is built.
 *
 * Accounting per statement (COMBINED layout, per Zoho customer like Stripe payouts):
 *   SALE_NET                  one customer payment  Dr Tabby Undeposited    / Cr every invoice (AR)   transferred amounts
 *   SALE_CHARGES              one customer payment  Dr Tabby Processing Chg / Cr every invoice (AR)   gross − transferred
 *   REFUND_PAYMENT            credit note refund from Tabby Undeposited (one per refund)                refunded gross
 *   SETTLEMENT_JOURNAL        one journal, net per account: Dr Commission + Dr Fees + Dr Input VAT
 *                             / Cr Tabby Processing Chg (to zero) / Cr Tabby Undeposited (payout fee, less
 *                             what Tabby returned on refunds)
 *   BANK_SETTLEMENT           transfer Tabby Undeposited → RAK Bank (only when no existing transfer is found)
 *
 * PER_INVOICE layout (statements already posted that way are never re-planned): one SALE_NET and
 * SALE_CHARGES payment per invoice, REFUND_*_REVERSAL journals per refund, and separate
 * CHARGE_EXPENSE_CLEARING and PAYOUT_FEE journals.
 */

const crypto = require('crypto')
const { ROW_KIND } = require('./tabbyStatementParser')
const { ACCOUNT_ROLE } = require('../../config/tabbyClearing')
const { buildCustomerPaymentPayload, buildManualJournalPayload } = require('../amazonPaymentClearingZohoPaymentService')

const COMPONENT = Object.freeze({
  SALE_NET: 'SALE_NET',
  SALE_CHARGES: 'SALE_CHARGES',
  REFUND_CREDIT_NOTE: 'REFUND_CREDIT_NOTE',
  REFUND_PAYMENT: 'REFUND_PAYMENT',
  REFUND_COMMISSION_REVERSAL: 'REFUND_COMMISSION_REVERSAL',
  REFUND_FEE_REVERSAL: 'REFUND_FEE_REVERSAL',
  REFUND_VAT_REVERSAL: 'REFUND_VAT_REVERSAL',
  CHARGE_EXPENSE_CLEARING: 'CHARGE_EXPENSE_CLEARING',
  PAYOUT_FEE: 'PAYOUT_FEE',
  SETTLEMENT_JOURNAL: 'SETTLEMENT_JOURNAL',
  BANK_SETTLEMENT: 'BANK_SETTLEMENT',
})

const PLAN_LAYOUT = Object.freeze({
  COMBINED: 'COMBINED',
  PER_INVOICE: 'PER_INVOICE',
})

const CUSTOMER_SCOPE = 'CUSTOMER:'
const PER_INVOICE_ONLY = new Set([
  COMPONENT.REFUND_COMMISSION_REVERSAL,
  COMPONENT.REFUND_FEE_REVERSAL,
  COMPONENT.REFUND_VAT_REVERSAL,
  COMPONENT.CHARGE_EXPENSE_CLEARING,
  COMPONENT.PAYOUT_FEE,
])

/** A stored component that only exists in the PER_INVOICE layout. */
function isPerInvoiceComponent(c) {
  if (PER_INVOICE_ONLY.has(c.component)) return true
  return (c.component === COMPONENT.SALE_NET || c.component === COMPONENT.SALE_CHARGES) && !String(c.scope || '').startsWith(CUSTOMER_SCOPE)
}

// Execution order. Every sale is paid before any refund, so a sale and its refund in the same
// statement never run in Excel row order.
const PHASE = Object.freeze({
  [COMPONENT.SALE_NET]: 10,
  [COMPONENT.SALE_CHARGES]: 11,
  [COMPONENT.REFUND_CREDIT_NOTE]: 20,
  [COMPONENT.REFUND_PAYMENT]: 20,
  [COMPONENT.REFUND_COMMISSION_REVERSAL]: 21,
  [COMPONENT.REFUND_FEE_REVERSAL]: 22,
  [COMPONENT.REFUND_VAT_REVERSAL]: 23,
  [COMPONENT.CHARGE_EXPENSE_CLEARING]: 30,
  [COMPONENT.SETTLEMENT_JOURNAL]: 30,
  [COMPONENT.PAYOUT_FEE]: 40,
  [COMPONENT.BANK_SETTLEMENT]: 50,
})

const MATCH_STATUS = Object.freeze({
  MATCHED: 'MATCHED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  IDENTIFIER_CONFLICT: 'IDENTIFIER_CONFLICT',
  IDENTIFIER_MISSING: 'IDENTIFIER_MISSING',
  WEBSITE_ORDER_AMBIGUOUS: 'WEBSITE_ORDER_AMBIGUOUS',
  ORDER_DELETED: 'ORDER_DELETED',
  NO_ZOHO_INVOICE: 'NO_ZOHO_INVOICE',
  MULTIPLE_ZOHO_INVOICES: 'MULTIPLE_ZOHO_INVOICES',
  CUSTOMER_MISMATCH: 'CUSTOMER_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  INVOICE_DRAFT: 'INVOICE_DRAFT',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  NOT_CHECKED: 'NOT_CHECKED',
})

const BANK_STATUS = Object.freeze({
  BANK_MATCHED: 'BANK_MATCHED',
  BANK_MATCH_PENDING: 'BANK_MATCH_PENDING',
  BANK_MATCH_AMBIGUOUS: 'BANK_MATCH_AMBIGUOUS',
  BANK_NOT_REQUIRED: 'BANK_NOT_REQUIRED',
  BANK_LOOKUP_FAILED: 'BANK_LOOKUP_FAILED',
})

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100
}

function money(minor) {
  return toMajor(minor).toFixed(2)
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

/** Drop undefined keys so payloads are exactly what JSON sends. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra }
}

// ── Row normalization ───────────────────────────────────────────────────────

const MONEY = ['orderAmount', 'refundableCommission', 'nonRefundableCommission', 'fixedFee', 'totalFee', 'vatAmount', 'totalDeduction', 'transferredAmount']

function vatProblem(vatMinor, baseMinor, config) {
  const expected = Math.round(baseMinor * config.vatRate)
  return Math.abs(vatMinor - expected) > config.vatToleranceMinor ? `VAT ${money(vatMinor)} is not ${config.vatRate * 100}% of ${money(baseMinor)} (expected ≈ ${money(expected)}).` : null
}

/**
 * Economic fields of one SALE / REFUND / PAYOUT_FEE row, validated. Effects follow the
 * settlement's own sign: gross > 0 for money Tabby owes us, charges > 0 for what Tabby keeps,
 * transfer = gross − deduction.
 * @param {object} row parsed row (minor units)
 * @param {object} config tabby clearing config
 */
function normalizeRow(row, config) {
  const tol = config.toleranceMinor
  const problems = []
  const warnings = []
  const m = { ...row.minor }
  let signNormalized = false

  if (row.kind === ROW_KIND.PAYOUT_FEE) {
    const fee = m.totalFee || m.fixedFee
    const vat = m.vatAmount
    const transfer = m.transferredAmount
    if (fee < 0 || vat < 0) problems.push(issue('PAYOUT_FEE_FORMAT', `Payout fee ${money(fee)} / VAT ${money(vat)} must not be negative.`))
    if (Math.abs(fee + vat + transfer) > tol) problems.push(issue('PAYOUT_FEE_NOT_RECONCILED', `Payout fee ${money(fee)} + VAT ${money(vat)} does not equal the ${money(-transfer)} taken from the transfer.`))
    const vp = vatProblem(vat, fee, config)
    if (vp) problems.push(issue('VAT_RATE_MISMATCH', `Payout fee: ${vp}`))
    const effects = { grossEffect: 0, commissionEffect: 0, fixedFeeEffect: fee, vatEffect: vat, deductionEffect: fee + vat, transferEffect: transfer, roundingEffect: -transfer - fee - vat }
    return { effects, economics: { feeMinor: fee, vatMinor: vat, transferMinor: transfer }, problems, warnings, signNormalized }
  }

  if (row.kind === ROW_KIND.REFUND && m.orderAmount > 0) {
    // Positive-formatted refund: the whole row is the mirror image of the refund.
    for (const k of MONEY) m[k] = -m[k] || 0
    signNormalized = true
  }
  const gross = m.orderAmount
  const refundable = m.refundableCommission
  const nonRefundable = m.nonRefundableCommission
  const commission = refundable + nonRefundable
  const fixed = m.fixedFee
  const totalFee = m.totalFee
  const vat = m.vatAmount
  const deduction = m.totalDeduction
  const transfer = m.transferredAmount
  const refund = row.kind === ROW_KIND.REFUND
  const code = (c) => (refund ? 'UNSUPPORTED_REFUND_FORMAT' : c)

  if (refund) {
    if (gross >= 0) problems.push(issue('UNSUPPORTED_REFUND_FORMAT', `Refund row has order amount ${money(gross)}; a refund must return money.`))
  } else {
    if (gross <= 0) problems.push(issue('SALE_FORMAT', `Sale row has order amount ${money(gross)}.`))
    if (refundable < 0 || nonRefundable < 0 || fixed < 0 || vat < 0 || deduction < 0) problems.push(issue('SALE_FORMAT', 'Sale charges must not be negative.'))
  }
  if (Math.abs(commission + fixed - totalFee) > tol) {
    problems.push(issue(code('CHARGES_NOT_RECONCILED'), `Commission ${money(commission)} + fixed fee ${money(fixed)} = ${money(commission + fixed)}, but Total Fee is ${money(totalFee)}.`))
  }
  if (Math.abs(totalFee + vat - deduction) > tol) {
    problems.push(issue(code('DEDUCTION_NOT_RECONCILED'), `Total Fee ${money(totalFee)} + VAT ${money(vat)} = ${money(totalFee + vat)}, but Total Deduction is ${money(deduction)}.`))
  }
  if (Math.abs(gross - deduction - transfer) > tol) {
    problems.push(issue(code('TRANSFER_NOT_RECONCILED'), `Order amount ${money(gross)} − deduction ${money(deduction)} = ${money(gross - deduction)}, but Transferred is ${money(transfer)}.`))
  }
  const vp = vatProblem(Math.abs(vat), Math.abs(totalFee), config)
  if (vp) problems.push(issue('VAT_RATE_MISMATCH', vp))
  if (refund && nonRefundable !== 0) warnings.push(issue('NON_REFUNDABLE_COMMISSION_RETURNED', `Tabby returned ${money(-nonRefundable)} of non-refundable commission on this refund; it is reversed as reported.`))
  if (refund && deduction > 0) warnings.push(issue('REFUND_EXTRA_CHARGE', `Tabby charged ${money(deduction)} more on this refund; it is booked as an expense.`))

  const effects = {
    grossEffect: gross,
    commissionEffect: commission,
    fixedFeeEffect: fixed,
    vatEffect: vat,
    deductionEffect: deduction,
    transferEffect: transfer,
    // Charge part of the invoice not explained by the components (≤ 1 fils); booked with fees.
    roundingEffect: (gross - transfer) - (commission + fixed + vat),
  }
  if (Math.abs(effects.roundingEffect) > tol) problems.push(issue(code('ROUNDING_TOO_LARGE'), `Charges differ from their components by ${money(effects.roundingEffect)}.`))
  return {
    effects,
    economics: { grossMinor: gross, refundableMinor: refundable, nonRefundableMinor: nonRefundable, commissionMinor: commission, fixedFeeMinor: fixed, totalFeeMinor: totalFee, vatMinor: vat, deductionMinor: deduction, transferMinor: transfer },
    problems,
    warnings,
    signNormalized,
  }
}

/** Deterministic identity of a row's content; identical rows in one file get their occurrence. */
function rowFingerprint(row, occurrence = 0) {
  return sha256([row.kind, clean(row.subtype), clean(row.orderNumber), clean(row.websiteOrderId), clean(row.saleRefundDate), ...MONEY.map((k) => row.minor[k]), occurrence])
}

function assignFingerprints(rows) {
  const seen = new Map()
  return rows.map((row) => {
    const base = rowFingerprint(row, 0)
    const occurrence = seen.get(base) || 0
    seen.set(base, occurrence + 1)
    return { ...row, occurrence, fingerprint: occurrence === 0 ? base : rowFingerprint(row, occurrence) }
  })
}

// ── Statement reconciliation ────────────────────────────────────────────────

const TOTAL_COLUMNS = ['orderAmount', 'refundableCommission', 'nonRefundableCommission', 'fixedFee', 'totalFee', 'vatAmount', 'totalDeduction']

/**
 * Normalize every row and reconcile the statement against its own totals row.
 * @returns {{ rows: object[], totals: object, blockers: object[], warnings: object[], transferDate: string|null }}
 */
function analyzeStatement(parsed, config) {
  const blockers = [...(parsed.problems || []).map((p) => ({ ...p }))]
  const warnings = []
  const st = parsed.statement || {}
  if (st.currencyFromNumber && st.currencyFromNumber !== config.currency) blockers.push(issue('CURRENCY_NOT_AED', `Statement ${st.statementNumber} is in ${st.currencyFromNumber}, not ${config.currency}.`))

  const rows = assignFingerprints(parsed.rows || []).map((row) => {
    const out = { ...row, problems: [...(row.problems || [])], warnings: [] }
    if (row.kind === ROW_KIND.SALE || row.kind === ROW_KIND.REFUND || row.kind === ROW_KIND.PAYOUT_FEE) {
      const n = normalizeRow(row, config)
      out.effects = n.effects
      out.economics = n.economics
      out.signNormalized = n.signNormalized
      out.problems.push(...n.problems)
      out.warnings.push(...n.warnings)
    }
    if (row.kind === ROW_KIND.SALE || row.kind === ROW_KIND.REFUND) {
      if (row.currency !== config.currency) out.problems.push(issue('CURRENCY_NOT_AED', `Row currency is ${row.currency || '(blank)'}, not ${config.currency}.`))
      if (config.expectedMerchantCode && row.merchantCode !== config.expectedMerchantCode) out.problems.push(issue('MERCHANT_MISMATCH', `Merchant code is ${row.merchantCode || '(blank)'}, not ${config.expectedMerchantCode}.`))
      if (!row.orderNumber || !row.websiteOrderId) out.problems.push(issue('IDENTIFIER_MISSING', 'Order Number and website order ID are both required.'))
    }
    if (row.kind === ROW_KIND.UNKNOWN) out.problems.push(issue('UNSUPPORTED_ROW', 'Row is not a sale, refund, payout fee, total or note; posting is blocked until it is understood.'))
    return out
  })

  for (const r of rows) for (const p of r.problems) blockers.push({ ...p, excelRow: r.excelRow })
  for (const r of rows) for (const w of r.warnings) warnings.push({ ...w, excelRow: r.excelRow })

  const sales = rows.filter((r) => r.kind === ROW_KIND.SALE)
  const refunds = rows.filter((r) => r.kind === ROW_KIND.REFUND)
  const payouts = rows.filter((r) => r.kind === ROW_KIND.PAYOUT_FEE)
  const totalRows = rows.filter((r) => r.kind === ROW_KIND.TOTAL)

  const bySale = new Map()
  for (const s of sales) {
    const key = s.websiteOrderId
    if (bySale.has(key)) blockers.push(issue('DUPLICATE_SALE_ROW', `Order ${key} appears as a sale more than once (rows ${bySale.get(key)} and ${s.excelRow}).`, { excelRow: s.excelRow }))
    else bySale.set(key, s.excelRow)
  }

  const sum = (list, f) => list.reduce((s, r) => s + (f(r) || 0), 0)
  const txRows = [...sales, ...refunds]
  const reported = Object.fromEntries(TOTAL_COLUMNS.map((k) => [k, sum(txRows, (r) => r.minor[k])]))
  reported.transferredAmount = sum([...txRows, ...payouts], (r) => r.minor.transferredAmount)
  if (totalRows.length === 0) blockers.push(issue('TOTAL_ROW_MISSING', 'The statement has no totals row to reconcile against.'))
  if (totalRows.length > 1) blockers.push(issue('TOTAL_ROW_AMBIGUOUS', `The statement has ${totalRows.length} totals rows.`))
  const totalCheck = []
  if (totalRows.length === 1) {
    const t = totalRows[0]
    for (const k of [...TOTAL_COLUMNS, 'transferredAmount']) {
      const diff = t.minor[k] - reported[k]
      totalCheck.push({ column: k, rows: toMajor(reported[k]), total: toMajor(t.minor[k]), difference: toMajor(diff) })
      if (Math.abs(diff) > config.toleranceMinor) blockers.push(issue('TOTALS_NOT_RECONCILED', `Totals row ${k} ${money(t.minor[k])} ≠ sum of rows ${money(reported[k])}.`, { excelRow: t.excelRow }))
    }
  }

  const transferDates = [...new Set(txRows.map((r) => r.transferDate).filter(Boolean))]
  if (transferDates.length > 1) warnings.push(issue('MULTIPLE_TRANSFER_DATES', `Rows carry more than one transfer date: ${transferDates.join(', ')}.`))
  const transferDate = transferDates.length === 1 ? transferDates[0] : st.statementDate || null
  if (txRows.length === 0 && payouts.length === 0) blockers.push(issue('NO_TRANSACTIONS', 'The statement has no sale, refund or payout fee rows.'))

  const e = (list, k) => sum(list, (r) => r.effects && r.effects[k])
  const x = (list, k) => sum(list, (r) => r.economics && r.economics[k])
  const saleCommission = x(sales, 'commissionMinor')
  const saleFixed = x(sales, 'fixedFeeMinor')
  const saleVat = x(sales, 'vatMinor')
  const saleRounding = e(sales, 'roundingEffect')
  const refundCommission = e(refunds, 'commissionEffect')
  const refundFixed = e(refunds, 'fixedFeeEffect') + e(refunds, 'roundingEffect')
  const refundVat = e(refunds, 'vatEffect')
  const payoutFee = x(payouts, 'feeMinor')
  const payoutVat = x(payouts, 'vatMinor')
  const payoutRounding = e(payouts, 'roundingEffect')
  const prePayout = e(txRows, 'transferEffect')
  const totals = {
    saleCount: sales.length,
    refundCount: refunds.length,
    payoutFeeCount: payouts.length,
    salesGrossMinor: e(sales, 'grossEffect'),
    refundsGrossMinor: e(refunds, 'grossEffect'),
    netSalesEffectMinor: e(txRows, 'grossEffect'),
    refundableCommissionMinor: x(sales, 'refundableMinor'),
    nonRefundableCommissionMinor: x(sales, 'nonRefundableMinor'),
    commissionExpenseMinor: saleCommission,
    refundCommissionEffectMinor: refundCommission,
    refundRefundableCommissionMinor: x(refunds, 'refundableMinor'),
    refundNonRefundableCommissionMinor: x(refunds, 'nonRefundableMinor'),
    transactionFixedFeeMinor: saleFixed,
    transactionRoundingMinor: saleRounding,
    refundFixedFeeEffectMinor: refundFixed,
    transactionTotalFeeMinor: x(sales, 'totalFeeMinor'),
    transactionVatMinor: saleVat,
    refundVatEffectMinor: refundVat,
    transactionDeductionMinor: x(sales, 'deductionMinor'),
    saleChargesMinor: sum(sales, (r) => r.economics && r.economics.grossMinor - r.economics.transferMinor),
    saleNetMinor: x(sales, 'transferMinor'),
    refundTransferMinor: e(refunds, 'transferEffect'),
    prePayoutTransferMinor: prePayout,
    payoutFeeMinor: payoutFee,
    payoutVatMinor: payoutVat,
    payoutRoundingMinor: payoutRounding,
    payoutTransferMinor: e(payouts, 'transferEffect'),
    bankPayoutMinor: prePayout + e(payouts, 'transferEffect'),
    // Final P&L / VAT classification of the statement (refund effects are signed).
    commissionExpenseNetMinor: saleCommission + refundCommission,
    feesExpenseNetMinor: saleFixed + saleRounding + payoutFee + payoutRounding + refundFixed,
    inputVatNetMinor: saleVat + payoutVat + refundVat,
    reportedTotals: totalRows.length === 1 ? { ...totalRows[0].minor } : null,
    totalCheck,
  }
  return { rows, totals, blockers, warnings, transferDate }
}

// ── Matching ────────────────────────────────────────────────────────────────

const LIVE = (inv) => inv.status !== 'void'

/**
 * Deterministic match of one SALE/REFUND row: "Order Number" → website orders.id and
 * "website order ID" → website orders.invoice_number must be the same order, whose Zoho invoice
 * carries the website invoice number as its reference. Amount, customer and date only validate.
 * @param {{ row: object, byId: object[], byNumber: object[], zohoInvoices: object[]|null, config: object }} input
 */
function matchRow({ row, byId, byNumber, zohoInvoices, config }) {
  const out = (status, reason, extra = {}) => ({ status, reason, matched: status === MATCH_STATUS.MATCHED, warnings: [], ...extra })
  if (!row.orderNumber || !row.websiteOrderId) return out(MATCH_STATUS.IDENTIFIER_MISSING, 'Order Number and website order ID are both required.')
  const idLive = byId.filter((o) => !o.deleted)
  const numLive = byNumber.filter((o) => !o.deleted)
  if (byId.length === 0 && byNumber.length === 0) return out(MATCH_STATUS.ORDER_NOT_FOUND, `No website order has id ${row.orderNumber} or invoice number ${row.websiteOrderId}.`)
  if (byId.length === 0) return out(MATCH_STATUS.ORDER_NOT_FOUND, `No website order has id ${row.orderNumber} (Tabby Order Number); invoice number ${row.websiteOrderId} is order ${byNumber.map((o) => o.orderId).join(', ')}.`)
  if (byNumber.length === 0) return out(MATCH_STATUS.ORDER_NOT_FOUND, `No website order has invoice number ${row.websiteOrderId} (Tabby website order ID); order ${row.orderNumber} is invoice ${byId[0].orderNumber || '(none)'}.`)
  if (numLive.length > 1) return out(MATCH_STATUS.WEBSITE_ORDER_AMBIGUOUS, `${numLive.length} website orders use invoice number ${row.websiteOrderId}.`)
  const a = byId[0]
  const b = byNumber.length === 1 ? byNumber[0] : numLive[0]
  if (!b || a.orderId !== b.orderId) {
    return out(MATCH_STATUS.IDENTIFIER_CONFLICT, `Tabby Order Number ${row.orderNumber} is website order ${a.orderId} (invoice ${a.orderNumber}), but website order ID ${row.websiteOrderId} is order ${b ? b.orderId : '(none)'}.`)
  }
  const order = a
  if (idLive.length === 0 || order.deleted) return out(MATCH_STATUS.ORDER_DELETED, `Website order ${order.orderId} is deleted.`, { order })
  const warnings = []
  if (order.paymentMethod && order.paymentMethod.toLowerCase() !== 'tabby') warnings.push(issue('PAYMENT_METHOD_NOT_TABBY', `Website order payment method is ${order.paymentMethod}.`))
  if (order.orderStatus === 'partiallyReturned' || order.orderStatus === 'returned') warnings.push(issue('WEBSITE_RETURN_STATUS', `Website order status is ${order.orderStatus}; money only moves with Tabby refund rows.`))
  const gross = row.economics ? row.economics.grossMinor : row.minor.orderAmount
  const expectedCustomerId = order.shopOrder ? config.shopZohoCustomerId : config.websiteZohoCustomerId
  if (row.kind === ROW_KIND.SALE) {
    if (order.paymentStatus && order.paymentStatus !== 'completed') return out(MATCH_STATUS.AMOUNT_MISMATCH, `Website payment status is ${order.paymentStatus}.`, { order, warnings })
    if (Math.round(order.finalAmount * 100) !== gross) return out(MATCH_STATUS.AMOUNT_MISMATCH, `Tabby order amount ${money(gross)} ≠ website order total ${order.finalAmount.toFixed(2)}.`, { order, warnings })
  }
  if (row.saleRefundDay && order.createdAt && row.kind === ROW_KIND.SALE) {
    const days = Math.abs(Date.parse(`${row.saleRefundDay}T00:00:00Z`) - Date.parse(order.createdAt)) / 86400000
    if (days > 3) warnings.push(issue('DATE_FAR_FROM_ORDER', `Tabby sale date ${row.saleRefundDay} is ${Math.round(days)} days from the order date.`))
  }
  if (zohoInvoices == null) return out(MATCH_STATUS.NOT_CHECKED, 'Zoho was not queried.', { order, warnings, expectedCustomerId })
  const exact = zohoInvoices.filter((inv) => clean(inv.referenceNumber) === clean(order.orderNumber))
  const live = exact.filter(LIVE)
  if (live.length === 0) return out(MATCH_STATUS.NO_ZOHO_INVOICE, exact.length ? `Only void Zoho invoices reference ${order.orderNumber}.` : `No Zoho invoice has reference ${order.orderNumber}.`, { order, warnings, expectedCustomerId })
  if (live.length > 1) return out(MATCH_STATUS.MULTIPLE_ZOHO_INVOICES, `${live.length} Zoho invoices reference ${order.orderNumber}: ${live.map((i) => i.invoiceNumber).join(', ')}.`, { order, warnings, expectedCustomerId })
  const invoice = live[0]
  const base = { order, invoice, warnings, expectedCustomerId, customerId: invoice.customerId }
  if (invoice.customerId !== expectedCustomerId) {
    return out(MATCH_STATUS.CUSTOMER_MISMATCH, `Zoho invoice ${invoice.invoiceNumber} is not under ${order.shopOrder ? config.shopCustomerName : config.websiteCustomerName}.`, base)
  }
  if (clean(invoice.currencyCode).toUpperCase() !== config.currency) return out(MATCH_STATUS.CURRENCY_MISMATCH, `Zoho invoice currency is ${invoice.currencyCode}.`, base)
  if (invoice.status === 'draft') return out(MATCH_STATUS.INVOICE_DRAFT, `Zoho invoice ${invoice.invoiceNumber} is a draft.`, base)
  const totalMinor = Math.round(invoice.total * 100)
  if (row.kind === ROW_KIND.SALE && totalMinor !== gross) return out(MATCH_STATUS.AMOUNT_MISMATCH, `Tabby order amount ${money(gross)} ≠ Zoho invoice ${invoice.invoiceNumber} total ${money(totalMinor)}.`, base)
  if (row.kind === ROW_KIND.REFUND && -gross > totalMinor) return out(MATCH_STATUS.AMOUNT_MISMATCH, `Refund ${money(-gross)} is more than invoice ${invoice.invoiceNumber} total ${money(totalMinor)}.`, base)
  return out(MATCH_STATUS.MATCHED, `Order ${order.orderId} / ${order.orderNumber} → Zoho ${invoice.invoiceNumber}.`, base)
}

/**
 * Cumulative refunds per order: every refund row already imported (other statements) plus this
 * statement's refunds, in date order, must stay within the invoice total; a refund row whose
 * fingerprint was already imported in another statement is a duplicate.
 * @param {{ refunds: object[], priorRefunds: Array<{ fingerprint: string, websiteOrderId: string, statementNumber: string, grossMinor: number }>, invoiceTotalMinor: (websiteOrderId: string) => number|null }} input
 * @returns {Map<string, { code: string|null, problem: string|null, priorMinor: number, cumulativeMinor: number, kind: string|null, sequence: number }>}
 */
function assessRefunds({ refunds, priorRefunds, invoiceTotalMinor }) {
  const out = new Map()
  const priorByOrder = new Map()
  const priorFingerprints = new Map(priorRefunds.map((p) => [p.fingerprint, p]))
  for (const p of priorRefunds) priorByOrder.set(p.websiteOrderId, (priorByOrder.get(p.websiteOrderId) || 0) + Math.abs(p.grossMinor))
  const ordered = [...refunds].sort((a, b) => clean(a.saleRefundDate).localeCompare(clean(b.saleRefundDate)) || a.excelRow - b.excelRow)
  const running = new Map()
  const seq = new Map()
  for (const r of ordered) {
    const order = r.websiteOrderId
    const sequence = (seq.get(order) || 0) + 1
    seq.set(order, sequence)
    const dup = priorFingerprints.get(r.fingerprint)
    const prior = (priorByOrder.get(order) || 0) + (running.get(order) || 0)
    const amount = Math.abs(r.economics ? r.economics.grossMinor : r.minor.orderAmount)
    const cumulative = prior + amount
    running.set(order, (running.get(order) || 0) + amount)
    const total = invoiceTotalMinor(order)
    let code = null
    let problem = null
    if (dup) {
      code = 'DUPLICATE_REFUND'
      problem = `This refund row was already imported in ${dup.statementNumber}.`
    } else if (total == null) {
      code = 'REFUND_INVOICE_UNKNOWN'
      problem = 'The original invoice total is unknown, so the refund cannot be checked.'
    } else if (cumulative > total) {
      code = 'REFUND_OVERRUN'
      problem = `Refunds on order ${order} would total ${money(cumulative)}, more than the invoice total ${money(total)}.`
    }
    const kind = total == null || code ? null : cumulative === total ? 'FULL_REFUND' : 'PARTIAL_REFUND'
    out.set(r.fingerprint, { code, problem, priorMinor: prior, cumulativeMinor: cumulative, kind, sequence })
  }
  return out
}

// ── Posting plan ────────────────────────────────────────────────────────────

const reference = (statement, ...parts) => [statement, ...parts].filter(Boolean).join('/')

function customerPaymentPayload(c, date, paymentMode) {
  return plain(buildCustomerPaymentPayload({
    customerId: c.customerId,
    paymentMode,
    amount: c.amount,
    paymentDate: date,
    referenceNumber: c.reference,
    depositToAccountId: c.depositAccountId,
    invoices: c.allocations.map((a) => ({ invoiceId: a.invoiceId, amountApplied: a.amount })),
  }))
}

function journalPayload(c, date) {
  return plain(buildManualJournalPayload({
    date,
    referenceNumber: c.reference,
    lineItems: c.lines.map((l) => ({ accountId: l.accountId, debitOrCredit: l.side, amount: toMajor(l.amountMinor) })),
  }))
}

function creditNoteRefundPayload(c, date, refundMode) {
  return plain({ date, refund_mode: refundMode, reference_number: c.reference, amount: c.amount, from_account_id: c.depositAccountId })
}

function bankTransferPayload(c, date) {
  return plain({
    transaction_type: 'transfer_fund',
    from_account_id: c.fromAccountId,
    to_account_id: c.toAccountId,
    amount: c.amount,
    date,
    reference_number: c.reference,
  })
}

function accountIdOf(accounts, role) {
  const a = accounts && accounts[role]
  return a && a.accountId ? a.accountId : null
}

/** Two-line journal between Tabby Undeposited and `role` for a signed reversal effect. */
function reversalLines(effectMinor, role) {
  const amount = Math.abs(effectMinor)
  // effect < 0: Tabby gave the charge back (Dr Undeposited / Cr role); > 0: Tabby charged more.
  return effectMinor < 0
    ? [{ role: ACCOUNT_ROLE.UNDEPOSITED, side: 'debit', amountMinor: amount }, { role, side: 'credit', amountMinor: amount }]
    : [{ role, side: 'debit', amountMinor: amount }, { role: ACCOUNT_ROLE.UNDEPOSITED, side: 'credit', amountMinor: amount }]
}

function withAccounts(lines, accounts) {
  return lines.filter((l) => l.amountMinor !== 0).map((l) => ({ ...l, accountId: accountIdOf(accounts, l.role) }))
}

/**
 * One SALE_NET and one SALE_CHARGES customer payment per Zoho customer, each applied to every
 * invoice of that customer in the statement. Shop sales carry a SHOP tag so both references stay
 * unique when a statement has both customers.
 */
function pushCombinedSales(push, statementNumber, sales, accounts, config) {
  const groups = new Map()
  for (const r of sales) {
    const id = r.match.invoice.customerId
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(r)
  }
  for (const [customerId, list] of groups) {
    const tag = config.shopZohoCustomerId && customerId === config.shopZohoCustomerId && customerId !== config.websiteZohoCustomerId ? 'SHOP' : null
    const parts = [
      [COMPONENT.SALE_NET, (r) => r.economics.transferMinor, ACCOUNT_ROLE.UNDEPOSITED],
      [COMPONENT.SALE_CHARGES, (r) => r.economics.grossMinor - r.economics.transferMinor, ACCOUNT_ROLE.PROCESSING],
    ]
    for (const [component, amountOf, depositRole] of parts) {
      const applied = list.filter((r) => amountOf(r) > 0)
      if (applied.length === 0) continue
      push({
        component,
        scope: `${CUSTOMER_SCOPE}${customerId}`,
        zohoRecordType: 'customer_payment',
        customerId,
        amountMinor: applied.reduce((s, r) => s + amountOf(r), 0),
        reference: reference(statementNumber, tag, component),
        depositRole,
        depositAccountId: accountIdOf(accounts, depositRole),
        allocations: applied.map((r) => ({ invoiceId: r.match.invoice.invoiceId, invoiceNumber: r.match.invoice.invoiceNumber, websiteOrderId: r.websiteOrderId, amount: toMajor(amountOf(r)) })),
        sourceRows: applied.map((r) => r.excelRow),
      })
    }
  }
}

/**
 * The statement's single journal, netted per account: sale charges out of Tabby Processing into
 * commission / fees / input VAT, the payout fee and VAT out of Tabby Undeposited, and whatever
 * Tabby returned (or added) on refunds back into Tabby Undeposited. Balanced by construction.
 */
function pushSettlementJournal(push, statementNumber, { sales, refunds, payouts, netCharges }, accounts) {
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0)
  const refundCharges = (r) => r.effects.commissionEffect + r.effects.fixedFeeEffect + r.effects.roundingEffect + r.effects.vatEffect
  const payoutCredit = -sum(payouts, (r) => r.economics.transferMinor)
  const net = [
    [ACCOUNT_ROLE.COMMISSION_EXPENSE, sum(sales, (r) => r.economics.commissionMinor) + sum(refunds, (r) => r.effects.commissionEffect)],
    [ACCOUNT_ROLE.FEES_EXPENSE, sum(sales, (r) => r.economics.fixedFeeMinor + r.effects.roundingEffect) + sum(payouts, (r) => r.economics.feeMinor + r.effects.roundingEffect) + sum(refunds, (r) => r.effects.fixedFeeEffect + r.effects.roundingEffect)],
    [ACCOUNT_ROLE.INPUT_VAT, sum(sales, (r) => r.economics.vatMinor) + sum(payouts, (r) => r.economics.vatMinor) + sum(refunds, (r) => r.effects.vatEffect)],
    [ACCOUNT_ROLE.PROCESSING, -netCharges],
    [ACCOUNT_ROLE.UNDEPOSITED, -payoutCredit - sum(refunds, refundCharges)],
  ]
  const lines = withAccounts(net.filter(([, v]) => v !== 0).map(([role, v]) => ({ role, side: v > 0 ? 'debit' : 'credit', amountMinor: Math.abs(v) })), accounts)
  if (lines.length === 0) return
  push({
    component: COMPONENT.SETTLEMENT_JOURNAL,
    scope: 'STATEMENT',
    zohoRecordType: 'journal',
    amountMinor: lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amountMinor, 0),
    reference: reference(statementNumber, 'SETTLEMENT'),
    lines,
    sourceRows: [...sales, ...refunds, ...payouts].map((r) => r.excelRow).sort((a, b) => a - b),
  })
}

/**
 * Every Zoho record this statement needs, in execution order, with deterministic keys and
 * references. Rows that are not matched (or carry problems) produce no components; the caller
 * blocks posting in that case.
 * @param {{
 *   statementNumber: string, rows: object[], accounts: object, date: string, config: object,
 *   bank: { status: string, amountMinor: number },
 * }} input rows: analyzed rows with `match` (+ `refund` for refunds)
 */
function buildPostingPlan({ statementNumber, rows, accounts, date, config, bank, layout = PLAN_LAYOUT.COMBINED }) {
  const combined = layout !== PLAN_LAYOUT.PER_INVOICE
  const components = []
  const push = (c) => {
    c.statementNumber = statementNumber
    c.key = `${statementNumber}|${c.component}|${c.scope}`
    c.phase = PHASE[c.component]
    c.amount = toMajor(c.amountMinor)
    c.currency = config.currency
    c.date = date
    components.push(c)
  }
  const sales = rows.filter((r) => r.kind === ROW_KIND.SALE && r.match && r.match.matched && r.problems.length === 0)
  const refunds = rows.filter((r) => r.kind === ROW_KIND.REFUND && r.match && r.match.matched && r.problems.length === 0 && r.refund && !r.refund.code && r.refund.creditNote)
  const payouts = rows.filter((r) => r.kind === ROW_KIND.PAYOUT_FEE && r.problems.length === 0)

  sales.sort((a, b) => a.excelRow - b.excelRow)
  if (combined) pushCombinedSales(push, statementNumber, sales, accounts, config)
  for (const r of combined ? [] : sales) {
    const inv = r.match.invoice
    const netMinor = r.economics.transferMinor
    const chargesMinor = r.economics.grossMinor - netMinor
    const common = { scope: r.websiteOrderId, zohoRecordType: 'customer_payment', customerId: inv.customerId, invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, websiteOrderId: r.websiteOrderId, orderNumber: r.orderNumber, sourceRows: [r.excelRow] }
    if (netMinor > 0) {
      push({ ...common, component: COMPONENT.SALE_NET, amountMinor: netMinor, reference: reference(statementNumber, r.websiteOrderId, 'SALE_NET'), depositRole: ACCOUNT_ROLE.UNDEPOSITED, depositAccountId: accountIdOf(accounts, ACCOUNT_ROLE.UNDEPOSITED), allocations: [{ invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, amount: toMajor(netMinor) }] })
    }
    if (chargesMinor > 0) {
      push({ ...common, component: COMPONENT.SALE_CHARGES, amountMinor: chargesMinor, reference: reference(statementNumber, r.websiteOrderId, 'SALE_CHARGES'), depositRole: ACCOUNT_ROLE.PROCESSING, depositAccountId: accountIdOf(accounts, ACCOUNT_ROLE.PROCESSING), allocations: [{ invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, amount: toMajor(chargesMinor) }] })
    }
  }

  for (const r of refunds.sort((a, b) => clean(a.saleRefundDate).localeCompare(clean(b.saleRefundDate)) || a.excelRow - b.excelRow)) {
    const inv = r.match.invoice
    const tag = `R${r.refund.sequence}`
    const scope = `${r.websiteOrderId}/${tag}`
    const common = { scope, customerId: inv.customerId, invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, websiteOrderId: r.websiteOrderId, orderNumber: r.orderNumber, rowFingerprint: r.fingerprint, sourceRows: [r.excelRow] }
    const cn = r.refund.creditNote
    // Pins the existing credit note this refund is paid from; checked in Zoho, never created.
    push({
      ...common,
      component: COMPONENT.REFUND_CREDIT_NOTE,
      zohoRecordType: 'creditnote_link',
      amountMinor: -r.effects.grossEffect,
      reference: reference(statementNumber, r.websiteOrderId, tag, 'CREDIT_NOTE'),
      creditNoteId: cn.creditNoteId,
      creditNoteNumber: cn.creditNoteNumber,
    })
    push({
      ...common,
      component: COMPONENT.REFUND_PAYMENT,
      zohoRecordType: 'creditnote_refund',
      amountMinor: -r.effects.grossEffect,
      reference: reference(statementNumber, r.websiteOrderId, tag, 'REFUND'),
      depositRole: ACCOUNT_ROLE.UNDEPOSITED,
      depositAccountId: accountIdOf(accounts, ACCOUNT_ROLE.UNDEPOSITED),
      creditNoteId: cn.creditNoteId,
      creditNoteNumber: cn.creditNoteNumber,
      candidateCreditNoteIds: r.refund.candidateCreditNoteIds || [cn.creditNoteId],
    })
    if (combined) continue
    const reversals = [
      [COMPONENT.REFUND_COMMISSION_REVERSAL, r.effects.commissionEffect, ACCOUNT_ROLE.COMMISSION_EXPENSE, 'COMM_REV'],
      [COMPONENT.REFUND_FEE_REVERSAL, r.effects.fixedFeeEffect + r.effects.roundingEffect, ACCOUNT_ROLE.FEES_EXPENSE, 'FEE_REV'],
      [COMPONENT.REFUND_VAT_REVERSAL, r.effects.vatEffect, ACCOUNT_ROLE.INPUT_VAT, 'VAT_REV'],
    ]
    for (const [component, effect, role, suffix] of reversals) {
      if (effect === 0) continue
      const lines = withAccounts(reversalLines(effect, role), accounts)
      push({ ...common, component, zohoRecordType: 'journal', amountMinor: Math.abs(effect), reference: reference(statementNumber, r.websiteOrderId, tag, suffix), lines, direction: effect < 0 ? 'REVERSAL' : 'EXTRA_CHARGE' })
    }
  }

  const netCharges = sales.reduce((s, r) => s + (r.economics.grossMinor - r.economics.transferMinor), 0)
  if (combined) pushSettlementJournal(push, statementNumber, { sales, refunds, payouts, netCharges }, accounts)
  if (!combined && netCharges > 0) {
    const commission = sales.reduce((s, r) => s + r.economics.commissionMinor, 0)
    const fees = sales.reduce((s, r) => s + r.economics.fixedFeeMinor + r.effects.roundingEffect, 0)
    const vat = sales.reduce((s, r) => s + r.economics.vatMinor, 0)
    const lines = withAccounts([
      { role: ACCOUNT_ROLE.COMMISSION_EXPENSE, side: 'debit', amountMinor: commission },
      { role: ACCOUNT_ROLE.FEES_EXPENSE, side: 'debit', amountMinor: fees },
      { role: ACCOUNT_ROLE.INPUT_VAT, side: 'debit', amountMinor: vat },
      { role: ACCOUNT_ROLE.PROCESSING, side: 'credit', amountMinor: netCharges },
    ], accounts)
    push({ component: COMPONENT.CHARGE_EXPENSE_CLEARING, scope: 'STATEMENT', zohoRecordType: 'journal', amountMinor: netCharges, reference: reference(statementNumber, 'CHARGE_CLEARING'), lines, sourceRows: sales.map((r) => r.excelRow) })
  }

  if (!combined && payouts.length > 0) {
    const fee = payouts.reduce((s, r) => s + r.economics.feeMinor + r.effects.roundingEffect, 0)
    const vat = payouts.reduce((s, r) => s + r.economics.vatMinor, 0)
    const credit = -payouts.reduce((s, r) => s + r.economics.transferMinor, 0)
    if (credit > 0) {
      const lines = withAccounts([
        { role: ACCOUNT_ROLE.FEES_EXPENSE, side: 'debit', amountMinor: fee },
        { role: ACCOUNT_ROLE.INPUT_VAT, side: 'debit', amountMinor: vat },
        { role: ACCOUNT_ROLE.UNDEPOSITED, side: 'credit', amountMinor: credit },
      ], accounts)
      push({ component: COMPONENT.PAYOUT_FEE, scope: 'STATEMENT', zohoRecordType: 'journal', amountMinor: credit, reference: reference(statementNumber, 'PAYOUT_FEE'), lines, sourceRows: payouts.map((r) => r.excelRow) })
    }
  }

  if (bank && bank.status === BANK_STATUS.BANK_MATCH_PENDING && bank.amountMinor !== 0) {
    const toBank = bank.amountMinor > 0
    push({
      component: COMPONENT.BANK_SETTLEMENT,
      scope: 'STATEMENT',
      zohoRecordType: 'bank_transfer',
      amountMinor: Math.abs(bank.amountMinor),
      reference: reference(statementNumber, 'BANK_SETTLEMENT'),
      fromRole: toBank ? ACCOUNT_ROLE.UNDEPOSITED : ACCOUNT_ROLE.BANK,
      toRole: toBank ? ACCOUNT_ROLE.BANK : ACCOUNT_ROLE.UNDEPOSITED,
      fromAccountId: accountIdOf(accounts, toBank ? ACCOUNT_ROLE.UNDEPOSITED : ACCOUNT_ROLE.BANK),
      toAccountId: accountIdOf(accounts, toBank ? ACCOUNT_ROLE.BANK : ACCOUNT_ROLE.UNDEPOSITED),
    })
  }

  components.sort((a, b) => a.phase - b.phase || 0)
  for (const c of components) c.payload = payloadFor(c, config)
  return components
}

function payloadFor(c, config) {
  if (c.zohoRecordType === 'customer_payment') return customerPaymentPayload(c, c.date, config.paymentMode)
  if (c.zohoRecordType === 'journal') return journalPayload(c, c.date)
  if (c.zohoRecordType === 'creditnote_refund') return creditNoteRefundPayload(c, c.date, config.paymentMode)
  if (c.zohoRecordType === 'bank_transfer') return bankTransferPayload(c, c.date)
  return null
}

/** Journal lines must balance to the fils and every account must be resolved. */
function componentProblems(c) {
  const problems = []
  if (c.zohoRecordType === 'journal') {
    const dr = c.lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amountMinor, 0)
    const cr = c.lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amountMinor, 0)
    if (dr !== cr) problems.push(`${c.component} debits ${money(dr)} ≠ credits ${money(cr)}.`)
    if (c.lines.some((l) => !l.accountId)) problems.push(`${c.component} has an unmapped account (${c.lines.filter((l) => !l.accountId).map((l) => l.role).join(', ')}).`)
    if (c.lines.some((l) => l.amountMinor <= 0)) problems.push(`${c.component} has a non-positive line.`)
  }
  if ((c.zohoRecordType === 'customer_payment' || c.zohoRecordType === 'creditnote_refund') && !c.depositAccountId) problems.push(`${c.component} has no ${c.depositRole} account.`)
  if (c.zohoRecordType === 'bank_transfer' && (!c.fromAccountId || !c.toAccountId)) problems.push('BANK_SETTLEMENT has an unmapped account.')
  if (!(c.amountMinor > 0)) problems.push(`${c.component} amount ${money(c.amountMinor)} is not positive.`)
  return problems
}

// ── Ledger simulation ───────────────────────────────────────────────────────

/**
 * Balances (fils, debit positive) after each phase of the plan, per account role, plus the
 * customer receivable per invoice. `invoiceGross` opens each invoice's receivable.
 * `existingBank` is an already-recorded Tabby → RAK transfer (BANK_MATCHED).
 */
function simulateLedger(components, { invoiceGross = {}, existingBank = null } = {}) {
  const bal = {}
  const add = (k, v) => { bal[k] = (bal[k] || 0) + v }
  for (const [inv, g] of Object.entries(invoiceGross)) add(`AR:${inv}`, g)
  const snapshots = {}
  const stages = [['afterSales', 20], ['afterRefunds', 30], ['afterChargeClearing', 40], ['afterPayoutFee', 50]]
  let stage = 0
  const flush = (phase) => {
    while (stage < stages.length && phase >= stages[stage][1]) {
      snapshots[stages[stage][0]] = { ...bal }
      stage++
    }
  }
  for (const c of [...components].sort((a, b) => a.phase - b.phase)) {
    flush(c.phase)
    if (c.zohoRecordType === 'customer_payment') {
      add(c.depositRole, c.amountMinor)
      for (const a of c.allocations) add(`AR:${a.invoiceId}`, -Math.round(a.amount * 100))
    } else if (c.zohoRecordType === 'creditnote_refund') {
      add(c.depositRole, -c.amountMinor)
    } else if (c.zohoRecordType === 'journal') {
      for (const l of c.lines) add(l.role, l.side === 'debit' ? l.amountMinor : -l.amountMinor)
    } else if (c.zohoRecordType === 'bank_transfer') {
      add(c.toRole, c.amountMinor)
      add(c.fromRole, -c.amountMinor)
    }
  }
  flush(Infinity)
  if (existingBank && existingBank.amountMinor) {
    add(ACCOUNT_ROLE.BANK, existingBank.amountMinor)
    add(ACCOUNT_ROLE.UNDEPOSITED, -existingBank.amountMinor)
  }
  snapshots.final = { ...bal }
  return snapshots
}

function postingFingerprint(statementNumber, fileHash, date, components, bank) {
  return sha256({
    statementNumber,
    fileHash,
    date,
    bank: bank ? { status: bank.status, amountMinor: bank.amountMinor, transactionId: bank.matched ? bank.matched.transactionId : null } : null,
    components: components.map((c) => ({
      key: c.key,
      type: c.zohoRecordType,
      amount: c.amountMinor,
      reference: c.reference,
      customer: c.customerId || null,
      invoice: c.invoiceId || null,
      allocations: (c.allocations || []).map((a) => [a.invoiceId, Math.round(a.amount * 100)]),
      creditNote: c.creditNoteId || null,
      deposit: c.depositAccountId || null,
      from: c.fromAccountId || null,
      to: c.toAccountId || null,
      lines: (c.lines || []).map((l) => [l.accountId, l.side, l.amountMinor]),
    })),
  })
}

module.exports = {
  COMPONENT,
  PLAN_LAYOUT,
  isPerInvoiceComponent,
  PHASE,
  MATCH_STATUS,
  BANK_STATUS,
  toMajor,
  money,
  normalizeRow,
  rowFingerprint,
  assignFingerprints,
  analyzeStatement,
  matchRow,
  assessRefunds,
  buildPostingPlan,
  componentProblems,
  simulateLedger,
  postingFingerprint,
  reversalLines,
  payloadFor,
}

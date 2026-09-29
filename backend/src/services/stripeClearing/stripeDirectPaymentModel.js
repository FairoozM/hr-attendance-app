'use strict'

/**
 * Pure rules for Stripe charges mapped by an admin to an existing Zoho invoice: direct payments
 * (Payment Links, no website order), reassigned payments (the website order was cancelled without
 * a refund and the same funds were reused for a replacement invoice) and manual invoice mappings
 * (any other charge the matcher could not resolve). No I/O. Stripe text is supporting evidence
 * only; a mapping always needs an admin.
 */

const { MAPPING_TYPE } = require('./stripeDirectPaymentStore')
const { WEBSITE_CANCELLED, expectedZohoCustomerId } = require('./stripeClearingMatcher')

const EVIDENCE = Object.freeze({
  // A Stripe text names the invoice's P.O.# or invoice number.
  MATCH: 'MATCH',
  // Stripe texts name references, none of them this invoice's.
  CONFLICT: 'CONFLICT',
  // Stripe carries no recognisable reference.
  NONE: 'NONE',
})

const SUGGESTION = Object.freeze({ SUGGESTED: 'SUGGESTED', NEEDS_REVIEW: 'NEEDS_REVIEW', NONE: 'NONE' })

const SOURCE = Object.freeze({
  WEBSITE_ORDER: 'WEBSITE_ORDER',
  DIRECT_STRIPE_PAYMENT: 'DIRECT_STRIPE_PAYMENT',
  REASSIGNED_STRIPE_PAYMENT: 'REASSIGNED_STRIPE_PAYMENT',
  MANUAL_INVOICE_MAPPING: 'MANUAL_INVOICE_MAPPING',
})
// Stripe refunds in these states returned (or will return) money to the customer.
const LIVE_REFUND_STATUSES = new Set(['succeeded', 'pending', 'requires_action'])

const MIN_REASON_LENGTH = 10
const BLOCKED_INVOICE_STATUS = new Set(['void', 'draft'])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toMinor(major) {
  return Math.round((Number(major) || 0) * 100)
}

/** Every Stripe text worth reading, labelled with where it came from. */
function evidenceTexts(evidence) {
  if (!evidence) return []
  const out = []
  const add = (source, text) => {
    const t = clean(text)
    if (t) out.push({ source, text: t })
  }
  add('PaymentIntent description', evidence.description)
  add('Charge description', evidence.chargeDescription)
  for (const [k, v] of Object.entries(evidence.metadata || {})) add(`Metadata ${k}`, v)
  for (const s of evidence.sessions || []) {
    add('Checkout client reference', s.clientReferenceId)
    for (const [k, v] of Object.entries(s.metadata || {})) add(`Checkout metadata ${k}`, v)
    for (const p of s.products || []) {
      add('Payment Link product', p.productName)
      add('Payment Link product description', p.productDescription)
      if (p.lineDescription && p.lineDescription !== p.productName) add('Payment Link line', p.lineDescription)
    }
  }
  return out
}

const REFERENCE_PATTERNS = [
  { kind: 'invoiceNumber', re: /\b(INV-\d{3,12})\b/gi },
  { kind: 'reference', re: /#\s*(\d{3,12})\b/g },
  { kind: 'reference', re: /\b(?:invoice|order|po|p\.o\.)\s*(?:no\.?|number|num|ref\.?)?\s*[:#-]?\s*(\d{3,12})\b/gi },
]

/** Invoice numbers (INV-…) and numeric references (#20901, invoice 20901) found in Stripe texts. */
function extractReferences(evidence) {
  const found = new Map()
  for (const { source, text } of evidenceTexts(evidence)) {
    for (const { kind, re } of REFERENCE_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const value = kind === 'invoiceNumber' ? m[1].toUpperCase() : m[1]
        const key = `${kind}|${value}`
        const entry = found.get(key) || { kind, value, sources: [] }
        if (!entry.sources.some((s) => s.source === source)) entry.sources.push({ source, text })
        found.set(key, entry)
      }
    }
  }
  return [...found.values()]
}

/** How the Stripe references relate to one invoice. */
function assessEvidence(references, invoice) {
  const po = clean(invoice && invoice.referenceNumber)
  const number = clean(invoice && invoice.invoiceNumber).toUpperCase()
  const matched = references.filter((r) => (r.kind === 'reference' && po && r.value === po) || (r.kind === 'invoiceNumber' && r.value === number))
  if (matched.length > 0) return { status: EVIDENCE.MATCH, matched, others: references.filter((r) => !matched.includes(r)) }
  if (references.length > 0) return { status: EVIDENCE.CONFLICT, matched: [], others: references }
  return { status: EVIDENCE.NONE, matched: [], others: [] }
}

function customerKeyOf(customerId, config) {
  if (customerId && customerId === config.websiteZohoCustomerId) return 'WEBSITE'
  if (customerId && customerId === config.shopZohoCustomerId) return 'SHOP'
  return null
}

function customerNameOf(customerId, config) {
  const key = customerKeyOf(customerId, config)
  if (key === 'WEBSITE') return config.websiteCustomerName
  if (key === 'SHOP') return config.shopCustomerName
  return customerId || null
}

/**
 * Invoice candidates for an unmapped charge found through its Stripe references. Only a single
 * open, supported, same-amount invoice is a suggestion; anything else is for review. Never maps.
 */
function suggestInvoice({ references, invoices, grossMinor, config }) {
  const byId = new Map()
  for (const inv of invoices || []) if (inv && inv.invoiceId && !byId.has(inv.invoiceId)) byId.set(inv.invoiceId, inv)
  const live = [...byId.values()].filter((inv) => !BLOCKED_INVOICE_STATUS.has(inv.status))
  const fits = live.filter((inv) => customerKeyOf(inv.customerId, config)
    && clean(inv.currencyCode).toUpperCase() === config.websiteCurrency
    && toMinor(inv.total) === grossMinor
    && toMinor(inv.balance) === grossMinor)
  const candidates = live.map((inv) => ({
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    referenceNumber: inv.referenceNumber,
    customerId: inv.customerId,
    customerName: customerNameOf(inv.customerId, config),
    date: inv.date,
    total: inv.total,
    balance: inv.balance,
    status: inv.status,
    fits: fits.includes(inv),
  }))
  if (references.length === 0) return { status: SUGGESTION.NONE, reason: 'Stripe carries no invoice or P.O. reference.', candidates: [] }
  if (fits.length === 1) {
    return { status: SUGGESTION.SUGGESTED, reason: `Stripe reference matches ${fits[0].invoiceNumber} (P.O.# ${fits[0].referenceNumber || '—'}), same amount, open, supported customer.`, invoiceId: fits[0].invoiceId, candidates }
  }
  if (fits.length > 1) return { status: SUGGESTION.NEEDS_REVIEW, reason: `${fits.length} open invoices fit the Stripe reference and amount; choose by hand.`, candidates }
  if (live.length > 0) return { status: SUGGESTION.NEEDS_REVIEW, reason: 'Invoices carry the Stripe reference, but none is open for exactly this amount under a supported customer.', candidates }
  return { status: SUGGESTION.NONE, reason: 'No Zoho invoice carries the Stripe reference.', candidates: [] }
}

function check(key, label, ok, detail, blocking = true) {
  return { key, label, ok: Boolean(ok), blocking: !ok && blocking, detail }
}

/**
 * Whether a charge's website order is a cancelled order whose money was never given back, so the
 * same funds may be reassigned to a replacement invoice. The order itself is never changed.
 * @param {object} order website order (mapWebsiteOrder shape)
 * @param {{ refundedMinor?: number, disputed?: boolean }} charge Stripe facts for the charge
 */
function reassignableOrigin(order, charge) {
  if (!order) return { ok: false, reason: 'No website order carries this PaymentIntent.' }
  if (!WEBSITE_CANCELLED.has(order.orderStatus)) return { ok: false, reason: `Website order ${order.orderNumber} is ${order.orderStatus}, not cancelled.` }
  if (order.deleted) return { ok: false, reason: `Website order ${order.orderNumber} is deleted.` }
  if (!clean(order.orderNumber)) return { ok: false, reason: 'The cancelled website order has no order number.' }
  if (order.paymentStatus !== 'completed') {
    return { ok: false, reason: `Website order ${order.orderNumber} payment is ${order.paymentStatus}; the website may have refunded or credited it.` }
  }
  if (Number(order.refundAmount) > 0) return { ok: false, reason: `Website order ${order.orderNumber} records a refund of ${order.refundAmount}.` }
  if (charge && Number(charge.refundedMinor) > 0) return { ok: false, reason: `Stripe refunded ${Number(charge.refundedMinor) / 100} of this charge.` }
  if (charge && charge.disputed) return { ok: false, reason: 'The Stripe charge is disputed.' }
  return { ok: true, reason: `Website order ${order.orderNumber} is cancelled and Stripe refunded nothing.` }
}

function originCustomerId(originalOrder, originalInvoices, config) {
  const live = (originalInvoices || []).filter((inv) => !BLOCKED_INVOICE_STATUS.has(inv.status))
  const own = live.length === 1 ? live[0] : null
  if (own && own.customerId) return own.customerId
  return originalOrder ? expectedZohoCustomerId(originalOrder, config) : null
}

function noStripeRefundCheck(chargeRefunds) {
  const liveRefunds = (chargeRefunds || []).filter((r) => LIVE_REFUND_STATUSES.has(r.status))
  return check('no_stripe_refund', 'No Stripe refund exists for the charge', Array.isArray(chargeRefunds) && liveRefunds.length === 0,
    !Array.isArray(chargeRefunds) ? 'Stripe refunds could not be read.'
      : liveRefunds.length > 0 ? `Refund(s) ${liveRefunds.map((r) => `${r.refundId} ${r.status} AED ${((Number(r.amountMinor) || 0) / 100).toFixed(2)}`).join(', ')}.` : 'None.')
}

function reassignedChecks(i, invoice) {
  const { config, originalOrder, originalInvoices, chargeRefunds, evidence, allocatingOriginal } = i
  const orders = i.websiteOrdersForIntent || []
  const origin = orders.length === 1 ? reassignableOrigin(orders[0], evidence) : null
  const liveOriginals = (originalInvoices || []).filter((inv) => !BLOCKED_INVOICE_STATUS.has(inv.status))
  const consumed = liveOriginals.filter((inv) => toMinor(inv.balance) < toMinor(inv.total))
  const checks = [
    check('original_order', 'Original website order is cancelled without a refund',
      Boolean(originalOrder) && orders.length === 1 && orders[0].orderNumber === originalOrder.orderNumber && origin && origin.ok,
      orders.length > 1 ? `Website orders ${orders.map((o) => o.orderNumber).join(', ')} all carry this PaymentIntent.`
        : origin ? origin.reason : 'No website order carries this PaymentIntent.'),
    noStripeRefundCheck(chargeRefunds),
    check('original_not_consumed', 'Original invoice has not consumed this payment',
      Array.isArray(originalInvoices) && consumed.length === 0 && (allocatingOriginal || []).length === 0,
      !Array.isArray(originalInvoices) ? 'Original Zoho invoices could not be read.'
        : consumed.length > 0 ? `${consumed.map((inv) => `${inv.invoiceNumber} (balance ${inv.balance} of ${inv.total})`).join(', ')} already received a payment.`
          : (allocatingOriginal || []).length > 0 ? `Original invoice is allocated by ${allocatingOriginal.map((c) => `${c.component} ${c.status} in ${c.payoutId}`).join(', ')}.`
            : liveOriginals.length > 0 ? `${liveOriginals.map((inv) => inv.invoiceNumber).join(', ')} is unpaid.` : 'The original order has no live Zoho invoice.'),
  ]
  if (!invoice) return checks
  const originalIds = new Set((originalInvoices || []).map((inv) => inv.invoiceId))
  const isOriginal = originalIds.has(invoice.invoiceId) || (originalOrder && clean(invoice.referenceNumber) === clean(originalOrder.orderNumber))
  checks.push(check('replacement_invoice', 'Target is a replacement, not the original order’s invoice', !isOriginal,
    isOriginal ? `${invoice.invoiceNumber} belongs to the cancelled order ${originalOrder ? originalOrder.orderNumber : ''}; it cannot receive a reassigned payment.` : `${invoice.invoiceNumber} P.O.# ${invoice.referenceNumber || '—'}.`))
  const originCustomer = originCustomerId(originalOrder, originalInvoices, config)
  checks.push(check('same_customer', 'Replacement invoice is under the original order’s customer', Boolean(originCustomer) && invoice.customerId === originCustomer,
    !originCustomer ? 'The original order’s Zoho customer could not be determined; needs review.'
      : invoice.customerId === originCustomer ? customerNameOf(originCustomer, config)
        : `Original order belongs to ${customerNameOf(originCustomer, config)}, replacement to ${customerNameOf(invoice.customerId, config)}; needs review.`))
  const stillOpen = liveOriginals.filter((inv) => toMinor(inv.balance) > 0)
  if (stillOpen.length > 0) {
    checks.push(check('original_invoice_open', 'Original invoice is closed', false,
      `${stillOpen.map((inv) => `${inv.invoiceNumber} (${inv.status}, balance ${inv.balance})`).join(', ')} stays open in Zoho; this mapping does not clear it. Void or credit it separately if the order is cancelled.`, false))
  }
  return checks
}

/**
 * Manual invoice mapping: the matcher could not resolve the charge, so only the facts that keep
 * the money safe are checked. The target may be the original order's own invoice (e.g. a wrong
 * operational order status); a customer different from the website order's is blocked.
 */
function manualChecks(i, invoice) {
  const { config, chargeRefunds } = i
  const orders = i.websiteOrdersForIntent || []
  const checks = [
    noStripeRefundCheck(chargeRefunds),
    check('single_order', 'At most one website order carries this PaymentIntent', orders.length <= 1,
      orders.length <= 1 ? (orders.length === 1 ? `Website order ${orders[0].orderNumber}.` : 'None.')
        : `Website orders ${orders.map((o) => o.orderNumber).join(', ')} all carry this PaymentIntent; duplicate accounting risk.`),
  ]
  const reversed = orders.filter((o) => (Number(o.refundAmount) || 0) > 0 || o.paymentStatus === 'refunded')
  checks.push(check('no_website_refund', 'Website records no refund of this payment', reversed.length === 0,
    reversed.length > 0 ? `Website order ${reversed.map((o) => `${o.orderNumber} (${o.paymentStatus}${Number(o.refundAmount) > 0 ? `, refunded AED ${Number(o.refundAmount).toFixed(2)}` : ''})`).join(', ')} already reversed this payment.` : 'None.'))
  if (!invoice) return checks
  const expected = [...new Set(orders.map((o) => expectedZohoCustomerId(o, config)))]
  const ok = expected.length === 0 || (expected.length === 1 && expected[0] === invoice.customerId)
  checks.push(check('same_customer', 'Invoice customer matches the website order’s customer', ok,
    expected.length === 0 ? 'No website order carries this PaymentIntent.'
      : ok ? customerNameOf(invoice.customerId, config)
        : `Website order(s) ${orders.map((o) => o.orderNumber).join(', ')} belong to ${expected.map((c) => customerNameOf(c, config)).join(' / ')}, the invoice to ${customerNameOf(invoice.customerId, config)}; blocked.`))
  return checks
}

/** Stripe references to the original order are expected on a reassigned or manual mapping; they are not evidence either way. */
function referencesExcludingOrigin(references, originalOrders, originalInvoices) {
  const orders = (originalOrders || []).filter(Boolean)
  if (orders.length === 0) return references
  const values = new Set(orders.map((o) => clean(o.orderNumber)))
  for (const inv of originalInvoices || []) values.add(clean(inv.invoiceNumber).toUpperCase())
  return (references || []).filter((r) => !values.has(r.value))
}

function chargeStateDetail(evidence) {
  if (!evidence) return 'Stripe evidence could not be read.'
  const parts = []
  if (evidence.status !== 'succeeded') parts.push(`PaymentIntent is ${evidence.status}.`)
  const refunded = Number(evidence.refundedMinor) || 0
  if (refunded > 0) {
    const full = Number(evidence.amountReceivedMinor) > 0 && refunded >= Number(evidence.amountReceivedMinor)
    parts.push(`Stripe charge has already been ${full ? '' : 'partially '}refunded AED ${(refunded / 100).toFixed(2)}.`)
  }
  if (evidence.disputed) parts.push('Stripe charge is disputed.')
  return parts.length > 0 ? parts.join(' ') : 'PaymentIntent succeeded; nothing refunded; not disputed.'
}

/**
 * Every check before an admin may map one charge to one invoice. Blocking checks must all pass;
 * evidence NONE is allowed only when the admin re-types the invoice number (see `evidenceNeedsTypedConfirmation`).
 * @param {object} i
 */
function validateDirectMapping(i) {
  const { line, invoice, config, evidence, intentMapping, invoiceMapping, allocatingComponents,
    competingOrders, zohoIntentPayments, localClearing, websiteOrdersForIntent } = i
  const mappingType = i.mappingType || MAPPING_TYPE.DIRECT_PAYMENT
  const reassigned = mappingType === MAPPING_TYPE.REASSIGNED_PAYMENT
  const manual = mappingType === MAPPING_TYPE.MANUAL_INVOICE_MAPPING
  const references = reassigned ? referencesExcludingOrigin(i.references, [i.originalOrder], i.originalInvoices)
    : manual ? referencesExcludingOrigin(i.references, websiteOrdersForIntent, i.originalInvoices)
      : i.references
  const grossMinor = toMinor(line.gross)
  const customerKey = invoice ? customerKeyOf(invoice.customerId, config) : null
  const ev = assessEvidence(references, invoice)
  const checks = [
    mappingType !== MAPPING_TYPE.DIRECT_PAYMENT ? null : check('charge_unassigned', 'Charge has no website order', !line.website && (websiteOrdersForIntent || []).length === 0,
      (websiteOrdersForIntent || []).length > 0 ? `Website order(s) ${websiteOrdersForIntent.map((o) => o.orderNumber).join(', ')} carry this PaymentIntent; it clears as a website order.` : 'No website order carries this PaymentIntent.'),
    check('charge_state', 'Stripe charge is settled, not refunded or disputed',
      evidence && evidence.status === 'succeeded' && !evidence.refundedMinor && !evidence.disputed,
      chargeStateDetail(evidence)),
    check('stripe_payment', 'Stripe charge exists and received exactly the gross in AED',
      Boolean(evidence && evidence.chargeId) && (!line.chargeId || evidence.chargeId === line.chargeId)
        && clean(evidence.currency).toUpperCase() === config.websiteCurrency && Number(evidence.amountReceivedMinor) === grossMinor,
      !evidence ? 'Stripe evidence could not be read.'
        : `Charge ${evidence.chargeId || 'missing'}${line.chargeId && evidence.chargeId !== line.chargeId ? ` (payout has ${line.chargeId})` : ''}; received ${(Number(evidence.amountReceivedMinor) || 0) / 100} ${clean(evidence.currency).toUpperCase() || '—'} for gross ${line.gross}.`),
    check('invoice_found', 'Zoho invoice exists', Boolean(invoice), invoice ? `${invoice.invoiceNumber}` : 'Zoho has no such invoice.'),
    check('no_advance_case', 'Charge has no customer advance case', !line.advance && !line.advanceCaseId,
      line.advance || line.advanceCaseId ? `A customer advance case${line.advanceCaseId ? ` (${line.advanceCaseId})` : ''} exists for this charge; resolve it through the advance workflow.` : 'None.'),
  ].filter(Boolean)
  if (reassigned) checks.push(...reassignedChecks({ ...i, evidence }, invoice))
  if (manual) checks.push(...manualChecks(i, invoice))
  if (!invoice) return { checks, blocking: true, customerKey: null, evidence: ev, mappingType }
  checks.push(
    check('customer_supported', 'Invoice customer is a Stripe-clearing customer', Boolean(customerKey),
      customerKey ? `${customerNameOf(invoice.customerId, config)}` : `Customer ${invoice.customerId} is not Website or Burjman Shop - Web & App.`),
    check('currency', 'Currency matches', clean(invoice.currencyCode).toUpperCase() === config.websiteCurrency && clean(line.currency || config.websiteCurrency).toUpperCase() === config.websiteCurrency,
      `Invoice ${invoice.currencyCode || '—'}, Stripe ${line.currency || config.websiteCurrency}.`),
    check('invoice_status', 'Invoice is issued (not draft or void)', !BLOCKED_INVOICE_STATUS.has(invoice.status), `Status ${invoice.status}.`),
    check('amount', 'Stripe gross equals the invoice total', toMinor(invoice.total) === grossMinor,
      toMinor(invoice.total) === grossMinor ? `${line.gross} = ${invoice.total}.` : `Stripe ${line.gross} ≠ invoice ${invoice.total}; a different amount needs a separate review, not a mapping.`),
    check('balance', 'Invoice is fully open (no other payment applied)', toMinor(invoice.balance) === toMinor(invoice.total) && toMinor(invoice.balance) >= grossMinor,
      toMinor(invoice.balance) === 0 ? `${invoice.invoiceNumber} is already fully paid.` : `Balance ${invoice.balance} of ${invoice.total}.`),
    check('no_intent_mapping', 'No other mapping for this PaymentIntent', !intentMapping,
      intentMapping ? `Already mapped to ${intentMapping.zohoInvoiceNumber} by ${intentMapping.mappedBy}.` : 'None.'),
    check('no_invoice_mapping', 'Invoice not mapped to another Stripe payment', !invoiceMapping,
      invoiceMapping ? `${invoice.invoiceNumber} is already mapped to ${invoiceMapping.paymentIntentId}.` : 'None.'),
    check('not_allocated', 'Invoice and PaymentIntent are in no payout accounting', (allocatingComponents || []).length === 0,
      (allocatingComponents || []).length > 0 ? `Allocated by ${allocatingComponents.map((c) => `${c.component} ${c.status} in ${c.payoutId}`).join(', ')}.` : 'None.'),
    check('no_zoho_payment', 'No Zoho payment or earlier clearing for this PaymentIntent', (zohoIntentPayments || []).length === 0 && !localClearing,
      localClearing ? `Local clearing record ${localClearing.status} exists.` : (zohoIntentPayments || []).length > 0 ? `Zoho payment(s) ${zohoIntentPayments.map((p) => p.paymentId).join(', ')} carry this PaymentIntent.` : 'None.'),
    check('no_competing_order', 'No website order clears this invoice through another Stripe payment', (competingOrders || []).length === 0,
      (competingOrders || []).length > 0 ? `Website order ${competingOrders.map((o) => `${o.orderNumber} (${o.stripePaymentIntentId})`).join(', ')} is paid through another PaymentIntent.` : 'None.'),
    // A manual override exists precisely because Stripe/website data disagree, so a contradicting
    // reference is shown but does not block; the admin's typed confirmation carries the decision.
    check('evidence', 'Stripe reference does not contradict the invoice', ev.status !== EVIDENCE.CONFLICT,
      ev.status === EVIDENCE.MATCH ? `Stripe ${ev.matched.map((r) => `"${r.sources[0].text}"`).join(', ')} ↔ ${invoice.invoiceNumber} P.O.# ${invoice.referenceNumber || '—'}.`
        : ev.status === EVIDENCE.CONFLICT ? `Stripe names ${ev.others.map((r) => r.value).join(', ')}, not ${invoice.invoiceNumber} / P.O.# ${invoice.referenceNumber || '—'}.`
          : 'Stripe carries no reference; the admin must re-type the invoice number.', !manual),
  )
  return { checks, blocking: checks.some((c) => c.blocking), customerKey, evidence: ev, mappingType }
}

/** Amount-only mappings (no Stripe reference) and every manual override need the admin to re-type the invoice number. */
function evidenceNeedsTypedConfirmation(evidenceStatus, mappingType) {
  return mappingType === MAPPING_TYPE.MANUAL_INVOICE_MAPPING || evidenceStatus !== EVIDENCE.MATCH
}

module.exports = {
  EVIDENCE,
  SUGGESTION,
  SOURCE,
  MAPPING_TYPE,
  MIN_REASON_LENGTH,
  BLOCKED_INVOICE_STATUS,
  reassignableOrigin,
  evidenceTexts,
  extractReferences,
  assessEvidence,
  customerKeyOf,
  customerNameOf,
  suggestInvoice,
  validateDirectMapping,
  evidenceNeedsTypedConfirmation,
}

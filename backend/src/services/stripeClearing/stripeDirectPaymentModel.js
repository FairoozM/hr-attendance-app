'use strict'

/**
 * Pure rules for direct Stripe payments (Payment Links) mapped by an admin to an existing Zoho
 * invoice. No I/O. Stripe text is supporting evidence only; a mapping always needs an admin.
 */

const EVIDENCE = Object.freeze({
  // A Stripe text names the invoice's P.O.# or invoice number.
  MATCH: 'MATCH',
  // Stripe texts name references, none of them this invoice's.
  CONFLICT: 'CONFLICT',
  // Stripe carries no recognisable reference.
  NONE: 'NONE',
})

const SUGGESTION = Object.freeze({ SUGGESTED: 'SUGGESTED', NEEDS_REVIEW: 'NEEDS_REVIEW', NONE: 'NONE' })

const SOURCE = Object.freeze({ WEBSITE_ORDER: 'WEBSITE_ORDER', DIRECT_STRIPE_PAYMENT: 'DIRECT_STRIPE_PAYMENT' })

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
 * Every check before an admin may map one charge to one invoice. Blocking checks must all pass;
 * evidence NONE is allowed only when the admin re-types the invoice number (see `evidenceNeedsTypedConfirmation`).
 * @param {object} i
 */
function validateDirectMapping(i) {
  const { line, invoice, config, evidence, references, intentMapping, invoiceMapping, allocatingComponents,
    competingOrders, zohoIntentPayments, localClearing, websiteOrdersForIntent } = i
  const grossMinor = toMinor(line.gross)
  const customerKey = invoice ? customerKeyOf(invoice.customerId, config) : null
  const ev = assessEvidence(references, invoice)
  const checks = [
    check('charge_unassigned', 'Charge has no website order', !line.website && (websiteOrdersForIntent || []).length === 0,
      (websiteOrdersForIntent || []).length > 0 ? `Website order(s) ${websiteOrdersForIntent.map((o) => o.orderNumber).join(', ')} carry this PaymentIntent; it clears as a website order.` : 'No website order carries this PaymentIntent.'),
    check('charge_state', 'Stripe charge is settled, not refunded or disputed',
      evidence && evidence.status === 'succeeded' && !evidence.refundedMinor && !evidence.disputed,
      !evidence ? 'Stripe evidence could not be read.' : `PaymentIntent ${evidence.status}; refunded ${(evidence.refundedMinor || 0) / 100}; ${evidence.disputed ? 'disputed' : 'not disputed'}.`),
    check('invoice_found', 'Zoho invoice exists', Boolean(invoice), invoice ? `${invoice.invoiceNumber}` : 'Zoho has no such invoice.'),
  ]
  if (!invoice) return { checks, blocking: true, customerKey: null, evidence: ev }
  checks.push(
    check('customer_supported', 'Invoice customer is a Stripe-clearing customer', Boolean(customerKey),
      customerKey ? `${customerNameOf(invoice.customerId, config)}` : `Customer ${invoice.customerId} is not Website or Burjman Shop - Web & App.`),
    check('currency', 'Currency matches', clean(invoice.currencyCode).toUpperCase() === config.websiteCurrency && clean(line.currency || config.websiteCurrency).toUpperCase() === config.websiteCurrency,
      `Invoice ${invoice.currencyCode || '—'}, Stripe ${line.currency || config.websiteCurrency}.`),
    check('invoice_status', 'Invoice is issued (not draft or void)', !BLOCKED_INVOICE_STATUS.has(invoice.status), `Status ${invoice.status}.`),
    check('amount', 'Stripe gross equals the invoice total', toMinor(invoice.total) === grossMinor,
      toMinor(invoice.total) === grossMinor ? `${line.gross} = ${invoice.total}.` : `Stripe ${line.gross} ≠ invoice ${invoice.total}; a different amount needs a separate review, not a direct mapping.`),
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
    check('evidence', 'Stripe reference does not contradict the invoice', ev.status !== EVIDENCE.CONFLICT,
      ev.status === EVIDENCE.MATCH ? `Stripe ${ev.matched.map((r) => `"${r.sources[0].text}"`).join(', ')} ↔ ${invoice.invoiceNumber} P.O.# ${invoice.referenceNumber || '—'}.`
        : ev.status === EVIDENCE.CONFLICT ? `Stripe names ${ev.others.map((r) => r.value).join(', ')}, not ${invoice.invoiceNumber} / P.O.# ${invoice.referenceNumber || '—'}.`
          : 'Stripe carries no reference; the admin must re-type the invoice number.'),
  )
  return { checks, blocking: checks.some((c) => c.blocking), customerKey, evidence: ev }
}

/** Amount-only mappings (no Stripe reference) need the admin to re-type the invoice number. */
function evidenceNeedsTypedConfirmation(evidenceStatus) {
  return evidenceStatus !== EVIDENCE.MATCH
}

module.exports = {
  EVIDENCE,
  SUGGESTION,
  SOURCE,
  MIN_REASON_LENGTH,
  BLOCKED_INVOICE_STATUS,
  evidenceTexts,
  extractReferences,
  assessEvidence,
  customerKeyOf,
  customerNameOf,
  suggestInvoice,
  validateDirectMapping,
  evidenceNeedsTypedConfirmation,
}

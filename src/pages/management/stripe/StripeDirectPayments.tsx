import { useState } from 'react'
import { Modal } from '../../../components/Modal'
import {
  confirmStripeDirectPayment,
  releaseStripeDirectPayment,
  searchStripeDirectInvoices,
  validateStripeDirectPayment,
  type StripeCheckoutEvidence,
  type StripeDirectCustomer,
  type StripeDirectInvoice,
  type StripeDirectMapping,
  type StripeDirectSearchBy,
  type StripeDirectValidation,
  type StripeLineSource,
  type StripeOriginalInvoice,
  type StripePayoutLine,
  type StripePaymentEvidence,
  type StripeUnassignedLine,
} from '../../../api/stripe'
import { aed, amount, formatDay, formatWhen, statusLabel } from './stripePayoutFormat'

const MIN_REASON = 10
const MAPPING_REASON_PLACEHOLDER = 'e.g. Payment Link "Matjar meem #20901" paid invoice INV-043544 (P.O.# 20901); no website order exists.'
const REASSIGN_REASON_PLACEHOLDER = 'e.g. Customer cancelled original order and same Stripe funds were reused for replacement order.'
const MANUAL_REASON_PLACEHOLDER = 'e.g. Stripe payment for order 20901; the website status is wrong, verified with the customer and Zoho INV-043544.'

/** Label for a charge cleared through an admin mapping, by mapping type. */
export function mappedPaymentLabel(m: Pick<StripeDirectMapping, 'mappingType'> | null | undefined): string {
  if (m?.mappingType === 'REASSIGNED_PAYMENT') return 'REASSIGNED STRIPE PAYMENT'
  if (m?.mappingType === 'MANUAL_INVOICE_MAPPING') return 'MANUAL INVOICE MAPPING'
  return 'DIRECT STRIPE PAYMENT'
}

/** Allocation label for a mapped charge (it has no website order number). */
export function allocationSourceLabel(source: StripeLineSource | null | undefined): string {
  if (source === 'REASSIGNED_STRIPE_PAYMENT') return 'REASSIGNED STRIPE PAYMENT'
  if (source === 'MANUAL_INVOICE_MAPPING') return 'MANUAL INVOICE MAPPING'
  return 'DIRECT STRIPE PAYMENT'
}

function cardTitle(line: StripeUnassignedLine): string {
  if (line.mappingType === 'REASSIGNED_PAYMENT') return 'UNRESOLVED CHARGE · CANCELLED ORDER, NOT REFUNDED'
  if (line.mappingType === 'MANUAL_INVOICE_MAPPING') return 'UNRESOLVED CHARGE · MATCHER NEEDS HELP'
  return 'UNRESOLVED CHARGE'
}

function originalInvoicesText(invoices: StripeOriginalInvoice[] | null | undefined): string {
  if (!invoices || invoices.length === 0) return 'None in Zoho'
  return invoices.map((i) => `${i.invoiceNumber} (${i.status}, balance ${aed(i.balance)})`).join('; ')
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function checkoutWarning(state: StripeCheckoutEvidence | undefined): string | null {
  if (state === 'UNAVAILABLE_PERMISSION') return 'Payment Link evidence unavailable because the Stripe key cannot read Checkout Sessions. Manual verification is required.'
  if (state === 'UNAVAILABLE_ERROR') return 'Payment Link evidence could not be read from Stripe. Manual verification is required.'
  return null
}

function CheckoutWarning({ state }: { state: StripeCheckoutEvidence | undefined }) {
  const text = checkoutWarning(state)
  return text ? <p className="stripe-direct__warning">{text}</p> : null
}

function products(evidence: StripePaymentEvidence | null | undefined) {
  return (evidence?.sessions ?? []).flatMap((s) => s.products.map((p) => ({ ...p, paymentLinkId: s.paymentLinkId })))
}

/** Where the admin search starts: the suggested invoice, else the first Stripe reference. */
function initialQuery(line: StripeUnassignedLine): string {
  const suggested = line.suggestion?.status === 'SUGGESTED' ? line.suggestion.candidates.find((c) => c.invoiceId === line.suggestion?.invoiceId) : null
  if (suggested) return suggested.invoiceNumber
  return line.references?.[0]?.value ?? ''
}

function StripeEvidence({ evidence, description }: { evidence: StripePaymentEvidence | null | undefined; description?: string | null }) {
  const items = products(evidence)
  const text = evidence?.description || evidence?.chargeDescription || description
  return (
    <>
      <div>
        <dt>Stripe description</dt>
        <dd>{text || '—'}</dd>
      </div>
      <div>
        <dt>Payment Link / product</dt>
        <dd>
          {items.length === 0
            ? '—'
            : items.map((p, i) => (
                <div key={`${p.paymentLinkId}-${i}`}>
                  {p.productName || p.lineDescription || '—'}
                  {p.productDescription ? ` · ${p.productDescription}` : ''}
                  {p.paymentLinkId ? <span className="stripe-clearing__mono"> · {p.paymentLinkId}</span> : null}
                </div>
              ))}
        </dd>
      </div>
    </>
  )
}

function Suggestion({ line }: { line: StripeUnassignedLine }) {
  const s = line.suggestion
  if (line.evidenceError) return <p className="stripe-direct__warning">{line.evidenceError}</p>
  if (checkoutWarning(line.stripeEvidence?.checkoutEvidence)) return <CheckoutWarning state={line.stripeEvidence?.checkoutEvidence} />
  if (!s || s.status === 'NONE') return <p className="stripe-page__note">{s?.reason || 'No suggested invoice.'}</p>
  if (s.status === 'SUGGESTED') {
    const c = s.candidates.find((x) => x.invoiceId === s.invoiceId)
    return (
      <p className="stripe-direct__suggestion">
        <strong>Suggested match: {c?.invoiceNumber}</strong> · {c?.customerName} · P.O.# {c?.referenceNumber || '—'} · {aed(c?.total)} · not mapped
        until you confirm it.
      </p>
    )
  }
  return (
    <div className="stripe-direct__suggestion">
      <strong>NEEDS REVIEW</strong> · {s.reason}
      <ul className="stripe-payout__reasons">
        {s.candidates.map((c) => (
          <li key={c.invoiceId}>
            {c.invoiceNumber} · {c.customerName || c.customerId} · P.O.# {c.referenceNumber || '—'} · {aed(c.total)} (balance {aed(c.balance)}) ·{' '}
            {c.status}
          </li>
        ))}
      </ul>
    </div>
  )
}

function UnresolvedChargeCard({ line, onAssign }: { line: StripeUnassignedLine; onAssign: (line: StripeUnassignedLine) => void }) {
  const origin = line.originalOrder
  const refunded = line.stripeRefunded ?? origin?.refundedThroughStripe ?? 0
  return (
    <div className="stripe-direct__card" data-testid="unresolved-charge">
      <div className="stripe-payout__advance-head">
        <strong>{cardTitle(line)}</strong>
        <span className="stripe-payout__badge stripe-payout__badge--warn">{statusLabel(line.matcherStatus || line.state)}</span>
      </div>
      <p className="stripe-page__note" data-testid="matcher-reason">
        <strong>Reason:</strong> {line.matcherReason || line.reason}
      </p>
      <dl>
        <div>
          <dt>ORIGINAL ORDER</dt>
          <dd>
            {origin ? (
              <>
                <strong>{origin.orderNumber}</strong> · {origin.orderStatus} · payment {origin.paymentStatus}
                {origin.paymentMethod ? ` · ${origin.paymentMethod}` : ''} · {aed(origin.finalAmount)}
              </>
            ) : (
              'No website order carries this PaymentIntent'
            )}
          </dd>
        </div>
        <div>
          <dt>Original invoice</dt>
          <dd>
            {line.originalInvoices?.length
              ? originalInvoicesText(line.originalInvoices)
              : line.invoice
                ? `${line.invoice.invoiceNumber} (${line.invoice.status}, balance ${aed(line.invoice.balance)})`
                : origin
                  ? 'None in Zoho'
                  : '—'}
          </dd>
        </div>
        <div>
          <dt>Stripe refunded</dt>
          <dd>{aed(refunded)}</dd>
        </div>
        <div>
          <dt>Dispute</dt>
          <dd>{line.stripeDisputed ? 'Disputed' : 'Not disputed'}</dd>
        </div>
        <div>
          <dt>PaymentIntent</dt>
          <dd className="stripe-clearing__mono">{line.paymentIntentId || '—'}</dd>
        </div>
        <div>
          <dt>Charge</dt>
          <dd className="stripe-clearing__mono">{line.chargeId || '—'}</dd>
        </div>
        <div>
          <dt>Gross</dt>
          <dd>{aed(line.gross)}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{aed(line.fee)}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd>{aed(line.net)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatWhen(line.chargeCreatedAt || line.stripeEvidence?.createdAt)}</dd>
        </div>
        <StripeEvidence evidence={line.stripeEvidence} description={line.description} />
      </dl>
      <Suggestion line={line} />
      <div className="stripe-clearing__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!line.directEligible}
          title={line.directEligible ? undefined : line.directIneligibleReason || undefined}
          onClick={() => onAssign(line)}
        >
          Assign to Zoho Invoice
        </button>
      </div>
      {!line.directEligible && line.directIneligibleReason && <p className="stripe-page__note">{line.directIneligibleReason}</p>}
    </div>
  )
}

interface AssignState {
  by: StripeDirectSearchBy
  customer: StripeDirectCustomer
  q: string
  searching: boolean
  searchError: string
  results: StripeDirectInvoice[] | null
  invoiceId: string
  validating: boolean
  validation: StripeDirectValidation | null
  validateError: string
  reason: string
  typedInvoiceNumber: string
  acknowledged: boolean
  saving: boolean
  error: string
}

function freshAssign(line: StripeUnassignedLine): AssignState {
  const origin = line.originalOrder
  const reassigned = line.mappingType === 'REASSIGNED_PAYMENT' && origin
  const manualWithOrder = line.mappingType === 'MANUAL_INVOICE_MAPPING' && origin
  return {
    // A replacement invoice is found by the same amount under the original order's customer; a
    // manual mapping starts from the website order's own P.O.#.
    by: reassigned ? 'amount' : manualWithOrder ? 'reference' : 'auto',
    customer: origin ? (origin.shopOrder ? 'shop' : 'website') : 'all',
    q: reassigned ? line.gross.toFixed(2) : manualWithOrder ? origin.orderNumber : initialQuery(line),
    searching: false,
    searchError: '',
    results: null,
    invoiceId: '',
    validating: false,
    validation: null,
    validateError: '',
    reason: '',
    typedInvoiceNumber: '',
    acknowledged: false,
    saving: false,
    error: '',
  }
}

function ValidationPanel({ v }: { v: StripeDirectValidation }) {
  const inv = v.invoice
  const blocking = v.checks.filter((c) => c.blocking)
  return (
    <div className="stripe-direct__validation" aria-label="Mapping checks">
      {blocking.length > 0 && (
        <div className="stripe-page__banner stripe-page__banner--error" role="alert" data-testid="mapping-blocked">
          {blocking.map((c) => (
            <div key={c.key}>❌ {c.detail || c.label}</div>
          ))}
        </div>
      )}
      {v.mappingType === 'REASSIGNED_PAYMENT' && v.originalOrder && (
        <p className="stripe-page__note">
          Reassigned payment: cancelled order <strong>{v.originalOrder.orderNumber}</strong> (original invoice {originalInvoicesText(v.originalInvoices)}) stays
          unchanged as evidence; its Stripe funds clear the replacement invoice instead.
        </p>
      )}
      {v.mappingType === 'MANUAL_INVOICE_MAPPING' && (
        <p className="stripe-page__note">
          Manual invoice mapping: the matcher could not prove this relationship ({statusLabel(v.matcherStatus || 'NEEDS_REVIEW')}: {v.matcherReason || '—'}).
          {v.originalOrder ? (
            <>
              {' '}
              Website order <strong>{v.originalOrder.orderNumber}</strong> ({v.originalOrder.orderStatus}) stays unchanged as evidence.
            </>
          ) : null}
        </p>
      )}
      {inv && (
        <dl>
          <div>
            <dt>Invoice</dt>
            <dd>
              <strong>{inv.invoiceNumber}</strong>
            </dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{inv.customerName || inv.customerId}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatDay(inv.date)}</dd>
          </div>
          <div>
            <dt>P.O.# / reference</dt>
            <dd>{inv.referenceNumber || '—'}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              {inv.currencyCode} {amount(inv.total)}
            </dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{aed(inv.balance)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{inv.status}</dd>
          </div>
          <div>
            <dt>Stripe gross</dt>
            <dd>
              {aed(v.stripe.gross)} (fee {aed(v.stripe.fee)}, net {aed(v.stripe.net)})
            </dd>
          </div>
        </dl>
      )}
      {v.evidenceStatus === 'MATCH' && (
        <p className="stripe-direct__evidence stripe-direct__evidence--match">
          {v.references
            .filter((r) => r.value.toUpperCase() === inv?.referenceNumber?.toUpperCase() || r.value.toUpperCase() === inv?.invoiceNumber.toUpperCase())
            .map((r) => `Stripe reference ${r.value} (${r.sources.map((s) => `${s.source} "${s.text}"`).join('; ')})`)
            .join(' · ')}{' '}
          corresponds to Zoho {inv?.invoiceNumber} P.O.# {inv?.referenceNumber || '—'}. This is evidence only: nothing is posted until you confirm.
        </p>
      )}
      {v.evidenceStatus === 'CONFLICT' && (
        <p className="stripe-page__banner stripe-page__banner--error">Stripe references a different invoice or P.O.# than {inv?.invoiceNumber}.</p>
      )}
      {v.evidenceStatus === 'NONE' && (
        <>
          <CheckoutWarning state={v.checkoutEvidence} />
          {!checkoutWarning(v.checkoutEvidence) && (
            <p className="stripe-direct__warning">Stripe does not reference this invoice. An amount match alone is not enough; manual verification is required.</p>
          )}
        </>
      )}
      <ul className="stripe-direct__checks">
        {v.checks.map((c) => (
          <li key={c.key} className={c.ok ? 'stripe-direct__check--ok' : c.blocking ? 'stripe-direct__check--bad' : 'stripe-direct__check--warn'}>
            {c.ok ? '✓' : '✗'} {c.label}
            {c.detail ? <span className="stripe-page__note"> · {c.detail}</span> : null}
          </li>
        ))}
      </ul>
      {v.websiteOrdersWithReference.length > 0 && (
        <p className="stripe-page__note">
          Website orders numbered {inv?.referenceNumber}:{' '}
          {v.websiteOrdersWithReference.map((o) => `${o.orderNumber} (${o.paymentMethod || '—'}, ${o.paymentStatus || '—'}${o.deleted ? ', deleted' : ''})`).join('; ')}
        </p>
      )}
    </div>
  )
}

function AssignInvoiceModal({
  payoutId,
  line,
  onClose,
  onMapped,
}: {
  payoutId: string
  line: StripeUnassignedLine
  onClose: () => void
  onMapped: () => void
}) {
  const [s, setS] = useState<AssignState>(() => freshAssign(line))
  const pi = line.paymentIntentId || ''
  const origin = line.originalOrder
  const manual = line.mappingType === 'MANUAL_INVOICE_MAPPING'
  const reassigned = line.mappingType === 'REASSIGNED_PAYMENT' || (!line.mappingType && Boolean(origin))
  const v = s.validation
  const typedOk = !v?.requiresTypedInvoiceNumber || s.typedInvoiceNumber.trim().toUpperCase() === v.invoice?.invoiceNumber.toUpperCase()
  const canConfirm = Boolean(v && v.invoice && !v.blocking) && s.reason.trim().length >= MIN_REASON && s.acknowledged && typedOk && !s.saving
  const missing: string[] = []
  if (v && v.invoice && !v.blocking && !s.saving) {
    if (!typedOk) missing.push(s.typedInvoiceNumber.trim() ? `re-typed invoice number does not match ${v.invoice.invoiceNumber}` : `type ${v.invoice.invoiceNumber} in "Re-type invoice number"`)
    if (s.reason.trim().length < MIN_REASON) missing.push(`reason needs at least ${MIN_REASON} characters`)
    if (!s.acknowledged) missing.push('tick the verification box')
  }

  async function search() {
    setS((prev) => ({ ...prev, searching: true, searchError: '', results: null, invoiceId: '', validation: null, validateError: '' }))
    try {
      const res = await searchStripeDirectInvoices(s.q.trim(), s.by, s.customer)
      setS((prev) => ({ ...prev, searching: false, results: res.invoices }))
    } catch (err) {
      setS((prev) => ({ ...prev, searching: false, searchError: errorText(err, 'Zoho search failed.') }))
    }
  }

  async function select(invoiceId: string) {
    setS((prev) => ({ ...prev, invoiceId, validating: true, validation: null, validateError: '', typedInvoiceNumber: '', acknowledged: false, error: '' }))
    try {
      const res = await validateStripeDirectPayment(payoutId, pi, invoiceId)
      setS((prev) => (prev.invoiceId === invoiceId ? { ...prev, validating: false, validation: res } : prev))
    } catch (err) {
      setS((prev) => (prev.invoiceId === invoiceId ? { ...prev, validating: false, validateError: errorText(err, 'Validation failed.') } : prev))
    }
  }

  async function confirm() {
    if (!v?.invoice) return
    setS((prev) => ({ ...prev, saving: true, error: '' }))
    try {
      await confirmStripeDirectPayment(payoutId, pi, {
        invoiceId: v.invoice.invoiceId,
        reason: s.reason.trim(),
        ...(v.requiresTypedInvoiceNumber ? { confirmInvoiceNumber: s.typedInvoiceNumber.trim() } : {}),
      })
      onMapped()
    } catch (err) {
      setS((prev) => ({ ...prev, saving: false, error: errorText(err, 'The mapping could not be saved.') }))
    }
  }

  return (
    <div className="stripe-clearing__confirm">
      <p>
        <span className="stripe-clearing__mono">{pi}</span> · {aed(line.gross)} · fee {aed(line.fee)} · net {aed(line.net)}
      </p>
      {reassigned && origin && (
        <p className="stripe-page__note">
          Original order <strong>{origin.orderNumber}</strong> ({origin.orderStatus}) · refunded through Stripe {aed(origin.refundedThroughStripe)}. Select the
          replacement invoice the same funds paid.
        </p>
      )}
      {manual && (
        <p className="stripe-page__note">
          {statusLabel(line.matcherStatus || line.state)} · Reason: {line.matcherReason || line.reason}
          {origin ? ` · website order ${origin.orderNumber} (${origin.orderStatus})` : ''}. Search by invoice number, P.O.#, amount or customer and select the Zoho
          invoice this payment belongs to; every check runs again before anything is saved.
        </p>
      )}
      <form
        className="stripe-direct__search"
        onSubmit={(e) => {
          e.preventDefault()
          if (s.q.trim()) void search()
        }}
      >
        <label>
          Search by
          <select value={s.by} disabled={s.saving} onChange={(e) => setS({ ...s, by: e.target.value as StripeDirectSearchBy })}>
            <option value="auto">Auto</option>
            <option value="invoice">Invoice number</option>
            <option value="reference">P.O.# / reference</option>
            <option value="amount">Amount</option>
          </select>
        </label>
        <label>
          Customer
          <select value={s.customer} disabled={s.saving} onChange={(e) => setS({ ...s, customer: e.target.value as StripeDirectCustomer })}>
            <option value="all">Website + Burjman Shop</option>
            <option value="website">Website</option>
            <option value="shop">Burjman Shop - Web &amp; App</option>
          </select>
        </label>
        <label>
          Invoice number, P.O.# or amount
          <input type="text" value={s.q} disabled={s.saving} placeholder="INV-043544, 20901 or 1261.00" onChange={(e) => setS({ ...s, q: e.target.value })} />
        </label>
        <button type="submit" className="btn btn--ghost" disabled={!s.q.trim() || s.searching || s.saving}>
          {s.searching ? 'Searching…' : 'Search Zoho'}
        </button>
      </form>
      {s.searchError && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {s.searchError}
        </p>
      )}
      {s.results && s.results.length === 0 && <p className="stripe-page__note">No Zoho invoice found.</p>}
      {s.results && s.results.length > 0 && (
        <div className="stripe-clearing__scroll">
          <table className="stripe-page__table" aria-label="Zoho invoices">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th>P.O.#</th>
                <th className="stripe-payout__num">Total</th>
                <th className="stripe-payout__num">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.results.map((inv) => (
                <tr key={inv.invoiceId} className={inv.invoiceId === s.invoiceId ? 'stripe-direct__row--selected' : undefined}>
                  <td>{inv.invoiceNumber}</td>
                  <td>{inv.customerName}</td>
                  <td>{formatDay(inv.date)}</td>
                  <td>{inv.referenceNumber || '—'}</td>
                  <td className="stripe-payout__num">{aed(inv.total)}</td>
                  <td className="stripe-payout__num">{aed(inv.balance)}</td>
                  <td>{inv.status}</td>
                  <td>
                    {inv.selectable ? (
                      <button type="button" className="btn btn--ghost" disabled={s.saving || s.validating} onClick={() => void select(inv.invoiceId)}>
                        Select {inv.invoiceNumber}
                      </button>
                    ) : (
                      <span className="stripe-page__note">{inv.notSelectableReasons.join(' ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.validating && <p className="stripe-page__note">Checking {s.results?.find((r) => r.invoiceId === s.invoiceId)?.invoiceNumber}…</p>}
      {s.validateError && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {s.validateError}
        </p>
      )}
      {v && <ValidationPanel v={v} />}
      {v && v.invoice && !v.blocking && (
        <>
          {v.requiresTypedInvoiceNumber && (
            <>
              <h4>Manual verification required</h4>
              <label className="stripe-payout__reason">
                Re-type invoice number
                <input
                  type="text"
                  className="stripe-direct__input"
                  value={s.typedInvoiceNumber}
                  autoComplete="off"
                  disabled={s.saving}
                  onChange={(e) => setS({ ...s, typedInvoiceNumber: e.target.value })}
                />
              </label>
              <p className="stripe-page__note">Type {v.invoice.invoiceNumber} exactly as shown above.</p>
            </>
          )}
          <label className="stripe-payout__reason">
            Reason
            <textarea
              rows={3}
              value={s.reason}
              placeholder={manual ? MANUAL_REASON_PLACEHOLDER : reassigned ? REASSIGN_REASON_PLACEHOLDER : MAPPING_REASON_PLACEHOLDER}
              disabled={s.saving}
              onChange={(e) => setS({ ...s, reason: e.target.value })}
            />
          </label>
          <label className="stripe-clearing__check">
            <input type="checkbox" checked={s.acknowledged} disabled={s.saving} onChange={(e) => setS({ ...s, acknowledged: e.target.checked })} />
            {manual
              ? 'I verified this Stripe payment belongs to the selected Zoho invoice although the automatic matcher could not prove it.'
              : reassigned && origin
                ? `I verified order ${origin.orderNumber} was cancelled without a refund and the same Stripe funds paid the selected Zoho invoice.`
                : 'I verified this Stripe payment belongs to the selected Zoho invoice.'}
          </label>
          <p className="stripe-page__note">
            {aed(v.stripe.gross)} → {v.invoice.invoiceNumber} ({v.invoice.customerName}). Saves a local mapping only; nothing is sent to Zoho or Stripe. The
            charge then clears inside the normal {v.invoice.customerName} NET and FEE payments of this payout.
          </p>
        </>
      )}
      {s.error && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {s.error}
        </p>
      )}
      {missing.length > 0 && (
        <p className="stripe-direct__warning" data-testid="confirm-missing">
          To enable Confirm Mapping: {missing.join('; ')}.
        </p>
      )}
      <div className="stripe-clearing__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={s.saving}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={!canConfirm} onClick={() => void confirm()}>
          {s.saving ? 'Saving…' : 'Confirm Mapping'}
        </button>
      </div>
    </div>
  )
}

/** Every charge the matcher did not resolve, each with the "Assign to Zoho Invoice" action. */
export function UnresolvedCharges({ payoutId, lines, onChanged }: { payoutId: string; lines: StripeUnassignedLine[]; onChanged: () => void }) {
  const [assigning, setAssigning] = useState<StripeUnassignedLine | null>(null)
  if (lines.length === 0) return null
  return (
    <section className="stripe-payout__group" aria-label="Unresolved charges">
      <header className="stripe-payout__group-head">
        <h3>Unresolved charges ({lines.length})</h3>
      </header>
      <p className="stripe-page__note">
        The matcher could not clear these charges. Any of them can be assigned to an existing Zoho invoice: a direct Stripe payment (no website order), a
        cancelled order&apos;s unrefunded funds reused for a replacement invoice, or any other case by manual mapping. Every check runs again on the server
        before a mapping is saved; nothing is mapped automatically and website orders are never changed.
      </p>
      {lines.map((l) => (
        <UnresolvedChargeCard key={l.balanceTransactionId} line={l} onAssign={setAssigning} />
      ))}
      <Modal title="Assign to Zoho Invoice" open={Boolean(assigning)} onClose={() => setAssigning(null)}>
        {assigning && (
          <AssignInvoiceModal
            key={assigning.balanceTransactionId}
            payoutId={payoutId}
            line={assigning}
            onClose={() => setAssigning(null)}
            onMapped={() => {
              setAssigning(null)
              onChanged()
            }}
          />
        )}
      </Modal>
    </section>
  )
}

/** A charge cleared through an admin-confirmed direct, reassigned or manual invoice mapping. */
export function DirectPaymentCard({
  payoutId,
  line,
  customerName,
  onChanged,
}: {
  payoutId: string
  line: StripePayoutLine
  customerName: string
  onChanged: () => void
}) {
  const [release, setRelease] = useState<{ reason: string; saving: boolean; error: string } | null>(null)
  const m = line.direct
  if (!m) return null
  const reassigned = m.mappingType === 'REASSIGNED_PAYMENT'
  const manual = m.mappingType === 'MANUAL_INVOICE_MAPPING'
  const withOrigin = reassigned || (manual && Boolean(m.originalOrderNumber))

  async function submitRelease() {
    if (!release || !m) return
    setRelease({ ...release, saving: true, error: '' })
    try {
      await releaseStripeDirectPayment(payoutId, m.paymentIntentId, release.reason.trim())
      setRelease(null)
      onChanged()
    } catch (err) {
      setRelease({ ...release, saving: false, error: errorText(err, 'The mapping could not be released.') })
    }
  }

  return (
    <div className="stripe-direct__card stripe-direct__card--mapped" data-testid="direct-payment">
      <div className="stripe-payout__advance-head">
        <strong>{mappedPaymentLabel(m)}</strong>
        <span className="stripe-payout__badge stripe-payout__badge--ok">MANUALLY VERIFIED</span>
      </div>
      {reassigned || manual ? (
        <dl className="stripe-direct__summary" data-testid={reassigned ? 'reassigned-summary' : 'manual-summary'}>
          {withOrigin && (
            <div>
              <dt>Original order</dt>
              <dd>
                <strong>{m.originalOrderNumber}</strong>
                {m.originalOrderStatus ? ` · ${m.originalOrderStatus}` : ''}
                {m.originalInvoiceNumber ? ` · original invoice ${m.originalInvoiceNumber}` : ''}
              </dd>
            </div>
          )}
          {manual && (
            <div>
              <dt>Matcher before override</dt>
              <dd>
                {statusLabel(m.matcherStatus || 'NEEDS_REVIEW')} · {m.matcherReason || '—'}
              </dd>
            </div>
          )}
          <div>
            <dt>Clearing invoice</dt>
            <dd>
              <strong>{m.invoiceNumber}</strong> · PO {m.invoiceReference || '—'}
            </dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{customerName}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{aed(m.stripeGross)}</dd>
          </div>
        </dl>
      ) : (
        <p className="stripe-direct__summary">
          <strong>{m.invoiceNumber}</strong> · {customerName} · PO {m.invoiceReference || '—'} · {aed(m.stripeGross)}
        </p>
      )}
      {line.state === 'NEEDS_REVIEW' && <p className="stripe-page__banner stripe-page__banner--error">{line.reason}</p>}
      {!m.removable && (
        <p className="stripe-page__note" data-testid="mapping-locked">
          {m.lockedReason || 'This mapping can no longer be changed here.'}
        </p>
      )}
      <details className="stripe-payout__details">
        <summary>Mapping details</summary>
        <dl>
          <div>
            <dt>Mapping</dt>
            <dd>
              #{m.mappingId} · {m.mappingType} · {statusLabel(m.status)}
            </dd>
          </div>
          {manual && (
            <div>
              <dt>Matcher status / reason before override</dt>
              <dd>
                {m.matcherStatus || '—'} · {m.matcherReason || '—'}
              </dd>
            </div>
          )}
          {withOrigin && (
            <>
              <div>
                <dt>Original website order</dt>
                <dd>
                  {m.originalOrderNumber}
                  {m.originalOrderId ? <span className="stripe-clearing__mono"> · id {m.originalOrderId}</span> : null}
                  {m.originalOrderStatus ? ` · ${m.originalOrderStatus}` : ''}
                </dd>
              </div>
              <div>
                <dt>Original invoice</dt>
                <dd>
                  {m.originalInvoiceNumber || '—'}
                  {m.originalInvoiceId ? <span className="stripe-clearing__mono"> · {m.originalInvoiceId}</span> : null}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt>PaymentIntent / charge</dt>
            <dd className="stripe-clearing__mono">
              {m.paymentIntentId} · {m.chargeId || '—'}
            </dd>
          </div>
          <div>
            <dt>{reassigned ? 'Replacement Zoho invoice' : 'Zoho invoice'}</dt>
            <dd>
              {m.invoiceNumber} · <span className="stripe-clearing__mono">{m.zohoInvoiceId}</span>
            </dd>
          </div>
          <div>
            <dt>Mapped by</dt>
            <dd>
              {m.mappedBy} · {formatWhen(m.mappedAt)}
            </dd>
          </div>
          <div>
            <dt>Confirmed in payout</dt>
            <dd className="stripe-clearing__mono">{m.firstPayoutId}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{m.reason}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{m.evidence || '—'}</dd>
          </div>
        </dl>
        {m.removable ? (
          release ? (
            <div>
              <label className="stripe-payout__reason">
                Why release this mapping?
                <textarea rows={2} value={release.reason} disabled={release.saving} onChange={(e) => setRelease({ ...release, reason: e.target.value })} />
              </label>
              {release.error && (
                <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                  {release.error}
                </p>
              )}
              <div className="stripe-clearing__actions">
                <button type="button" className="btn btn--ghost" disabled={release.saving} onClick={() => setRelease(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn--primary" disabled={release.saving || release.reason.trim().length < MIN_REASON} onClick={() => void submitRelease()}>
                  {release.saving ? 'Releasing…' : 'Release Mapping'}
                </button>
              </div>
            </div>
          ) : (
            <div className="stripe-clearing__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setRelease({ reason: '', saving: false, error: '' })}>
                Release mapping…
              </button>
            </div>
          )
        ) : null}
      </details>
    </div>
  )
}

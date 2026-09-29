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
  type StripeDirectSearchBy,
  type StripeDirectValidation,
  type StripePayoutLine,
  type StripePaymentEvidence,
  type StripeUnassignedLine,
} from '../../../api/stripe'
import { aed, amount, formatDay, formatWhen, statusLabel } from './stripePayoutFormat'

const MIN_REASON = 10
const MAPPING_REASON_PLACEHOLDER = 'e.g. Payment Link "Matjar meem #20901" paid invoice INV-043544 (P.O.# 20901); no website order exists.'

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
  return (
    <div className="stripe-direct__card" data-testid="unresolved-charge">
      <div className="stripe-payout__advance-head">
        <strong>UNRESOLVED CHARGE</strong>
        <span className="stripe-payout__badge stripe-payout__badge--warn">{statusLabel(line.state)}</span>
      </div>
      <dl>
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
      <p className="stripe-page__note">{line.reason}</p>
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
  return {
    by: 'auto',
    customer: 'all',
    q: initialQuery(line),
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
  return (
    <div className="stripe-direct__validation" aria-label="Mapping checks">
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
  const v = s.validation
  const typedOk = !v?.requiresTypedInvoiceNumber || s.typedInvoiceNumber.trim().toUpperCase() === v.invoice?.invoiceNumber.toUpperCase()
  const canConfirm = Boolean(v && v.invoice && !v.blocking) && s.reason.trim().length >= MIN_REASON && s.acknowledged && typedOk && !s.saving

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
                  value={s.typedInvoiceNumber}
                  placeholder={v.invoice.invoiceNumber}
                  autoComplete="off"
                  disabled={s.saving}
                  onChange={(e) => setS({ ...s, typedInvoiceNumber: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="stripe-payout__reason">
            Reason
            <textarea rows={3} value={s.reason} placeholder={MAPPING_REASON_PLACEHOLDER} disabled={s.saving} onChange={(e) => setS({ ...s, reason: e.target.value })} />
          </label>
          <label className="stripe-clearing__check">
            <input type="checkbox" checked={s.acknowledged} disabled={s.saving} onChange={(e) => setS({ ...s, acknowledged: e.target.checked })} />
            I verified this Stripe payment belongs to the selected Zoho invoice.
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

/** Charges that belong to no customer group yet, each with the direct-payment mapping action. */
export function UnresolvedCharges({ payoutId, lines, onChanged }: { payoutId: string; lines: StripeUnassignedLine[]; onChanged: () => void }) {
  const [assigning, setAssigning] = useState<StripeUnassignedLine | null>(null)
  if (lines.length === 0) return null
  return (
    <section className="stripe-payout__group" aria-label="Unresolved charges">
      <header className="stripe-payout__group-head">
        <h3>Unresolved charges ({lines.length})</h3>
      </header>
      <p className="stripe-page__note">
        No website order carries these PaymentIntents. A direct Stripe payment (e.g. a Payment Link) can be assigned to its existing Zoho invoice after
        you review the checks; it is never mapped automatically.
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

/** A charge cleared through an admin-confirmed direct-payment mapping. */
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
        <strong>DIRECT STRIPE PAYMENT</strong>
        <span className="stripe-payout__badge stripe-payout__badge--ok">MANUALLY VERIFIED</span>
      </div>
      <p className="stripe-direct__summary">
        <strong>{m.invoiceNumber}</strong> · {customerName} · PO {m.invoiceReference || '—'} · {aed(m.stripeGross)}
      </p>
      {line.state === 'NEEDS_REVIEW' && <p className="stripe-page__banner stripe-page__banner--error">{line.reason}</p>}
      <details className="stripe-payout__details">
        <summary>Mapping details</summary>
        <dl>
          <div>
            <dt>Mapping</dt>
            <dd>
              #{m.mappingId} · {statusLabel(m.status)}
            </dd>
          </div>
          <div>
            <dt>PaymentIntent / charge</dt>
            <dd className="stripe-clearing__mono">
              {m.paymentIntentId} · {m.chargeId || '—'}
            </dd>
          </div>
          <div>
            <dt>Zoho invoice</dt>
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
        ) : (
          <p className="stripe-page__note">{m.lockedReason || 'This mapping can no longer be changed here.'}</p>
        )}
      </details>
    </div>
  )
}

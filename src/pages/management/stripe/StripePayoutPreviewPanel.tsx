import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from '../../../components/Modal'
import {
  confirmStripeCustomerAdvance,
  confirmStripeUncertainNotCreated,
  getStripePayoutPreview,
  getStripePayouts,
  postStripePayoutFeeJournal,
  postStripePayoutGroup,
  postStripePayoutRefund,
  recheckStripeUncertainComponent,
  refreshStripePayouts,
  type StripeNormalRefund,
  type StripePayoutComponent,
  type StripePayoutFeeJournal,
  type StripePayoutFeeJournalPostResult,
  type StripePayoutGroup,
  type StripePayoutLine,
  type StripePayoutPostResult,
  type StripePayoutPreview,
  type StripePayoutRefundPostResult,
  type StripePayoutSummary,
  type StripeReturnWarning,
  type StripeUncertainComponent,
  type StripeUncertainResolution,
} from '../../../api/stripe'
import {
  accountLabel,
  advanceLines,
  aed,
  amount,
  componentLabel,
  feeJournalLabel,
  feeJournalTone,
  feeAdjustmentLabel,
  formatDay,
  formatWhen,
  groupTone,
  normalRefundTone,
  pageOf,
  payoutTone,
  postingSteps,
  recoveryLabel,
  refundKindLabel,
  refundPayoutLabel,
  statusLabel,
  UNCERTAIN_WARNING,
  zohoPostingDate,
  type Tone,
} from './stripePayoutFormat'
import { DirectPaymentCard, UnresolvedCharges, allocationSourceLabel, mappedPaymentLabel } from './StripeDirectPayments'

const REASON_PLACEHOLDER = 'e.g. Paid product removed after payment before invoicing. No refund was issued.'
const REFUNDED_REASON_PLACEHOLDER = 'e.g. Customer overpaid; the difference was refunded in Stripe after this payout.'

interface ConfirmState {
  group: StripePayoutGroup
  line: StripePayoutLine
  reason: string
  acknowledged: boolean
  saving: boolean
  error: string
}

interface PostState {
  group: StripePayoutGroup
  acknowledged: boolean
  posting: boolean
  error: string
  result: StripePayoutPostResult | null
}

interface FeePostState {
  feeJournal: StripePayoutFeeJournal
  acknowledged: boolean
  posting: boolean
  error: string
  result: StripePayoutFeeJournalPostResult | null
}

interface RefundPostState {
  refund: StripeNormalRefund
  acknowledged: boolean
  posting: boolean
  error: string
  result: StripePayoutRefundPostResult | null
}

interface NotCreatedState {
  item: StripeUncertainComponent
  reason: string
  /** datetime-local value of the admin's own Zoho check. */
  checkedAt: string
  zohoLocation: string
  searchedFor: string
  noneFound: boolean
  acknowledged: boolean
  saving: boolean
  error: string
  result: StripeUncertainResolution | null
}

interface RecheckState {
  componentId: string
  checking: boolean
  message: string
  error: boolean
}

const RECHECK_MESSAGE: Record<StripeUncertainResolution['outcome'], string> = {
  VERIFIED: 'Found in Zoho and it matches exactly; recorded as verified. Nothing was posted.',
  NEEDS_REVIEW: 'Zoho holds a record that does not match; marked for review. Nothing was posted.',
  POSTING_UNCERTAIN: 'Still not found in Zoho. Nothing was posted; it stays blocked.',
  FAILED: 'Retry allowed.',
}

function uncertainOwner(item: StripeUncertainComponent): string {
  if (item.refundId) return `refund ${item.refundId}`
  if (item.component === 'PAYOUT_FEE_JOURNAL') return 'payout fee journal'
  return item.customerId ? `customer ${item.customerId}` : ''
}

/** Zoho writes whose result is unknown. Recheck is read-only; retry needs the admin confirmation. */
function UncertainWrites({
  items,
  recheck,
  onRecheck,
  onConfirm,
}: {
  items: StripeUncertainComponent[]
  recheck: RecheckState | null
  onRecheck: (item: StripeUncertainComponent) => void
  onConfirm: (item: StripeUncertainComponent) => void
}) {
  return (
    <section className="stripe-payout__group" aria-label="Uncertain Zoho writes">
      <header className="stripe-payout__group-head">
        <h3>Uncertain Zoho writes ({items.length})</h3>
        <Badge tone="bad">{statusLabel('POSTING_UNCERTAIN')}</Badge>
      </header>
      <p className="stripe-page__banner stripe-page__banner--error" role="alert">
        {UNCERTAIN_WARNING}. Zoho may already hold these records, so they are never re-sent automatically and cannot be posted
        again from this page until they are resolved. The payout is not cleared while any of them is open.
      </p>
      {items.map((item) => {
        const busy = recheck?.componentId === item.componentId && recheck.checking
        return (
          <div key={`${item.scope}:${item.componentId}`} className="stripe-payout__advance">
            <p>
              <strong>
                {componentLabel(item.component)} · {aed(item.amount)}
              </strong>{' '}
              · {uncertainOwner(item)} · <span className="stripe-clearing__mono">{item.reference}</span>
            </p>
            <p className="stripe-page__note">
              {item.status === 'POSTING' ? 'The posting attempt was interrupted before Zoho answered.' : UNCERTAIN_WARNING}. Attempts{' '}
              {item.attemptCount} · uncertain since {formatWhen(item.uncertainSince)} · Zoho rechecked {item.recoveryCheckCount} time(s)
              {item.lastRecoveryCheckAt ? `, last ${formatWhen(item.lastRecoveryCheckAt)}` : ''}
            </p>
            {item.lastError && <p className="stripe-page__note">{item.lastError}</p>}
            {recheck?.componentId === item.componentId && recheck.message && (
              <p className={recheck.error ? 'stripe-page__banner stripe-page__banner--error' : 'stripe-page__note'} role="status">
                {recheck.message}
              </p>
            )}
            <div className="stripe-clearing__actions">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onRecheck(item)}>
                {busy ? 'Checking Zoho…' : 'Recheck Zoho'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!item.canConfirm || busy}
                title={item.confirmBlockedReason || undefined}
                onClick={() => onConfirm(item)}
              >
                Confirm Not Created…
              </button>
              {item.confirmBlockedReason && <span className="stripe-page__note">{item.confirmBlockedReason}</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function Badge({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`stripe-payout__badge stripe-payout__badge--${tone}`}>{children}</span>
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'stripe-payout__check stripe-payout__check--ok' : 'stripe-payout__check stripe-payout__check--bad'}>
      <span aria-hidden>{ok ? '✓' : '✗'}</span> {children}
    </li>
  )
}

function ComponentAccount({ c }: { c: StripePayoutComponent }) {
  if (c.zohoRecordType === 'journal') {
    return (
      <>
        Dr {accountLabel(c.debitAccount)}
        <br />
        Cr {accountLabel(c.creditAccount)}
      </>
    )
  }
  return <>{accountLabel(c.account)}</>
}

function AdvanceCard({
  group,
  line,
  onConfirm,
}: {
  group: StripePayoutGroup
  line: StripePayoutLine
  onConfirm: (group: StripePayoutGroup, line: StripePayoutLine) => void
}) {
  const adv = line.advance
  if (!adv) return null
  const journal = group.components.find((c) => c.component === 'CUSTOMER_ADVANCE')
  const canConfirm = !adv.confirmed && line.state === 'OPEN'
  const refund = adv.refund
  return (
    <div className="stripe-payout__advance">
      <div className="stripe-payout__advance-head">
        <strong>CUSTOMER OVERPAYMENT</strong>
        <Badge tone={adv.confirmed ? 'ok' : 'warn'}>{statusLabel(adv.caseStatus)}</Badge>
      </div>
      <dl>
        <div>
          <dt>Stripe paid</dt>
          <dd>{aed(adv.stripeGross)}</dd>
        </div>
        <div>
          <dt>Invoice {line.invoice?.invoiceNumber}</dt>
          <dd>{aed(adv.invoiceTotal)}</dd>
        </div>
        <div>
          <dt>Customer Advance</dt>
          <dd>
            <strong>{aed(adv.overpaymentAmount)}</strong>
          </dd>
        </div>
        {refund && (
          <>
            <div>
              <dt>Refund detected</dt>
              <dd>{aed(refund.amount)}</dd>
            </div>
            <div>
              <dt>Refund ID</dt>
              <dd className="stripe-clearing__mono">{refund.refundId}</dd>
            </div>
            <div>
              <dt>Refund payout</dt>
              <dd className={refund.refundPayoutId ? 'stripe-clearing__mono' : undefined}>{refundPayoutLabel(refund.refundPayoutId)}</dd>
            </div>
            <div>
              <dt>Refund status</dt>
              <dd>{statusLabel(adv.refundStatus || 'REFUND_DETECTED')}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Status</dt>
          <dd>{adv.confirmed ? 'Confirmed by admin' : 'Admin confirmation required'}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{journal ? accountLabel(journal.creditAccount) : '[1123] Customer Advance Funds'}</dd>
        </div>
        <div>
          <dt>Order / charge</dt>
          <dd className="stripe-clearing__mono">
            {line.website?.orderNumber} · {line.paymentIntentId} · {line.chargeId}
          </dd>
        </div>
      </dl>
      <p className="stripe-page__note">Customer advance journal:</p>
      <table className="stripe-page__table stripe-payout__journal">
        <tbody>
          <tr>
            <td>Dr</td>
            <td>{journal ? accountLabel(journal.debitAccount) : '[1019] Stripe Undeposited Funds'}</td>
            <td className="stripe-payout__num">{amount(adv.overpaymentAmount)}</td>
          </tr>
          <tr>
            <td>Cr</td>
            <td>
              {journal ? accountLabel(journal.creditAccount) : '[1123] Customer Advance Funds'} · {group.customerName}
            </td>
            <td className="stripe-payout__num">{amount(adv.overpaymentAmount)}</td>
          </tr>
        </tbody>
      </table>
      {refund && (
        <p className="stripe-page__note">
          The {aed(refund.amount)} refund happened after this payout. It is cleared in its own Stripe payout (Dr [1123] Customer
          Advance Funds / Cr [1019] Stripe Undeposited Funds) and does not change this payout.
        </p>
      )}
      {adv.confirmed ? (
        <p className="stripe-page__note">
          Confirmed by {adv.confirmedBy || '—'} on {formatWhen(adv.confirmedAt)}
          {adv.reason ? ` · ${adv.reason}` : ''}
        </p>
      ) : (
        <div className="stripe-clearing__actions">
          <button type="button" className="btn btn--primary" disabled={!canConfirm} title={canConfirm ? undefined : line.reason} onClick={() => onConfirm(group, line)}>
            Confirm Customer Advance
          </button>
        </div>
      )}
    </div>
  )
}

function PostAction({ group, postingEnabled, onPost }: { group: StripePayoutGroup; postingEnabled: boolean; onPost: (group: StripePayoutGroup) => void }) {
  if (!group.postable || group.status === 'POSTING_UNCERTAIN') return null
  return (
    <div className="stripe-clearing__actions">
      <button
        type="button"
        className="btn btn--primary"
        disabled={!postingEnabled}
        title={postingEnabled ? undefined : 'Posting disabled on the server (STRIPE_CLEARING_POSTING_ENABLED).'}
        onClick={() => onPost(group)}
      >
        Post Customer Group to Zoho
      </button>
      {!postingEnabled && <span className="stripe-page__note">Posting disabled</span>}
    </div>
  )
}

function FeeJournalCard({
  feeJournal: fj,
  postingEnabled,
  onPost,
}: {
  feeJournal: StripePayoutFeeJournal
  postingEnabled: boolean
  onPost: () => void
}) {
  const legacy = fj.legacy?.journals.length === 1 ? fj.legacy.journals[0] : null
  return (
    <section className="stripe-payout__group" aria-label="Payout fee journal">
      <header className="stripe-payout__group-head">
        <h3>Payout Fee Journal</h3>
        <Badge tone={feeJournalTone(fj.status)}>{feeJournalLabel(fj.status)}</Badge>
      </header>
      {fj.postable && fj.status !== 'POSTING_UNCERTAIN' && (
        <div className="stripe-clearing__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!postingEnabled}
            title={postingEnabled ? undefined : 'Posting disabled on the server (STRIPE_CLEARING_POSTING_ENABLED).'}
            onClick={onPost}
          >
            Post Stripe Fee Journal to Zoho
          </button>
          {!postingEnabled && <span className="stripe-page__note">Posting disabled</span>}
        </div>
      )}
      {fj.reasons.length > 0 && (
        <ul className="stripe-payout__reasons">
          {fj.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <dl className="stripe-payout__totals">
        <div>
          <dt>Total Stripe fees</dt>
          <dd>{aed(fj.amount)}</dd>
        </div>
        <div>
          <dt>Zoho posting date</dt>
          <dd>{fj.date || '—'}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd className="stripe-clearing__mono">{fj.reference}</dd>
        </div>
      </dl>
      <ul className="stripe-payout__checks">
        {fj.feeComponents.map((f) => (
          <Check key={f.customerId} ok={f.zohoState === 'VERIFIED'}>
            {f.customerName} FEE {amount(f.amount)} · {statusLabel(f.zohoState)}
          </Check>
        ))}
        {(fj.refundFeeAdjustments ?? []).map((a) => (
          <Check key={a.refundId} ok={a.zohoState === 'VERIFIED'}>
            Refund {a.refundId} fee adjustment {amount(a.fee)} · {statusLabel(a.zohoState)}
          </Check>
        ))}
        <Check ok={fj.verifiedFeeTotal === fj.stripeFeeTotal}>
          Verified FEE payments{(fj.refundFeeAdjustments ?? []).length > 0 ? ' and refund fee adjustments' : ''} {amount(fj.verifiedFeeTotal)} = Stripe
          fees {amount(fj.stripeFeeTotal)}
        </Check>
        {fj.direction === 'FEE_REVERSAL' && (
          <Check ok>Net fee is negative: fee expense reversal of {amount(fj.amount)} (Dr 1013 / Cr 2270)</Check>
        )}
      </ul>
      <table className="stripe-page__table">
        <tbody>
          <tr>
            <td>Dr</td>
            <td>{accountLabel(fj.debitAccount)}</td>
            <td className="stripe-payout__num">{amount(fj.amount)}</td>
          </tr>
          <tr>
            <td>Cr</td>
            <td>{accountLabel(fj.creditAccount)}</td>
            <td className="stripe-payout__num">{amount(fj.amount)}</td>
          </tr>
        </tbody>
      </table>
      {fj.zoho.recordId && <p className="stripe-page__note">Zoho journal {fj.zoho.recordId}</p>}
      {legacy && (
        <p className="stripe-page__note">
          Legacy journal #{legacy.entryNumber || legacy.journalId} · {legacy.journalDate} · {legacy.referenceNumber} · Stripe Fees lines{' '}
          {legacy.matchedLines.map((x) => amount(x)).join(' + ')}
        </p>
      )}
      {fj.local?.lastError && <p className="stripe-page__note">Last attempt: {fj.local.lastError}</p>}
    </section>
  )
}

function NormalRefundCard({
  refund: x,
  postingEnabled,
  onPost,
}: {
  refund: StripeNormalRefund
  postingEnabled: boolean
  onPost: (refund: StripeNormalRefund) => void
}) {
  const cnRefund = x.components.find((c) => c.component === 'REFUND_CREDIT_NOTE_REFUND')
  const feeAdjustment = x.components.find((c) => c.component === 'REFUND_FEE_ADJUSTMENT')
  return (
    <div className="stripe-payout__advance" aria-label={`Refund ${x.refundId || x.balanceTransactionId}`}>
      <div className="stripe-payout__advance-head">
        <strong>
          {refundKindLabel(x)} · {aed(x.gross)}
        </strong>
        <Badge tone={normalRefundTone(x.status)}>{statusLabel(x.status)}</Badge>
      </div>
      <dl className="stripe-payout__totals">
        <div>
          <dt>Refund</dt>
          <dd className="stripe-clearing__mono">{x.refundId || '—'}</dd>
        </div>
        <div>
          <dt>Balance transaction</dt>
          <dd className="stripe-clearing__mono">{x.balanceTransactionId}</dd>
        </div>
        <div>
          <dt>Charge / PaymentIntent</dt>
          <dd className="stripe-clearing__mono">
            {x.chargeId || '—'} / {x.paymentIntentId || '—'}
          </dd>
        </div>
        <div>
          <dt>Order</dt>
          <dd>{x.website ? `${x.website.orderNumber}${x.website.shopOrder ? ' (Burjman)' : ''}` : '—'}</dd>
        </div>
        <div>
          <dt>Invoice</dt>
          <dd>{x.invoice ? `${x.invoice.invoiceNumber} · ${aed(x.invoice.total)} · balance ${amount(x.invoice.balance)}` : '—'}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{x.customerName || '—'}</dd>
        </div>
        <div>
          <dt>Refunded so far</dt>
          <dd>
            {x.cumulativeRefunded != null && x.invoice ? `${amount(x.cumulativeRefunded)} of ${amount(x.invoice.total)}` : '—'}
            {x.remainingRefundable != null ? ` · ${amount(x.remainingRefundable)} left` : ''}
          </dd>
        </div>
        <div>
          <dt>Gross / fee adjustment / net</dt>
          <dd>
            {amount(x.gross)} / {feeAdjustmentLabel(x)} / {amount(x.net)}
          </dd>
        </div>
        <div>
          <dt>Clearing impact</dt>
          <dd>
            1019 {amount(x.clearingImpact.stripeUndepositedFunds)}
            {x.clearingImpact.processingChargesUncleared !== 0 ? ` · 1013 ${amount(x.clearingImpact.processingChargesUncleared)}` : ''}
          </dd>
        </div>
      </dl>
      <ul className="stripe-payout__reasons">
        {x.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {x.creditNote ? (
        <p className="stripe-page__note">
          Credit note {x.creditNote.creditNoteNumber} · {aed(x.creditNote.total)} · balance {amount(x.creditNote.balance)} · {x.creditNote.status}
          {x.creditNote.salesReturnNumber ? ` · sales return ${x.creditNote.salesReturnNumber}` : ''}
        </p>
      ) : (
        <p className="stripe-page__note">
          {x.creditNoteCandidates.length === 0
            ? 'No Zoho credit note found for this order.'
            : `Credit notes found: ${x.creditNoteCandidates.map((n) => `${n.creditNoteNumber} (${amount(n.total)})`).join(', ')}`}
        </p>
      )}
      {x.returnedItems.length > 0 ? (
        <table className="stripe-page__table">
          <thead>
            <tr>
              <th>Returned item</th>
              <th className="stripe-payout__num">Qty</th>
              <th className="stripe-payout__num">Total</th>
            </tr>
          </thead>
          <tbody>
            {x.returnedItems.map((i) => (
              <tr key={`${i.invoiceLineItemId}-${i.sku}`}>
                <td>
                  {i.name || i.sku || '—'}
                  {i.sku && i.name ? <span className="stripe-page__note"> · {i.sku}</span> : null}
                </td>
                <td className="stripe-payout__num">{i.quantity}</td>
                <td className="stripe-payout__num">{amount(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        x.itemsReason && <p className="stripe-page__note">Returned items: {x.itemsReason}</p>
      )}
      {x.legacyRefund && (
        <p className="stripe-page__note">
          Manual Zoho refund {x.legacyRefund.referenceNumber || x.legacyRefund.creditNoteRefundId} · {x.legacyRefund.date} · {aed(x.legacyRefund.amount)}
        </p>
      )}
      {[cnRefund, feeAdjustment].map(
        (c) =>
          c && (
            <p key={c.component} className="stripe-page__note">
              {componentLabel(c.component)} {aed(c.amount)} · <span className="stripe-clearing__mono">{c.reference}</span> · Zoho{' '}
              {statusLabel(c.zoho.state)}
              {c.zoho.recordId ? ` (${c.zoho.recordId})` : ''} · {recoveryLabel(c.recovery.action)}
              {c.local?.lastError ? ` · last attempt: ${c.local.lastError}` : ''}
            </p>
          ),
      )}
      {x.postable && x.postingFingerprint && x.status !== 'POSTING_UNCERTAIN' && (
        <div className="stripe-clearing__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!postingEnabled}
            title={postingEnabled ? undefined : 'Posting disabled on the server (STRIPE_CLEARING_POSTING_ENABLED).'}
            onClick={() => onPost(x)}
          >
            Post refund to Zoho
          </button>
          {!postingEnabled && <span className="stripe-page__note">Posting disabled</span>}
        </div>
      )}
    </div>
  )
}

function ReturnPendingNotice({ warning }: { warning: StripeReturnWarning }) {
  return (
    <div className="stripe-page__banner stripe-page__banner--warning" role="note">
      <strong>{warning.title}</strong>
      <ul className="stripe-payout__reasons">
        {warning.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <p className="stripe-page__note">{warning.message}</p>
    </div>
  )
}

function GroupCard({
  payoutId,
  group,
  postingEnabled,
  onConfirm,
  onPost,
  onDirectChanged,
}: {
  payoutId: string
  group: StripePayoutGroup
  postingEnabled: boolean
  onConfirm: (group: StripePayoutGroup, line: StripePayoutLine) => void
  onPost: (group: StripePayoutGroup) => void
  onDirectChanged: () => void
}) {
  const t = group.totals
  return (
    <section className="stripe-payout__group">
      <header className="stripe-payout__group-head">
        <h3>{group.customerName}</h3>
        <Badge tone={groupTone(group.status)}>{statusLabel(group.status)}</Badge>
      </header>
      <PostAction group={group} postingEnabled={postingEnabled} onPost={onPost} />
      {group.reasons.length > 0 && (
        <ul className="stripe-payout__reasons">
          {group.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <dl className="stripe-payout__totals">
        <div>
          <dt>Invoice Gross</dt>
          <dd>{aed(t.invoiceGross)}</dd>
        </div>
        <div>
          <dt>NET to 1019</dt>
          <dd>{aed(t.netTo1019)}</dd>
        </div>
        <div>
          <dt>Customer Advance</dt>
          <dd>{aed(t.customerAdvance)}</dd>
        </div>
        <div>
          <dt>Total 1019</dt>
          <dd>{aed(t.total1019)}</dd>
        </div>
        <div>
          <dt>FEE to 1013</dt>
          <dd>{aed(t.feeTo1013)}</dd>
        </div>
        <div>
          <dt>Stripe Gross</dt>
          <dd>{aed(t.stripeGross)}</dd>
        </div>
      </dl>

      {advanceLines(group).map((l) => (
        <AdvanceCard key={l.balanceTransactionId} group={group} line={l} onConfirm={onConfirm} />
      ))}

      {group.lines
        .filter((l) => l.direct)
        .map((l) => (
          <DirectPaymentCard key={l.balanceTransactionId} payoutId={payoutId} line={l} customerName={group.customerName} onChanged={onDirectChanged} />
        ))}

      {group.lines.map((l) => (l.returnWarning ? <ReturnPendingNotice key={l.balanceTransactionId} warning={l.returnWarning} /> : null))}

      <div className="stripe-clearing__scroll">
        <table className="stripe-page__table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Zoho account</th>
              <th className="stripe-payout__num">Amount</th>
              <th>Reference</th>
              <th>In Zoho</th>
              <th>Local</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody>
            {group.components.map((c) => (
              <tr key={c.component}>
                <td>{componentLabel(c.component)}</td>
                <td>
                  <ComponentAccount c={c} />
                </td>
                <td className="stripe-payout__num">{amount(c.amount)}</td>
                <td className="stripe-clearing__mono">{c.reference}</td>
                <td>
                  {statusLabel(c.zoho.state)}
                  {c.zoho.recordId && <div className="stripe-clearing__mono">{c.zoho.recordId}</div>}
                  {c.zoho.reason && <div className="stripe-page__note">{c.zoho.reason}</div>}
                </td>
                <td>
                  {c.local ? `${c.local.status} (${c.local.attemptCount})` : '—'}
                  {c.local?.lastError && <div className="stripe-page__note">{c.local.lastError}</div>}
                </td>
                <td title={c.recovery.reason}>{recoveryLabel(c.recovery.action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="stripe-payout__details">
        <summary>Invoice allocations ({group.lines.length} charges)</summary>
        <div className="stripe-clearing__scroll">
          <table className="stripe-page__table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Invoice</th>
                <th className="stripe-payout__num">Stripe gross</th>
                <th className="stripe-payout__num">Invoice</th>
                <th className="stripe-payout__num">NET</th>
                <th className="stripe-payout__num">FEE</th>
                <th className="stripe-payout__num">Advance</th>
                <th>State</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {group.lines.map((l) => (
                <tr key={l.balanceTransactionId}>
                  <td>{l.direct ? mappedPaymentLabel(l.direct) : l.website?.orderNumber || '—'}</td>
                  <td>{l.invoice?.invoiceNumber || '—'}</td>
                  <td className="stripe-payout__num">{amount(l.gross)}</td>
                  <td className="stripe-payout__num">{amount(l.invoiceTotal)}</td>
                  <td className="stripe-payout__num">{amount(l.netAllocation)}</td>
                  <td className="stripe-payout__num">{amount(l.feeAllocation)}</td>
                  <td className="stripe-payout__num">{l.customerAdvance ? amount(l.customerAdvance) : '—'}</td>
                  <td>{statusLabel(l.state)}</td>
                  <td>{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="stripe-payout__details">
        <summary>Zoho payloads</summary>
        {group.components.map((c) => (
          <div key={c.component}>
            <p className="stripe-page__note">{componentLabel(c.component)}</p>
            <pre className="stripe-payout__payload">{JSON.stringify(c.payload, null, 2)}</pre>
          </div>
        ))}
      </details>
    </section>
  )
}

export function StripePayoutPreviewPanel() {
  const [payouts, setPayouts] = useState<StripePayoutSummary[] | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [listing, setListing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [listError, setListError] = useState('')
  const [preview, setPreview] = useState<StripePayoutPreview | null>(null)
  const [loadingId, setLoadingId] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [post, setPost] = useState<PostState | null>(null)
  const [feePost, setFeePost] = useState<FeePostState | null>(null)
  const [refundPost, setRefundPost] = useState<RefundPostState | null>(null)
  const [recheck, setRecheck] = useState<RecheckState | null>(null)
  const [notCreated, setNotCreated] = useState<NotCreatedState | null>(null)

  useEffect(() => {
    let cancelled = false
    getStripePayouts()
      .then((list) => {
        if (cancelled) return
        setPayouts(list.rows)
        setRefreshedAt(list.refreshedAt)
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : 'Could not load cached payouts.')
      })
      .finally(() => {
        if (!cancelled) setListing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reloadPayouts() {
    setRefreshing(true)
    setListError('')
    try {
      const list = await refreshStripePayouts()
      setPayouts(list.rows)
      setRefreshedAt(list.refreshedAt)
      setPage(1)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not reload payouts from Stripe.')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadPreview(payoutId: string) {
    setLoadingId(payoutId)
    setPreviewError('')
    try {
      setPreview(await getStripePayoutPreview(payoutId))
    } catch (err) {
      setPreview(null)
      setPreviewError(err instanceof Error ? err.message : 'Could not load the payout preview.')
    } finally {
      setLoadingId('')
    }
  }

  function openConfirm(group: StripePayoutGroup, line: StripePayoutLine) {
    setConfirm({ group, line, reason: '', acknowledged: false, saving: false, error: '' })
  }

  async function submitConfirm() {
    if (!confirm || !preview || !confirm.line.chargeId) return
    setConfirm({ ...confirm, saving: true, error: '' })
    try {
      await confirmStripeCustomerAdvance(preview.payout.payoutId, confirm.line.chargeId, confirm.reason.trim())
      setConfirm(null)
      await loadPreview(preview.payout.payoutId)
    } catch (err) {
      setConfirm((prev) => (prev ? { ...prev, saving: false, error: err instanceof Error ? err.message : 'Confirmation failed.' } : prev))
    }
  }

  function openPost(group: StripePayoutGroup) {
    setPost({ group, acknowledged: false, posting: false, error: '', result: null })
  }

  async function submitPost() {
    if (!post || !preview) return
    setPost({ ...post, posting: true, error: '' })
    try {
      const result = await postStripePayoutGroup(preview.payout.payoutId, post.group.customerId, post.group.postingFingerprint)
      setPost((prev) => (prev ? { ...prev, posting: false, result } : prev))
    } catch (err) {
      setPost((prev) => (prev ? { ...prev, posting: false, error: err instanceof Error ? err.message : 'Posting failed.' } : prev))
    }
    await loadPreview(preview.payout.payoutId)
  }

  function openFeePost(feeJournal: StripePayoutFeeJournal) {
    setFeePost({ feeJournal, acknowledged: false, posting: false, error: '', result: null })
  }

  async function submitFeePost() {
    if (!feePost || !preview) return
    setFeePost({ ...feePost, posting: true, error: '' })
    try {
      const result = await postStripePayoutFeeJournal(preview.payout.payoutId, feePost.feeJournal.postingFingerprint)
      setFeePost((prev) => (prev ? { ...prev, posting: false, result } : prev))
    } catch (err) {
      setFeePost((prev) => (prev ? { ...prev, posting: false, error: err instanceof Error ? err.message : 'Posting failed.' } : prev))
    }
    await loadPreview(preview.payout.payoutId)
  }

  function openRefundPost(refund: StripeNormalRefund) {
    setRefundPost({ refund, acknowledged: false, posting: false, error: '', result: null })
  }

  async function submitRefundPost() {
    if (!refundPost || !preview || !refundPost.refund.refundId || !refundPost.refund.postingFingerprint) return
    setRefundPost({ ...refundPost, posting: true, error: '' })
    try {
      const result = await postStripePayoutRefund(preview.payout.payoutId, refundPost.refund.refundId, refundPost.refund.postingFingerprint)
      setRefundPost((prev) => (prev ? { ...prev, posting: false, result } : prev))
    } catch (err) {
      setRefundPost((prev) => (prev ? { ...prev, posting: false, error: err instanceof Error ? err.message : 'Posting failed.' } : prev))
    }
    await loadPreview(preview.payout.payoutId)
  }

  async function recheckUncertain(item: StripeUncertainComponent) {
    if (!preview) return
    setRecheck({ componentId: item.componentId, checking: true, message: '', error: false })
    try {
      const result = await recheckStripeUncertainComponent(preview.payout.payoutId, item.scope, item.componentId)
      setRecheck({ componentId: item.componentId, checking: false, message: RECHECK_MESSAGE[result.outcome], error: false })
    } catch (err) {
      setRecheck({ componentId: item.componentId, checking: false, message: err instanceof Error ? err.message : 'Recheck failed.', error: true })
    }
    await loadPreview(preview.payout.payoutId)
  }

  function openNotCreated(item: StripeUncertainComponent) {
    setNotCreated({ item, reason: '', checkedAt: '', zohoLocation: '', searchedFor: '', noneFound: false, acknowledged: false, saving: false, error: '', result: null })
  }

  async function submitNotCreated() {
    if (!notCreated || !preview) return
    setNotCreated({ ...notCreated, saving: true, error: '' })
    try {
      const result = await confirmStripeUncertainNotCreated(preview.payout.payoutId, notCreated.item.scope, notCreated.item.componentId, notCreated.reason.trim(), {
        checkedAt: new Date(notCreated.checkedAt).toISOString(),
        zohoLocation: notCreated.zohoLocation.trim(),
        searchedFor: notCreated.searchedFor.trim(),
        recordsFound: 0,
      })
      setNotCreated((prev) => (prev ? { ...prev, saving: false, result } : prev))
    } catch (err) {
      setNotCreated((prev) => (prev ? { ...prev, saving: false, error: err instanceof Error ? err.message : 'Confirmation failed.' } : prev))
    }
    await loadPreview(preview.payout.payoutId)
  }

  const payoutPage = payouts ? pageOf(payouts, page) : null
  const r = preview?.reconciliation
  const normalRefunds = preview?.normalRefunds ?? []
  const uncertain = preview?.uncertainComponents ?? []
  const notCreatedReasonOk = (notCreated?.reason.trim().length ?? 0) >= 10
  const notCreatedEvidenceOk =
    notCreated !== null &&
    notCreated.noneFound &&
    !Number.isNaN(Date.parse(notCreated.checkedAt)) &&
    notCreated.zohoLocation.trim().length >= 5 &&
    notCreated.searchedFor.includes(notCreated.item.reference)
  const reasonOk = (confirm?.reason.trim().length ?? 0) >= 10
  const postingEnabled = preview?.postingEnabled === true
  const postAdvanceLines = post ? advanceLines(post.group) : []

  return (
    <article className="stripe-page__card">
      <h2>Payout Clearing Preview</h2>
      <p className="stripe-page__note">
        Each Stripe payout is cleared per customer: NET to [1019] Stripe Undeposited Funds, FEE to [1013] Stripe Processing Chg
        Un-Cleared, and admin-confirmed overpayments to [1123] Customer Advance Funds. Once every customer group is verified, one
        payout fee journal clears the signed fee balance of [1013]: Dr [2270] Stripe Fees / Cr [1013] when Stripe's fees net
        positive, Dr [1013] / Cr [2270] when refunds returned more fees than were charged, none when they net to zero. Nothing is
        sent to Zoho until an admin posts,
        and only while posting is enabled on the server.
      </p>
      <div className="stripe-clearing__filters">
        <button type="button" className="btn btn--primary" onClick={() => void reloadPayouts()} disabled={refreshing || listing}>
          {refreshing ? 'Reloading from Stripe…' : 'Reload payouts'}
        </button>
        {refreshedAt && <span className="stripe-page__note">Last reloaded from Stripe {formatWhen(refreshedAt)}</span>}
      </div>
      {listError && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {listError}
        </p>
      )}

      {listing && <p className="stripe-page__note">Loading saved payouts…</p>}
      {!listing && payouts && payouts.length === 0 && (
        <p className="stripe-page__note">No payouts saved yet. Use Reload payouts to load the latest 30 from Stripe.</p>
      )}

      {payoutPage && payoutPage.total > 0 && (
        <div className="stripe-clearing__scroll">
          <table className="stripe-page__table">
            <thead>
              <tr>
                <th>Payout</th>
                <th>Status</th>
                <th>Arrival</th>
                <th className="stripe-payout__num">Amount</th>
                <th className="stripe-payout__num">Charges</th>
                <th className="stripe-payout__num">Gross</th>
                <th className="stripe-payout__num">Fees</th>
                <th>Stripe adds up</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payoutPage.rows.map((p) => (
                <tr key={p.payoutId}>
                  <td className="stripe-clearing__mono">{p.payoutId}</td>
                  <td>{p.status}</td>
                  <td>{formatDay(p.arrivalDate)}</td>
                  <td className="stripe-payout__num">{amount(p.amount)}</td>
                  <td className="stripe-payout__num">{p.composition.chargeCount}</td>
                  <td className="stripe-payout__num">{amount(p.composition.chargeGross)}</td>
                  <td className="stripe-payout__num">{amount(p.composition.chargeFee)}</td>
                  <td>{p.composition.reconciles ? 'Yes' : 'No'}</td>
                  <td>
                    <button type="button" className="btn btn--ghost" disabled={Boolean(loadingId)} onClick={() => void loadPreview(p.payoutId)}>
                      {loadingId === p.payoutId ? 'Checking…' : 'Preview'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav className="stripe-payout__pager" aria-label="Payout pages">
            <span>
              Showing {payoutPage.from}–{payoutPage.to} of {payoutPage.total}
            </span>
            <span className="stripe-payout__pager-controls">
              <button type="button" className="btn btn--ghost" disabled={payoutPage.page <= 1} onClick={() => setPage(payoutPage.page - 1)}>
                Previous
              </button>
              <span>
                Page {payoutPage.page} of {payoutPage.pageCount}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={payoutPage.page >= payoutPage.pageCount}
                onClick={() => setPage(payoutPage.page + 1)}
              >
                Next
              </button>
            </span>
          </nav>
        </div>
      )}

      {previewError && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {previewError}
        </p>
      )}

      {preview && r && (
        <div className="stripe-payout">
          <header className="stripe-payout__head">
            <div>
              <div className="stripe-clearing__mono">{preview.payout.payoutId}</div>
              <div className="stripe-page__note" data-testid="payout-dates">
                Stripe {preview.payout.status} · Arrival date {preview.payout.arrivalDay || formatDay(preview.payout.arrivalDate)} · Zoho posting date{' '}
                {zohoPostingDate(preview)}
              </div>
              <div className="stripe-page__note">New Zoho records are dated on the day they are posted (Asia/Dubai), not the arrival date.</div>
            </div>
            <Badge tone={payoutTone(preview.status)}>{statusLabel(preview.status)}</Badge>
          </header>

          <dl className="stripe-payout__totals">
            <div>
              <dt>Stripe NET (payout)</dt>
              <dd>{aed(r.payoutAmount)}</dd>
            </div>
            <div>
              <dt>Stripe fees</dt>
              <dd>{aed(r.fees)}</dd>
            </div>
            <div>
              <dt>Stripe gross</dt>
              <dd>{aed(r.stripeGross)}</dd>
            </div>
          </dl>

          <ul className="stripe-payout__checks">
            <Check ok={r.payoutMatches}>
              NET {amount(r.netTo1019)} + customer advances {amount(r.customerAdvances)}
              {r.advanceRefundsOutOf1019 ? ` − advance refunds ${amount(r.advanceRefundsOutOf1019)}` : ''}
              {r.normalRefundsNetOutOf1019 ? ` − invoice refunds ${amount(r.normalRefundsNetOutOf1019)}` : ''} = payout {amount(r.payoutAmount)}
            </Check>
            <Check ok={r.grossMatches}>
              1019 total {amount(r.total1019)} + fees {amount(r.fees)} = gross {amount(r.stripeGross)}
            </Check>
            <Check ok={preview.composition.reconciles}>Stripe balance transactions add up to the payout</Check>
          </ul>

          {preview.blockers.length > 0 && (
            <div className="stripe-page__banner stripe-page__banner--error" role="alert">
              <ul className="stripe-payout__reasons">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.accounts.problems.length > 0 && (
            <p className="stripe-page__banner stripe-page__banner--error">{preview.accounts.problems.join(' ')}</p>
          )}
          {preview.warnings.map((w) => (
            <p key={w} className="stripe-page__note">
              {w}
            </p>
          ))}
          {!postingEnabled && (
            <p className="stripe-page__banner">
              Posting disabled.{' '}
              {(preview.postingBlockedReasons || []).map((x) => x.message).join(' ') || 'Zoho posting is switched off on this server.'}
            </p>
          )}

          {uncertain.length > 0 && (
            <UncertainWrites items={uncertain} recheck={recheck} onRecheck={(item) => void recheckUncertain(item)} onConfirm={openNotCreated} />
          )}

          {preview.groups.map((g) => (
            <GroupCard
              key={g.groupKey}
              payoutId={preview.payout.payoutId}
              group={g}
              postingEnabled={postingEnabled}
              onConfirm={openConfirm}
              onPost={openPost}
              onDirectChanged={() => void loadPreview(preview.payout.payoutId)}
            />
          ))}

          {preview.feeJournal && (
            <FeeJournalCard feeJournal={preview.feeJournal} postingEnabled={postingEnabled} onPost={() => preview.feeJournal && openFeePost(preview.feeJournal)} />
          )}

          <UnresolvedCharges
            payoutId={preview.payout.payoutId}
            lines={[...preview.unassigned, ...(preview.reviewCharges ?? [])]}
            onChanged={() => void loadPreview(preview.payout.payoutId)}
          />

          {(normalRefunds.length > 0 || preview.advanceRefunds.length > 0) && (
            <section className="stripe-payout__group" aria-label="Refunds">
              <header className="stripe-payout__group-head">
                <h3>Refunds</h3>
              </header>
              {(preview.refundBlockers ?? []).length > 0 && (
                <p className="stripe-page__note">
                  Refunds needing review keep this payout from being fully cleared; the sales in it can still be posted.
                </p>
              )}

              <h4>Normal invoice refunds ({normalRefunds.length})</h4>
              {normalRefunds.length === 0 ? (
                <p className="stripe-page__note">None in this payout.</p>
              ) : (
                <>
                  <p className="stripe-page__note">
                    Each refund pays out the existing Zoho credit note for the order from [1019] Stripe Undeposited Funds. Credit notes
                    are never created here; any Stripe fee change is booked between [1019] and [1013].
                  </p>
                  {normalRefunds.map((x) => (
                    <NormalRefundCard key={x.balanceTransactionId} refund={x} postingEnabled={postingEnabled} onPost={openRefundPost} />
                  ))}
                </>
              )}

              <h4>Customer advance refunds ({preview.advanceRefunds.length})</h4>
              {preview.advanceRefunds.length === 0 ? (
                <p className="stripe-page__note">None in this payout.</p>
              ) : (
                <ul className="stripe-payout__reasons">
                  {preview.advanceRefunds.map((x) => (
                    <li key={x.balanceTransactionId}>
                      {statusLabel(x.status)} · {aed(x.amount)} · <span className="stripe-clearing__mono">{x.refundId || x.balanceTransactionId}</span> ·{' '}
                      {x.reason}
                      {x.originalAdvanceJournal && (
                        <div className="stripe-page__note">
                          Original advance journal ({x.originalAdvanceJournal.reference}): {statusLabel(x.originalAdvanceJournal.state)}
                        </div>
                      )}
                      {x.refundJournal && (
                        <div className="stripe-page__note">
                          Refund journal Dr [1123] / Cr [1019] ({x.refundJournal.reference}): {statusLabel(x.refundJournal.state)}
                        </div>
                      )}
                      {x.matched && !x.posting.allowed && (
                        <div className="stripe-page__note">Refund journal cannot be posted yet: {x.posting.blockers.join(' ')}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {preview.otherTransactions.length > 0 && (
            <details className="stripe-payout__details">
              <summary>Other Stripe transactions in this payout ({preview.otherTransactions.length}, excluded from clearing)</summary>
              <table className="stripe-page__table">
                <tbody>
                  {preview.otherTransactions.map((t) => (
                    <tr key={t.balanceTransactionId}>
                      <td>{t.type}</td>
                      <td>{t.reportingCategory || '—'}</td>
                      <td>{t.description || '—'}</td>
                      <td className="stripe-payout__num">{amount(t.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {preview.advanceCaseEvents.length > 0 && (
            <details className="stripe-payout__details">
              <summary>Customer advance history</summary>
              <ul className="stripe-payout__reasons">
                {preview.advanceCaseEvents.map((e, i) => (
                  <li key={`${e.entityId}-${i}`}>
                    {formatWhen(e.at)} · {e.fromStatus ? `${statusLabel(e.fromStatus)} → ` : ''}
                    {statusLabel(e.toStatus)} · {e.actor || '—'}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <Modal title="Confirm Customer Advance" open={Boolean(confirm)} onClose={() => !confirm?.saving && setConfirm(null)}>
        {confirm?.line.advance && (
          <div className="stripe-clearing__confirm">
            <dl>
              <div>
                <dt>Customer</dt>
                <dd>{confirm.group.customerName}</dd>
              </div>
              <div>
                <dt>Order / invoice</dt>
                <dd>
                  {confirm.line.website?.orderNumber} · {confirm.line.invoice?.invoiceNumber}
                </dd>
              </div>
              <div>
                <dt>Stripe paid</dt>
                <dd>{aed(confirm.line.advance.stripeGross)}</dd>
              </div>
              <div>
                <dt>Invoice</dt>
                <dd>{aed(confirm.line.advance.invoiceTotal)}</dd>
              </div>
              <div>
                <dt>Customer advance</dt>
                <dd>
                  <strong>{aed(confirm.line.advance.overpaymentAmount)}</strong>
                </dd>
              </div>
              {confirm.line.advance.refund && (
                <div>
                  <dt>Refund already detected</dt>
                  <dd>
                    {aed(confirm.line.advance.refund.amount)} · <span className="stripe-clearing__mono">{confirm.line.advance.refund.refundId}</span> ·{' '}
                    {refundPayoutLabel(confirm.line.advance.refund.refundPayoutId)}
                  </dd>
                </div>
              )}
            </dl>
            <label className="stripe-payout__reason">
              Reason
              <textarea
                rows={3}
                value={confirm.reason}
                placeholder={confirm.line.advance.refund ? REFUNDED_REASON_PLACEHOLDER : REASON_PLACEHOLDER}
                disabled={confirm.saving}
                onChange={(e) => setConfirm({ ...confirm, reason: e.target.value })}
              />
            </label>
            <label className="stripe-clearing__check">
              <input
                type="checkbox"
                checked={confirm.acknowledged}
                disabled={confirm.saving}
                onChange={(e) => setConfirm({ ...confirm, acknowledged: e.target.checked })}
              />
              The {aed(confirm.line.advance.overpaymentAmount)} was owed to the customer when this payout was made and belongs in
              Customer Advance Funds{confirm.line.advance.refund ? '; the later Stripe refund clears it in its own payout' : ''}. This
              changes local status only; nothing is posted to Zoho.
            </label>
            {confirm.error && (
              <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                {confirm.error}
              </p>
            )}
            <div className="stripe-clearing__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)} disabled={confirm.saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submitConfirm()}
                disabled={!confirm.acknowledged || !reasonOk || confirm.saving}
              >
                {confirm.saving ? 'Saving…' : 'Confirm Customer Advance'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal title="Post Customer Group to Zoho" open={Boolean(post)} onClose={() => !post?.posting && setPost(null)}>
        {post && preview && (
          <div className="stripe-clearing__confirm">
            <p>
              <strong>{post.group.customerName}</strong> · payout <span className="stripe-clearing__mono">{preview.payout.payoutId}</span> · Zoho posting date{' '}
              {zohoPostingDate(preview)} (today, Asia/Dubai) · Arrival date {preview.payout.arrivalDay || formatDay(preview.payout.arrivalDate)}
            </p>
            <ol className="stripe-payout__post-steps">
              {postingSteps(post.group).map(({ component: c, willCreate }) => (
                <li key={c.component}>
                  <strong>
                    {c.component === 'CUSTOMER_ADVANCE' ? 'Customer Advance journal' : `${c.component} payment`} · {aed(c.amount)}
                  </strong>
                  {!willCreate && <span className="stripe-page__note"> · already in Zoho ({c.zoho.recordId}); kept, not recreated</span>}
                  <div className="stripe-page__note">
                    {c.zohoRecordType === 'journal' ? (
                      <>
                        Dr {accountLabel(c.debitAccount)} {amount(c.amount)} / Cr {accountLabel(c.creditAccount)} {amount(c.amount)} · tagged{' '}
                        {post.group.customerName}
                      </>
                    ) : (
                      <>
                        Deposit to {accountLabel(c.account)} · customer {post.group.customerName}
                      </>
                    )}
                  </div>
                  <div className="stripe-clearing__mono">{c.reference}</div>
                  {c.allocations.length > 0 && (
                    <table className="stripe-page__table">
                      <tbody>
                        {c.allocations.map((a) => (
                          <tr key={a.invoiceId}>
                            <td>{a.invoiceNumber}</td>
                            <td>{a.orderNumber || allocationSourceLabel(a.source)}</td>
                            <td className="stripe-payout__num">{amount(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              ))}
            </ol>
            <p className="stripe-page__banner">
              The Customer Advance refund journal (Dr [1123] / Cr [1019]) is NOT part of this posting. It belongs to the later Stripe
              payout that contains the refund.
              {postAdvanceLines
                .filter((l) => l.advance?.refund)
                .map((l) => ` Refund ${l.advance?.refund?.refundId} (${aed(l.advance?.refund?.amount)}): ${refundPayoutLabel(l.advance?.refund?.refundPayoutId)}.`)
                .join('')}
            </p>

            {post.result ? (
              <div role="status">
                <p>
                  <strong>Result: {statusLabel(post.result.outcome)}</strong> · Zoho requests sent: {post.result.zohoRequests}
                </p>
                <ul className="stripe-payout__reasons">
                  {post.result.components.map((c) => (
                    <li key={c.component}>
                      {componentLabel(c.component)} · {aed(c.amount)} · {c.status ? statusLabel(c.status) : '—'}
                      {c.zohoRecordId ? ` · Zoho ${c.zohoRecordId}` : ''}
                      {c.reason || c.lastError ? ` · ${c.reason || c.lastError}` : ''}
                    </li>
                  ))}
                  {(post.result.notAttempted || []).map((k) => (
                    <li key={k}>{componentLabel(k)} · not attempted</li>
                  ))}
                </ul>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--primary" onClick={() => setPost(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className="stripe-clearing__check">
                  <input
                    type="checkbox"
                    checked={post.acknowledged}
                    disabled={post.posting}
                    onChange={(e) => setPost({ ...post, acknowledged: e.target.checked })}
                  />
                  I reviewed every record above. They will be created in Zoho for {post.group.customerName} only, in this order, each
                  verified before the next.
                </label>
                {post.error && (
                  <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                    {post.error}
                  </p>
                )}
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setPost(null)} disabled={post.posting}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void submitPost()}
                    disabled={!post.acknowledged || post.posting || !postingEnabled}
                  >
                    {post.posting ? 'Posting…' : 'Post to Zoho'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal title="Post Stripe Fee Journal to Zoho" open={Boolean(feePost)} onClose={() => !feePost?.posting && setFeePost(null)}>
        {feePost && preview && (
          <div className="stripe-clearing__confirm">
            <dl>
              <div>
                <dt>Payout</dt>
                <dd className="stripe-clearing__mono">{preview.payout.payoutId}</dd>
              </div>
              <div>
                <dt>Total Stripe fees</dt>
                <dd>
                  <strong>{aed(feePost.feeJournal.amount)}</strong>
                  {feePost.feeJournal.feeComponents.length > 1 &&
                    ` (${feePost.feeJournal.feeComponents.map((f) => `${f.customerName} ${amount(f.amount)}`).join(' + ')})`}
                </dd>
              </div>
              <div>
                <dt>Zoho posting date</dt>
                <dd>{feePost.feeJournal.date || '—'} (today, Asia/Dubai)</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd className="stripe-clearing__mono">{feePost.feeJournal.reference}</dd>
              </div>
            </dl>
            <table className="stripe-page__table">
              <tbody>
                <tr>
                  <td>Dr</td>
                  <td>{accountLabel(feePost.feeJournal.debitAccount)}</td>
                  <td className="stripe-payout__num">{amount(feePost.feeJournal.amount)}</td>
                </tr>
                <tr>
                  <td>Cr</td>
                  <td>{accountLabel(feePost.feeJournal.creditAccount)}</td>
                  <td className="stripe-payout__num">{amount(feePost.feeJournal.amount)}</td>
                </tr>
              </tbody>
            </table>
            {feePost.feeJournal.status === 'VERIFIED' && (
              <p className="stripe-page__note">
                Already in Zoho ({feePost.feeJournal.zoho.recordId}); it will be recorded locally, not recreated.
              </p>
            )}
            <p className="stripe-page__banner">
              One journal for the whole payout: not tagged to any customer and not split per invoice. The Customer Advance refund
              journal (Dr [1123] / Cr [1019]) is NOT part of this posting.
            </p>

            {feePost.result ? (
              <div role="status">
                <p>
                  <strong>Result: {statusLabel(feePost.result.outcome)}</strong> · Zoho requests sent: {feePost.result.zohoRequests}
                </p>
                <p className="stripe-page__note">
                  {componentLabel(feePost.result.component.component)} · {aed(feePost.result.component.amount)} ·{' '}
                  {feePost.result.component.status ? statusLabel(feePost.result.component.status) : '—'}
                  {feePost.result.component.zohoRecordId ? ` · Zoho ${feePost.result.component.zohoRecordId}` : ''}
                  {feePost.result.component.reason || feePost.result.component.lastError
                    ? ` · ${feePost.result.component.reason || feePost.result.component.lastError}`
                    : ''}
                </p>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--primary" onClick={() => setFeePost(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className="stripe-clearing__check">
                  <input
                    type="checkbox"
                    checked={feePost.acknowledged}
                    disabled={feePost.posting}
                    onChange={(e) => setFeePost({ ...feePost, acknowledged: e.target.checked })}
                  />
                  {feePost.feeJournal.direction === 'FEE_REVERSAL'
                    ? `I reviewed this journal. Stripe returned ${aed(feePost.feeJournal.amount)} more fees than it charged in this payout; it moves that amount from Stripe Fees back to Stripe Processing Chg Un-Cleared (fee expense reversal), and is created in Zoho once, then verified.`
                    : `I reviewed this journal. It moves ${aed(feePost.feeJournal.amount)} of Stripe fees for this payout from Stripe Processing Chg Un-Cleared to Stripe Fees, and is created in Zoho once, then verified.`}
                </label>
                {feePost.error && (
                  <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                    {feePost.error}
                  </p>
                )}
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setFeePost(null)} disabled={feePost.posting}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void submitFeePost()}
                    disabled={!feePost.acknowledged || feePost.posting || !postingEnabled}
                  >
                    {feePost.posting ? 'Posting…' : 'Post Fee Journal to Zoho'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal title="Post Refund to Zoho" open={Boolean(refundPost)} onClose={() => !refundPost?.posting && setRefundPost(null)}>
        {refundPost && preview && (
          <div className="stripe-clearing__confirm">
            <p>
              {refundKindLabel(refundPost.refund)} <strong>{aed(refundPost.refund.gross)}</strong> ·{' '}
              <span className="stripe-clearing__mono">{refundPost.refund.refundId}</span> · {refundPost.refund.customerName} · order{' '}
              {refundPost.refund.website?.orderNumber} · invoice {refundPost.refund.invoice?.invoiceNumber} · Zoho posting date{' '}
              {zohoPostingDate(preview)} (today, Asia/Dubai)
            </p>
            <ol className="stripe-payout__post-steps">
              {refundPost.refund.components.map((c) => (
                <li key={c.component}>
                  <strong>
                    {componentLabel(c.component)} · {aed(c.amount)}
                  </strong>
                  {c.zoho.state === 'VERIFIED' && <span className="stripe-page__note"> · already in Zoho ({c.zoho.recordId}); kept, not recreated</span>}
                  <div className="stripe-page__note">
                    {c.component === 'REFUND_CREDIT_NOTE_REFUND'
                      ? `Credit note ${c.creditNoteNumber} refunded from [1019] Stripe Undeposited Funds`
                      : c.direction === 'FEE_RETURNED'
                        ? 'Dr [1019] Stripe Undeposited Funds / Cr [1013] Stripe Processing Chg Un-Cleared'
                        : 'Dr [1013] Stripe Processing Chg Un-Cleared / Cr [1019] Stripe Undeposited Funds'}
                  </div>
                  <div className="stripe-clearing__mono">{c.reference}</div>
                </li>
              ))}
            </ol>

            {refundPost.result ? (
              <div role="status">
                <p>
                  <strong>Result: {statusLabel(refundPost.result.outcome)}</strong> · Zoho requests sent: {refundPost.result.zohoRequests}
                </p>
                <ul className="stripe-payout__reasons">
                  {refundPost.result.components.map((c) => (
                    <li key={c.component}>
                      {componentLabel(c.component)} · {aed(c.amount)} · {c.status ? statusLabel(c.status) : '—'}
                      {c.zohoRecordId ? ` · Zoho ${c.zohoRecordId}` : ''}
                      {c.reason || c.lastError ? ` · ${c.reason || c.lastError}` : ''}
                    </li>
                  ))}
                  {(refundPost.result.notAttempted || []).map((k) => (
                    <li key={k}>{componentLabel(k)} · not attempted</li>
                  ))}
                </ul>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--primary" onClick={() => setRefundPost(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className="stripe-clearing__check">
                  <input
                    type="checkbox"
                    checked={refundPost.acknowledged}
                    disabled={refundPost.posting}
                    onChange={(e) => setRefundPost({ ...refundPost, acknowledged: e.target.checked })}
                  />
                  I reviewed this refund. The existing credit note is refunded from Stripe Undeposited Funds once, then verified; no
                  credit note or invoice is created or changed.
                </label>
                {refundPost.error && (
                  <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                    {refundPost.error}
                  </p>
                )}
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setRefundPost(null)} disabled={refundPost.posting}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void submitRefundPost()}
                    disabled={!refundPost.acknowledged || refundPost.posting || !postingEnabled}
                  >
                    {refundPost.posting ? 'Posting…' : 'Post Refund to Zoho'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal title="Confirm Not Created in Zoho" open={Boolean(notCreated)} onClose={() => !notCreated?.saving && setNotCreated(null)}>
        {notCreated && (
          <div className="stripe-clearing__confirm">
            <p>
              <strong>
                {componentLabel(notCreated.item.component)} · {aed(notCreated.item.amount)}
              </strong>{' '}
              · <span className="stripe-clearing__mono">{notCreated.item.reference}</span>
            </p>
            <p className="stripe-page__banner stripe-page__banner--error">
              {UNCERTAIN_WARNING}. Zoho did not give a clear answer to this POST, so it may have created the record even though no
              search has found it yet. If it exists and is posted again, Zoho will hold it twice.
            </p>
            <p className="stripe-page__note">
              Search Zoho yourself for this reference, amount and date after the settle window, then record that check below. This
              step sends nothing to Zoho: it checks Zoho once more and, only if that complete search still finds nothing, allows one
              retry. You then start the retry separately with the normal Post button.
            </p>
            {notCreated.result ? (
              <div role="status">
                <p>
                  <strong>
                    {notCreated.result.component.retryAllowed
                      ? 'Retry allowed. Nothing was posted; use the Post button to retry once.'
                      : RECHECK_MESSAGE[notCreated.result.outcome]}
                  </strong>
                </p>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--primary" onClick={() => setNotCreated(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <fieldset className="stripe-payout__reason" aria-label="Your own Zoho check">
                  <legend>Your own Zoho check</legend>
                  <label className="stripe-payout__reason">
                    When you checked
                    <input
                      type="datetime-local"
                      value={notCreated.checkedAt}
                      disabled={notCreated.saving}
                      onChange={(e) => setNotCreated({ ...notCreated, checkedAt: e.target.value })}
                    />
                  </label>
                  <label className="stripe-payout__reason">
                    Where in Zoho you searched
                    <input
                      type="text"
                      value={notCreated.zohoLocation}
                      disabled={notCreated.saving}
                      placeholder="e.g. Manual Journals; Payments Received; the invoice's payment history"
                      onChange={(e) => setNotCreated({ ...notCreated, zohoLocation: e.target.value })}
                    />
                  </label>
                  <label className="stripe-payout__reason">
                    What you searched for (must include the reference)
                    <input
                      type="text"
                      value={notCreated.searchedFor}
                      disabled={notCreated.saving}
                      placeholder={notCreated.item.reference}
                      onChange={(e) => setNotCreated({ ...notCreated, searchedFor: e.target.value })}
                    />
                  </label>
                  <label className="stripe-clearing__check">
                    <input
                      type="checkbox"
                      checked={notCreated.noneFound}
                      disabled={notCreated.saving}
                      onChange={(e) => setNotCreated({ ...notCreated, noneFound: e.target.checked })}
                    />
                    My search found no matching record.
                  </label>
                </fieldset>
                <label className="stripe-payout__reason">
                  Reason (what you checked in Zoho)
                  <textarea
                    rows={3}
                    value={notCreated.reason}
                    disabled={notCreated.saving}
                    placeholder="e.g. Searched Zoho journals and payments for this reference on the payout date: none."
                    onChange={(e) => setNotCreated({ ...notCreated, reason: e.target.value })}
                  />
                </label>
                <label className="stripe-clearing__check">
                  <input
                    type="checkbox"
                    checked={notCreated.acknowledged}
                    disabled={notCreated.saving}
                    onChange={(e) => setNotCreated({ ...notCreated, acknowledged: e.target.checked })}
                  />
                  I searched Zoho and confirm this record does not exist there.
                </label>
                {notCreated.error && (
                  <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                    {notCreated.error}
                  </p>
                )}
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setNotCreated(null)} disabled={notCreated.saving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void submitNotCreated()}
                    disabled={!notCreated.acknowledged || !notCreatedReasonOk || !notCreatedEvidenceOk || notCreated.saving}
                  >
                    {notCreated.saving ? 'Checking Zoho…' : 'Confirm Not Created and Allow Retry'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </article>
  )
}
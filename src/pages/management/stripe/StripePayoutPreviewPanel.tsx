import { useState, type ReactNode } from 'react'
import { Modal } from '../../../components/Modal'
import {
  confirmStripeCustomerAdvance,
  getStripePayoutPreview,
  getStripePayouts,
  postStripePayoutGroup,
  type StripePayoutComponent,
  type StripePayoutGroup,
  type StripePayoutLine,
  type StripePayoutPostResult,
  type StripePayoutPreview,
  type StripePayoutSummary,
} from '../../../api/stripe'
import {
  accountLabel,
  advanceLines,
  aed,
  amount,
  componentLabel,
  formatDay,
  formatWhen,
  groupTone,
  payoutTone,
  postingSteps,
  recoveryLabel,
  refundPayoutLabel,
  statusLabel,
  type Tone,
} from './stripePayoutFormat'

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
  if (!group.postable) return null
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

function GroupCard({
  group,
  postingEnabled,
  onConfirm,
  onPost,
}: {
  group: StripePayoutGroup
  postingEnabled: boolean
  onConfirm: (group: StripePayoutGroup, line: StripePayoutLine) => void
  onPost: (group: StripePayoutGroup) => void
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
                  <td>{l.website?.orderNumber || '—'}</td>
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
  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState('')
  const [preview, setPreview] = useState<StripePayoutPreview | null>(null)
  const [loadingId, setLoadingId] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [post, setPost] = useState<PostState | null>(null)

  async function loadPayouts() {
    setListing(true)
    setListError('')
    try {
      setPayouts((await getStripePayouts(10)).rows)
    } catch (err) {
      setPayouts(null)
      setListError(err instanceof Error ? err.message : 'Could not load payouts.')
    } finally {
      setListing(false)
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

  const r = preview?.reconciliation
  const reasonOk = (confirm?.reason.trim().length ?? 0) >= 10
  const postingEnabled = preview?.postingEnabled === true
  const postAdvanceLines = post ? advanceLines(post.group) : []

  return (
    <article className="stripe-page__card">
      <h2>Payout Clearing Preview</h2>
      <p className="stripe-page__note">
        Each Stripe payout is cleared per customer: NET to [1019] Stripe Undeposited Funds, FEE to [1013] Stripe Processing Chg
        Un-Cleared, and admin-confirmed overpayments to [1123] Customer Advance Funds. Nothing is sent to Zoho until an admin
        posts a customer group, and only while posting is enabled on the server.
      </p>
      <div className="stripe-clearing__filters">
        <button type="button" className="btn btn--primary" onClick={() => void loadPayouts()} disabled={listing}>
          {listing ? 'Loading…' : payouts ? 'Reload payouts' : 'Load recent payouts'}
        </button>
      </div>
      {listError && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {listError}
        </p>
      )}

      {payouts && (
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
              {payouts.map((p) => (
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
              <div className="stripe-page__note">
                Stripe {preview.payout.status} · arrival {formatDay(preview.payout.arrivalDate)} · Zoho date {preview.proposedPaymentDate || '—'}
              </div>
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
              {r.advanceRefundsOutOf1019 ? ` − advance refunds ${amount(r.advanceRefundsOutOf1019)}` : ''} = payout {amount(r.payoutAmount)}
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

          {preview.groups.map((g) => (
            <GroupCard key={g.groupKey} group={g} postingEnabled={postingEnabled} onConfirm={openConfirm} onPost={openPost} />
          ))}

          {preview.unassigned.length > 0 && (
            <section className="stripe-payout__group">
              <h3>Charges without a customer</h3>
              <ul className="stripe-payout__reasons">
                {preview.unassigned.map((l) => (
                  <li key={l.balanceTransactionId}>
                    <span className="stripe-clearing__mono">{l.paymentIntentId || l.chargeId}</span> · {aed(l.gross)} · {l.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview.advanceRefunds.length > 0 && (
            <section className="stripe-payout__group">
              <h3>Refunds of customer advances</h3>
              <ul className="stripe-payout__reasons">
                {preview.advanceRefunds.map((x) => (
                  <li key={x.balanceTransactionId}>
                    {statusLabel(x.status)} · {aed(x.amount)} · {x.reason}
                    {x.originalAdvanceJournal && (
                      <div className="stripe-page__note">
                        Original advance journal ({x.originalAdvanceJournal.reference}): {statusLabel(x.originalAdvanceJournal.state)}
                      </div>
                    )}
                    {x.matched && !x.posting.allowed && (
                      <div className="stripe-page__note">Refund journal cannot be posted yet: {x.posting.blockers.join(' ')}</div>
                    )}
                  </li>
                ))}
              </ul>
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
              <strong>{post.group.customerName}</strong> · payout <span className="stripe-clearing__mono">{preview.payout.payoutId}</span> · Zoho date{' '}
              {preview.proposedPaymentDate || '—'}
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
                            <td>{a.orderNumber}</td>
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
    </article>
  )
}
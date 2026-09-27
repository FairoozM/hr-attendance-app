import { useState } from 'react'
import { Modal } from '../../../components/Modal'
import {
  getStripeClearing,
  getStripeClearingDryRun,
  postStripeClearing,
  previewStripeClearing,
  type StripeClearingDetail,
  type StripeClearingDryRun,
  type StripeClearingDryRunRow,
  type StripeClearingPostResult,
  type StripeClearingPreview,
} from '../../../api/stripe'

type Source = 'stripe' | 'website'

interface ApiError extends Error {
  body?: { code?: string; clearing?: { status?: string } }
}

interface ConfirmState {
  row: StripeClearingDryRunRow
  preview: StripeClearingPreview | null
  loading: boolean
  error: string
  errorCode: string
  confirmed: boolean
  posting: boolean
  result: StripeClearingPostResult | null
  detail: StripeClearingDetail | null
}

const AMBIGUOUS_CODES = new Set([
  'ZOHO_POST_AMBIGUOUS',
  'ZOHO_PAYMENT_VERIFICATION_FAILED',
  'LOCAL_RECORD_FAILED_AFTER_POST',
  'DUPLICATE_ZOHO_REFERENCE',
])

function ymd(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function aed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `AED ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function errorInfo(err: unknown) {
  const e = err as ApiError
  return { message: e instanceof Error ? e.message : 'Request failed.', code: e?.body?.code || '' }
}

function isPosted(row: StripeClearingDryRunRow) {
  return row.localClearing?.status === 'POSTED'
}

export function StripeClearingPanel() {
  const today = new Date()
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 6 * 86_400_000)))
  const [to, setTo] = useState(ymd(today))
  const [source, setSource] = useState<Source>('stripe')
  const [data, setData] = useState<StripeClearingDryRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  async function runDryRun() {
    setLoading(true)
    setError('')
    try {
      setData(await getStripeClearingDryRun({ from, to, source }))
    } catch (err) {
      setData(null)
      setError(errorInfo(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function openConfirm(row: StripeClearingDryRunRow) {
    if (!row.stripePaymentIntentId) return
    const base: ConfirmState = {
      row,
      preview: null,
      loading: true,
      error: '',
      errorCode: '',
      confirmed: false,
      posting: false,
      result: null,
      detail: null,
    }
    setConfirm(base)
    try {
      const preview = await previewStripeClearing(row.stripePaymentIntentId)
      setConfirm({ ...base, loading: false, preview })
    } catch (err) {
      const info = errorInfo(err)
      setConfirm({ ...base, loading: false, error: info.message, errorCode: info.code })
    }
  }

  async function onPost() {
    if (!confirm?.preview || !confirm.confirmed) return
    const paymentIntentId = confirm.preview.paymentIntentId
    setConfirm({ ...confirm, posting: true, error: '', errorCode: '' })
    try {
      const result = await postStripeClearing(paymentIntentId)
      let detail: StripeClearingDetail | null = null
      try {
        detail = await getStripeClearing(paymentIntentId)
      } catch {
        detail = null
      }
      setConfirm((prev) => (prev ? { ...prev, posting: false, result, detail } : prev))
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) =>
                r.stripePaymentIntentId === paymentIntentId
                  ? {
                      ...r,
                      canPost: false,
                      localClearing: {
                        status: result.clearing.status,
                        zohoPaymentId: result.clearing.zohoPaymentId,
                        postedAt: result.clearing.postedAt,
                        lastError: result.clearing.lastError,
                      },
                    }
                  : r,
              ),
            }
          : prev,
      )
    } catch (err) {
      const info = errorInfo(err)
      setConfirm((prev) => (prev ? { ...prev, posting: false, error: info.message, errorCode: info.code } : prev))
    }
  }

  const posting = data?.posting

  return (
    <article className="stripe-page__card">
      <h2>Clear Stripe payments in Zoho</h2>
      <p className="stripe-page__note">
        Matches each Stripe payment to its website order and Zoho invoice. Only exact matches can be cleared, one at a time.
      </p>

      <div className="stripe-clearing__filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Start from
          <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="stripe">Stripe payments</option>
            <option value="website">Website orders</option>
          </select>
        </label>
        <button type="button" className="btn btn--primary" onClick={() => void runDryRun()} disabled={loading}>
          {loading ? 'Checking…' : 'Run dry run'}
        </button>
      </div>

      {error && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {error}
        </p>
      )}

      {data && (
        <>
          {!data.stripeVerified && (
            <p className="stripe-page__banner stripe-page__banner--error">
              Stripe is not connected, so no payment can be verified or cleared.
            </p>
          )}
          {posting && !posting.enabled && (
            <p className="stripe-page__note">Posting is off: {posting.reasons.map((r) => r.message).join(' ')}</p>
          )}
          {data.rows.length === 0 ? (
            <p className="stripe-page__note">No Stripe payments in this range.</p>
          ) : (
            <div className="stripe-clearing__scroll">
              <table className="stripe-page__table">
                <thead>
                  <tr>
                    <th>Stripe PaymentIntent</th>
                    <th>Website order</th>
                    <th>Zoho invoice</th>
                    <th>Stripe amount</th>
                    <th>Zoho balance</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={row.stripePaymentIntentId || `row-${index}`}>
                      <td className="stripe-clearing__mono">{row.stripePaymentIntentId || '—'}</td>
                      <td>{row.website?.orderNumber || '—'}</td>
                      <td>{row.zoho?.invoiceNumber || '—'}</td>
                      <td>{row.stripe ? aed(row.stripe.amount) : '—'}</td>
                      <td>{row.zoho ? aed(row.zoho.balance) : '—'}</td>
                      <td>
                        <span className={`stripe-clearing__status stripe-clearing__status--${row.result.status === 'MATCHED_READY_TO_CLEAR' ? 'ready' : 'other'}`}>
                          {row.result.status}
                        </span>
                        {row.localClearing && <div className="stripe-page__note">Local: {row.localClearing.status}</div>}
                      </td>
                      <td>{row.result.reason}</td>
                      <td>
                        {row.result.status === 'MATCHED_READY_TO_CLEAR' && !isPosted(row) && (
                          <button
                            type="button"
                            className="btn btn--primary"
                            disabled={!row.canPost}
                            title={row.canPost ? undefined : posting?.reasons.map((r) => r.message).join(' ')}
                            onClick={() => void openConfirm(row)}
                          >
                            Clear in Zoho
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && <p className="stripe-page__note">Only the first rows are shown; narrow the date range.</p>}
        </>
      )}

      <Modal title="Clear payment in Zoho" open={Boolean(confirm)} onClose={() => !confirm?.posting && setConfirm(null)}>
        {confirm && (
          <div className="stripe-clearing__confirm">
            {confirm.loading && <p className="stripe-page__note">Re-checking Stripe, the website order and Zoho…</p>}

            {confirm.preview && !confirm.result && (
              <>
                <dl>
                  <div>
                    <dt>Website Order</dt>
                    <dd>{confirm.preview.websiteOrderNumber}</dd>
                  </div>
                  <div>
                    <dt>Zoho Invoice</dt>
                    <dd>{confirm.preview.zohoInvoiceNumber}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{aed(confirm.preview.amount)}</dd>
                  </div>
                  <div>
                    <dt>Stripe PaymentIntent</dt>
                    <dd className="stripe-clearing__mono">{confirm.preview.paymentIntentId}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{confirm.preview.zohoAccount.accountName}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>{confirm.preview.zohoCustomer.name}</dd>
                  </div>
                  <div>
                    <dt>Payment date</dt>
                    <dd>{confirm.preview.paymentDate}</dd>
                  </div>
                </dl>
                {!confirm.preview.postingEnabled && (
                  <p className="stripe-page__banner stripe-page__banner--error">
                    Posting is off: {confirm.preview.postingBlockedReasons.map((r) => r.message).join(' ')}
                  </p>
                )}
                <label className="stripe-clearing__check">
                  <input
                    type="checkbox"
                    checked={confirm.confirmed}
                    disabled={confirm.posting || !confirm.preview.postingEnabled}
                    onChange={(e) => setConfirm({ ...confirm, confirmed: e.target.checked })}
                  />
                  I confirm this customer payment should be created in Zoho.
                </label>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)} disabled={confirm.posting}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void onPost()}
                    disabled={!confirm.confirmed || confirm.posting || !confirm.preview.postingEnabled}
                  >
                    {confirm.posting ? 'Posting…' : 'Clear in Zoho'}
                  </button>
                </div>
              </>
            )}

            {confirm.result && (
              <>
                <p className="stripe-page__ok" role="status">
                  {confirm.result.clearing.status}
                </p>
                <dl>
                  <div>
                    <dt>Zoho Payment ID</dt>
                    <dd className="stripe-clearing__mono">{confirm.result.clearing.zohoPaymentId || '—'}</dd>
                  </div>
                  <div>
                    <dt>Posted</dt>
                    <dd>{confirm.result.clearing.postedAt ? new Date(confirm.result.clearing.postedAt).toLocaleString() : '—'}</dd>
                  </div>
                  <div>
                    <dt>Invoice balance now</dt>
                    <dd>
                      {aed(confirm.detail?.zohoInvoice?.balance ?? confirm.result.invoiceBalanceAfter)}
                      {confirm.result.invoiceBalanceBefore != null && ` (was ${aed(confirm.result.invoiceBalanceBefore)})`}
                    </dd>
                  </div>
                </dl>
                <div className="stripe-clearing__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                    Close
                  </button>
                </div>
              </>
            )}

            {confirm.error && (
              <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                {confirm.error}
                {AMBIGUOUS_CODES.has(confirm.errorCode) &&
                  ' Do not retry or create this payment by hand; check Zoho for a payment with this PaymentIntent reference first.'}
              </p>
            )}
          </div>
        )}
      </Modal>
    </article>
  )
}

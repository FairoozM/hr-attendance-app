import { useState } from 'react'
import { getStripeClearingDryRun, type StripeClearingDryRun } from '../../../api/stripe'

type Source = 'stripe' | 'website'

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

/** Read-only per-payment matching diagnostic. Stripe money is cleared per payout, not here. */
export function StripeClearingPanel() {
  const today = new Date()
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 6 * 86_400_000)))
  const [to, setTo] = useState(ymd(today))
  const [source, setSource] = useState<Source>('stripe')
  const [data, setData] = useState<StripeClearingDryRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function runDryRun() {
    setLoading(true)
    setError('')
    try {
      setData(await getStripeClearingDryRun({ from, to, source }))
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <article className="stripe-page__card">
      <h2>Payment matching check</h2>
      <p className="stripe-page__note">
        Matches each Stripe payment to its website order and Zoho invoice. Read only; use the Payout Clearing Preview to clear
        Stripe money.
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
          {loading ? 'Checking…' : 'Run check'}
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
            <p className="stripe-page__banner stripe-page__banner--error">Stripe is not connected, so no payment can be verified.</p>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && <p className="stripe-page__note">Only the first rows are shown; narrow the date range.</p>}
        </>
      )}
    </article>
  )
}

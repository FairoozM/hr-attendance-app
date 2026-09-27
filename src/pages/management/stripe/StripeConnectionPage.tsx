import { useCallback, useEffect, useState } from 'react'
import { getApiBaseUrl } from '../../../lib/api'
import {
  getStripeStatus,
  testStripeConnection,
  type StripeConnectionStatus,
  type StripeConnectionTestResult,
} from '../../../api/stripe'
import { StripeClearingPanel } from './StripeClearingPanel'
import './StripeConnectionPage.css'

function webhookUrl(path: string) {
  const base = getApiBaseUrl().replace(/\/$/, '')
  if (base) return `${base}${path}`
  return `${window.location.origin}${path}`
}

function formatWhen(value: string | null) {
  if (!value) return 'No events yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No events yet'
  return date.toLocaleString()
}

export function StripeConnectionPage() {
  const [status, setStatus] = useState<StripeConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<StripeConnectionTestResult | null>(null)
  const [testError, setTestError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await getStripeStatus()
      setStatus(next)
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : 'Could not load Stripe status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onTestConnection() {
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      setTestResult(await testStripeConnection())
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Stripe connection failed.')
    } finally {
      setTesting(false)
    }
  }

  async function onCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const url = webhookUrl(status?.webhookPath || '/api/integrations/stripe/webhook')

  return (
    <section className="stripe-page">
      <header className="stripe-page__header">
        <div>
          <h1 className="stripe-page__title">Stripe</h1>
          <p className="stripe-page__subtitle">
            Connection status for this server. Card payments and Subscription Management stay separate.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </header>

      {loading && <p className="stripe-page__note">Loading Stripe status…</p>}
      {error && (
        <p className="stripe-page__banner stripe-page__banner--error" role="alert">
          {error}
        </p>
      )}

      {status && (
        <>
          <div className="stripe-page__grid">
            <article className="stripe-page__card">
              <h2>Connection</h2>
              <p className={status.ready ? 'stripe-page__ok' : 'stripe-page__warn'}>
                {status.ready ? 'Ready' : 'Not ready'}
              </p>
              <dl>
                <div>
                  <dt>Mode</dt>
                  <dd>{status.mode || 'Not set'}</dd>
                </div>
                <div>
                  <dt>Secret key</dt>
                  <dd>{status.secretKeyConfigured ? 'Configured' : 'Missing'}</dd>
                </div>
                <div>
                  <dt>Webhook secret</dt>
                  <dd>{status.webhookSecretConfigured ? 'Configured' : 'Missing'}</dd>
                </div>
                <div>
                  <dt>Last event</dt>
                  <dd>{status.lastEventType ? `${status.lastEventType} · ${formatWhen(status.lastEventAt)}` : 'None'}</dd>
                </div>
              </dl>
              {status.modeMismatch && (
                <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                  STRIPE_MODE does not match the secret key. Use test with a test key, or live with a live key.
                </p>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void onTestConnection()}
                disabled={testing || !status.secretKeyConfigured || status.modeMismatch}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              {testResult && (
                <p className="stripe-page__ok" role="status">
                  Connected in {testResult.mode} mode
                  {testResult.accountId ? ` · ${testResult.accountId}` : ''}
                  {testResult.chargesEnabled ? ' · charges enabled' : ' · charges disabled'}
                </p>
              )}
              {testError && (
                <p className="stripe-page__banner stripe-page__banner--error" role="alert">
                  {testError}
                </p>
              )}
            </article>

            <article className="stripe-page__card">
              <h2>Webhook</h2>
              <p className="stripe-page__note">
                Register this URL in the Stripe Dashboard. Stripe signs the request; this page never shows the signing secret.
              </p>
              <code className="stripe-page__url">{url}</code>
              <button type="button" className="btn btn--ghost" onClick={() => void onCopy(url)}>
                {copied ? 'Copied' : 'Copy URL'}
              </button>
            </article>
          </div>

          <StripeClearingPanel />

          <article className="stripe-page__card">
            <h2>Recent events</h2>
            {status.recentEvents.length === 0 ? (
              <p className="stripe-page__note">No verified Stripe events have been stored yet.</p>
            ) : (
              <table className="stripe-page__table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Mode</th>
                    <th>Object</th>
                  </tr>
                </thead>
                <tbody>
                  {status.recentEvents.map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatWhen(event.receivedAt)}</td>
                      <td>{event.type}</td>
                      <td>{event.livemode ? 'live' : 'test'}</td>
                      <td>{event.objectId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </>
      )}
    </section>
  )
}

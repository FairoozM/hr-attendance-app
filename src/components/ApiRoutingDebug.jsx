import { useCallback, useState } from 'react'
import { probeApiHealth } from '../api/client'

/**
 * Temporary: verify CloudFront routes GET /api/health to the backend.
 * Shown when `?apiDebug=1` is on the URL (or in dev).
 */
export function ApiRoutingDebug() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)

  const run = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setResult(null)
    try {
      const r = await probeApiHealth()
      setResult(r)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="api-routing-debug" role="region" aria-label="API routing check">
      <p className="api-routing-debug__title">API routing check (GET /api/health)</p>
      <button type="button" className="api-routing-debug__btn" onClick={run} disabled={loading}>
        {loading ? 'Checking…' : 'Run check'}
      </button>
      {err && (
        <p className="api-routing-debug__err" role="alert">
          {err}
        </p>
      )}
      {result && (
        <dl className="api-routing-debug__dl">
          <dt>Request URL</dt>
          <dd className="api-routing-debug__mono">{result.requestUrl}</dd>
          <dt>Status</dt>
          <dd>{result.status}</dd>
          <dt>Content-Type</dt>
          <dd className="api-routing-debug__mono">{result.contentType}</dd>
          <dt>Body parses as JSON</dt>
          <dd>{result.isJson ? 'yes' : 'no'}</dd>
          <dt>Body preview</dt>
          <dd className="api-routing-debug__mono api-routing-debug__preview">{result.bodyPreview}</dd>
        </dl>
      )}
    </div>
  )
}

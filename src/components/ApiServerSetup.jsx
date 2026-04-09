import { useState } from 'react'
import { getApiBaseUrl, setApiBaseUrlInStorage } from '../api/config'

/**
 * Production: when no API base is configured, CloudFront often returns HTML for /api/*.
 * User enters the Express origin once; we persist to localStorage and reload.
 */
export function ApiServerSetup() {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')

  if (!import.meta.env.PROD || getApiBaseUrl()) {
    return null
  }

  const save = (e) => {
    e.preventDefault()
    setErr('')
    const t = url.trim().replace(/\/$/, '')
    if (!t) {
      setErr('Enter your backend URL (e.g. https://api.example.com)')
      return
    }
    if (!/^https?:\/\//i.test(t)) {
      setErr('URL must start with http:// or https://')
      return
    }
    setApiBaseUrlInStorage(t)
    window.location.reload()
  }

  return (
    <div className="api-server-setup" role="region" aria-label="Backend API configuration">
      <p className="api-server-setup__lead">
        This site is not reaching your API server (requests to <code>/api</code> return the web app instead of JSON).
        Use the same origin as this app (CloudFront), with no path and no trailing slash — e.g.{' '}
        <code>https://d3ci8wu1d5dytp.cloudfront.net</code> — not <code>#/login</code>, not{' '}
        <code>/api</code>.
      </p>
      <form onSubmit={save} className="api-server-setup__form">
        <label className="login-label">
          Backend API URL
          <input
            type="text"
            className="login-input"
            placeholder="https://d3ci8wu1d5dytp.cloudfront.net"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            inputMode="url"
          />
        </label>
        {err && (
          <p className="login-error" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn btn--primary login-submit">
          Save & reload
        </button>
      </form>
      <p className="api-server-setup__hint">
        Same-origin CloudFront URL is enough when <code>/api/*</code> routes to Express. Otherwise use your API host (ALB, etc.) — no <code>/api</code> suffix.
      </p>
    </div>
  )
}

import { useState } from 'react'
import { setApiBaseUrlInStorage } from '../api/config'

/**
 * Shown only when the async health probe in LoginPage confirms /api/health is unreachable.
 * User enters the backend URL once; it is persisted to localStorage and the page reloads.
 */
export function ApiServerSetup() {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    const t = url.trim().replace(/\/$/, '')
    if (!t) {
      setErr('Enter your backend URL (e.g. https://d3ci8wu1d5dytp.cloudfront.net)')
      return
    }
    if (!/^https?:\/\//i.test(t)) {
      setErr('URL must start with http:// or https://')
      return
    }

    setSaving(true)
    const healthUrl = `${t}/api/health`
    console.log('[ApiServerSetup] probing entered URL →', healthUrl)
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const ct = res.headers.get('content-type') || '(missing)'
      const text = await res.text()
      let isJson = false
      try {
        JSON.parse(text)
        isJson = true
      } catch {
        isJson = false
      }
      console.log('[ApiServerSetup] probe result', {
        url: healthUrl,
        status: res.status,
        contentType: ct,
        isJson,
        body: text.slice(0, 200),
      })
      if (!res.ok || !isJson) {
        setSaving(false)
        setErr(
          `Could not reach ${healthUrl} (HTTP ${res.status}, content-type: ${ct}). ` +
            `Check the URL and try again.`
        )
        return
      }
    } catch (e) {
      setSaving(false)
      setErr(`Could not reach ${healthUrl}: ${e.message}`)
      return
    }

    console.log('[ApiServerSetup] saving API base URL to localStorage:', t)
    setApiBaseUrlInStorage(t)
    window.location.reload()
  }

  return (
    <div className="api-server-setup" role="region" aria-label="Backend API configuration">
      <p className="api-server-setup__lead">
        This site is not reaching your API server (requests to <code>/api</code> return the web
        app instead of JSON). Use the same origin as this app (CloudFront), with no path and no
        trailing slash — e.g. <code>https://d3ci8wu1d5dytp.cloudfront.net</code> — not{' '}
        <code>#/login</code>, not <code>/api</code>.
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
            disabled={saving}
          />
        </label>
        {err && (
          <p className="login-error" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn btn--primary login-submit" disabled={saving}>
          {saving ? 'Checking…' : 'Save & reload'}
        </button>
      </form>
      <p className="api-server-setup__hint">
        Same-origin CloudFront URL is enough when <code>/api/*</code> routes to Express.
        Otherwise use your API host (ALB, etc.) — no <code>/api</code> suffix.
      </p>
    </div>
  )
}

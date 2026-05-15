import { useState } from 'react'
import { setApiBaseUrlInStorage } from '../api/config'
import { getApiBaseUrlMemory } from '../lib/api'

/**
 * Shown when /api/health is unreachable from this origin.
 * Saves the API base URL in memory for this tab (lost on full reload); production should use HR_PUBLIC_API_URL.
 */
export function ApiServerSetup({ onSaved }) {
  const [url, setUrl] = useState(() => getApiBaseUrlMemory() || '')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    const t = url.trim().replace(/\/$/, '')
    if (!t) {
      setErr(
        'Enter the URL where Express runs (e.g. https://ec2-xx.compute.amazonaws.com:5001 or https://api.yourdomain.com) — not this app\'s CloudFront address unless /api/* is routed there.'
      )
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
            'Use the host where Node listens (often port 5001 on your server or ALB), not the static website URL, unless CloudFront forwards /api/* to that server.'
        )
        return
      }
    } catch (e) {
      setSaving(false)
      setErr(`Could not reach ${healthUrl}: ${e.message}`)
      return
    }

    console.log('[ApiServerSetup] saving API base URL in memory (this tab):', t)
    setApiBaseUrlInStorage(t)
    setSaving(false)
    onSaved?.()
  }

  return (
    <div className="api-server-setup" role="region" aria-label="Backend API configuration">
      <p className="api-server-setup__lead">
        This app is loaded from CloudFront/S3, but <code>/api/*</code> is not reaching your Express
        server (you get HTML or 403 instead of JSON). Enter the <strong>public URL of your API</strong>{' '}
        (no path, no trailing slash): e.g. <code>https://your-server.example.com:5001</code> or your
        ALB URL — <em>not</em> <code>#/login</code> and not <code>/api</code>. If the API is on the
        same domain as this page, fix CloudFront so <code>/api/*</code> goes to Node (see{' '}
        <code>docs/cloudfront-api-routing.md</code>) or set <code>HR_PUBLIC_API_URL</code> when
        deploying the frontend.
      </p>
      <form onSubmit={save} className="api-server-setup__form">
        <label className="login-label">
          Backend API URL
          <input
            type="text"
            className="login-input"
            placeholder="https://your-api-host.example.com:5001"
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
          {saving ? 'Checking…' : 'Save & continue'}
        </button>
      </form>
      <p className="api-server-setup__hint">
        The URL is kept in memory for this tab only (a full page reload clears it unless{' '}
        <code>HR_PUBLIC_API_URL</code> is set at deploy time). Prefer baking the API origin into{' '}
        <code>api-runtime-config.js</code> for production.
      </p>
    </div>
  )
}

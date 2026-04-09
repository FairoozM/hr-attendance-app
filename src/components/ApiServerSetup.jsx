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
        Enter the full URL where your Express backend is running — no trailing slash.
      </p>
      <form onSubmit={save} className="api-server-setup__form">
        <label className="login-label">
          Backend API URL
          <input
            type="text"
            className="login-input"
            placeholder="https://your-alb.region.elb.amazonaws.com"
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
        Example: your ALB, Elastic Beanstalk URL, or <code>https://api.yourdomain.com</code>. The API must allow CORS from this page&apos;s origin.
      </p>
    </div>
  )
}

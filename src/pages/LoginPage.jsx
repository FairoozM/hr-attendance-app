import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ApiRoutingDebug } from '../components/ApiRoutingDebug'
import { ApiServerSetup } from '../components/ApiServerSetup'
import './Page.css'
import './LoginPage.css'

/**
 * Probe same-origin /api/health and return true when it responds with valid JSON.
 * Logs every detail so it appears in the browser console for debugging.
 */
async function probeSameOriginHealth() {
  const origin = window.location.origin
  const healthUrl = `${origin}/api/health`
  console.log('[LoginPage] probing API health →', healthUrl)
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
    console.log('[LoginPage] health probe result', {
      url: healthUrl,
      status: res.status,
      contentType: ct,
      isJson,
      body: text.slice(0, 300),
    })
    return res.ok && isJson
  } catch (e) {
    console.warn('[LoginPage] health probe failed with error:', e.message)
    return false
  }
}

export function LoginPage() {
  const [searchParams] = useSearchParams()

  // 'checking' while we probe; 'ok' if API is reachable; 'needs-setup' if it is not
  const [apiCheckStatus, setApiCheckStatus] = useState(
    !import.meta.env.PROD ? 'ok' : 'checking'
  )

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  useEffect(() => {
    if (!import.meta.env.PROD) return

    async function checkApi() {
      // Log what is currently stored so we can debug in the console
      const stored = localStorage.getItem('hr_api_base_url') || ''
      console.log('[LoginPage] stored hr_api_base_url:', stored || '(none)')

      // Always probe the same-origin URL first
      const healthy = await probeSameOriginHealth()
      if (healthy) {
        const origin = window.location.origin
        if (!stored) {
          localStorage.setItem('hr_api_base_url', origin)
          console.log('[LoginPage] saved API base URL to localStorage:', origin)
        }
        setApiCheckStatus('ok')
        return
      }

      // Same-origin failed; if a stored URL exists, try that
      if (stored) {
        const storedHealthUrl = `${stored}/api/health`
        console.log('[LoginPage] same-origin failed; probing stored URL →', storedHealthUrl)
        try {
          const res = await fetch(storedHealthUrl, {
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
          console.log('[LoginPage] stored-URL health result', {
            url: storedHealthUrl,
            status: res.status,
            contentType: ct,
            isJson,
            body: text.slice(0, 300),
          })
          if (res.ok && isJson) {
            setApiCheckStatus('ok')
            return
          }
        } catch (e) {
          console.warn('[LoginPage] stored-URL probe error:', e.message)
        }
      }

      // Neither probe succeeded — show setup form
      console.warn('[LoginPage] API health unreachable — showing setup screen')
      setApiCheckStatus('needs-setup')
    }

    checkApi()
  }, [])

  if (user) {
    return <Navigate to={from} replace />
  }

  const needsApiSetup = apiCheckStatus === 'needs-setup'
  const showApiDebug =
    (import.meta.env.DEV || searchParams.get('apiDebug') === '1') && !needsApiSetup

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const u = await login(username.trim(), password)
      if (u.role === 'employee') {
        navigate('/account', { replace: true })
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err.message || 'Login failed')
    }
  }

  return (
    <div className="page login-page">
      <div className="login-card">
        <h1 className="login-title">HR Attendance</h1>
        {needsApiSetup ? (
          <ApiServerSetup />
        ) : (
          <>
            <p className="login-subtitle">
              Sign in with your admin, warehouse, or employee portal credentials
            </p>
            <form className="login-form" onSubmit={handleSubmit}>
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <label className="login-label">
                Username
                <input
                  type="text"
                  className="login-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </label>
              <label className="login-label">
                Password
                <input
                  type="password"
                  className="login-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" className="btn btn--primary login-submit">
                Sign in
              </button>
            </form>
            {showApiDebug && <ApiRoutingDebug />}
          </>
        )}
      </div>
    </div>
  )
}

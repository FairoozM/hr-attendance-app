import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { ApiRoutingDebug } from '../components/ApiRoutingDebug'
import { ApiServerSetup } from '../components/ApiServerSetup'
import { API_BASE_STORAGE_KEY } from '../api/config'
import './Page.css'
import './LoginPage.css'

function trimOrigin(s) {
  return String(s || '').trim().replace(/\/$/, '')
}

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

  const [email, setEmail] = useState('')
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
      let stored = localStorage.getItem(API_BASE_STORAGE_KEY) || ''
      console.log('[LoginPage] stored backendUrl:', stored || '(none)')

      // Always probe the same-origin URL first
      const healthy = await probeSameOriginHealth()
      if (healthy) {
        const origin = window.location.origin
        if (!stored) {
          localStorage.setItem(API_BASE_STORAGE_KEY, origin)
          console.log('[LoginPage] saved API base URL to localStorage:', origin)
        }
        setApiCheckStatus('ok')
        return
      }

      // Same-origin /api is not JSON (CloudFront → S3, etc.). Remove mistaken save of SPA host as API base.
      const originNorm = trimOrigin(window.location.origin)
      if (stored && trimOrigin(stored) === originNorm) {
        try {
          localStorage.removeItem(API_BASE_STORAGE_KEY)
        } catch (_) {}
        stored = ''
        console.warn(
          '[LoginPage] Cleared backendUrl: this site URL does not serve /api/* as JSON — use your Express host (see deploy HR_PUBLIC_API_URL or login setup).'
        )
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
      const u = await login(email.trim(), password)
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
      <div className="login-orb login-orb--one" aria-hidden />
      <div className="login-orb login-orb--two" aria-hidden />
      <div className="login-orb login-orb--three" aria-hidden />

      <div className="login-shell">
        <motion.section
          className="login-stage"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="login-stage__logo-wrap">
            <div className="login-stage__logo-frame">
              <div className="login-stage__logo-ring login-stage__logo-ring--outer" aria-hidden />
              <div className="login-stage__logo-ring login-stage__logo-ring--inner" aria-hidden />
              <div className="login-stage__logo-glow" aria-hidden />
              <img
                src="/lifesmile-logo.png"
                alt="Life Smile"
                className="login-stage__logo-img"
              />
            </div>
          </div>

          <div className="login-stage__brand">
            <div className="login-stage__eyebrow">Business Intelligence (BI)</div>
            <h1 className="login-stage__title">Life Smile</h1>
            <p className="login-stage__tagline">Life Towards Health</p>
          </div>

          <div className="login-stage__metrics">
            <div className="login-stage__metric">
              <span className="login-stage__metric-dot" aria-hidden />
              <span className="login-stage__metric-label">Employees &amp; Attendance</span>
            </div>
            <div className="login-stage__metric">
              <span className="login-stage__metric-dot" aria-hidden />
              <span className="login-stage__metric-label">Leave &amp; Approvals</span>
            </div>
            <div className="login-stage__metric">
              <span className="login-stage__metric-dot" aria-hidden />
              <span className="login-stage__metric-label">Influencer Workflows</span>
            </div>
          </div>
        </motion.section>

        <motion.div
          className="login-card"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="login-card__shine" aria-hidden />
          <div className="login-card__orb" aria-hidden />

          <div className="login-card__header">
            <div className="login-kicker">Staff portal</div>
            <h2 className="login-title">Welcome back</h2>
            <p className="login-subtitle">
              Sign in to your Life Smile workspace.
            </p>
          </div>

          {needsApiSetup ? (
            <ApiServerSetup />
          ) : (
            <>
              <form className="login-form" onSubmit={handleSubmit}>
                {error && (
                  <p className="login-error" role="alert">
                    {error}
                  </p>
                )}
                <label className="login-label">
                  Email Address
                  <input
                    type="email"
                    className="login-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
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
        </motion.div>
      </div>
    </div>
  )
}

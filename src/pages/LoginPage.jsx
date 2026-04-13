import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
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
          <div className="login-stage__eyebrow">Premium people operations</div>
          <h1 className="login-stage__title">HR attendance with a cinematic control room feel.</h1>
          <p className="login-stage__subtitle">
            Manage teams, attendance, leave, creator workflows, and permissions in one polished workspace.
          </p>

          <div className="login-stage__metrics">
            <div className="login-stage__metric">
              <span className="login-stage__metric-value">HR</span>
              <span className="login-stage__metric-label">Employees, leave, roster</span>
            </div>
            <div className="login-stage__metric">
              <span className="login-stage__metric-value">Ops</span>
              <span className="login-stage__metric-label">Attendance and approvals</span>
            </div>
            <div className="login-stage__metric">
              <span className="login-stage__metric-value">Creator</span>
              <span className="login-stage__metric-label">Influencer workflow control</span>
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
            <div className="login-kicker">Access portal</div>
            <h2 className="login-title">HR Attendance</h2>
            <p className="login-subtitle">
              Sign in with your admin, warehouse, or employee portal credentials.
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

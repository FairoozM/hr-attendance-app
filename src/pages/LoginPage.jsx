import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Page.css'
import './LoginPage.css'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  if (user) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    try {
      login(username.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    }
  }

  return (
    <div className="page login-page">
      <div className="login-card">
        <h1 className="login-title">HR Attendance</h1>
        <p className="login-subtitle">Sign in to continue</p>
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
      </div>
    </div>
  )
}

import { useState } from 'react'
import { api } from '../api/client'
import './PasswordSection.css'

function EyeIcon({ visible }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function PasswordInput({ id, label, value, onChange, show, onToggleShow, autoComplete, required = true }) {
  return (
    <div className="pwd-field">
      <label htmlFor={id} className="pwd-field__label">{label}</label>
      <div className="pwd-field__wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="pwd-field__input"
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required={required}
        />
        <button
          type="button"
          className="pwd-field__eye"
          onClick={onToggleShow}
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
          tabIndex={-1}
        >
          <EyeIcon visible={show} />
        </button>
      </div>
    </div>
  )
}

/**
 * Reusable self-service password change form.
 * Available to all authenticated roles (employee, admin, warehouse).
 */
export function PasswordSection() {
  const [form, setForm] = useState({ current: '', newPwd: '', confirm: '' })
  const [show, setShow] = useState({ current: false, newPwd: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  const setField = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setSuccess(false)
    setError(null)
  }

  const toggleShow = (k) => () => setShow((s) => ({ ...s, [k]: !s[k] }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!form.current) {
      setError('Current password is required')
      return
    }
    if (!form.newPwd) {
      setError('New password is required')
      return
    }
    if (form.newPwd.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (form.newPwd !== form.confirm) {
      setError('New password and confirm password do not match')
      return
    }
    if (form.current === form.newPwd) {
      setError('New password must be different from your current password')
      return
    }

    setSaving(true)
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: form.current,
        newPassword: form.newPwd,
        confirmPassword: form.confirm,
      })
      setSuccess(true)
      setForm({ current: '', newPwd: '', confirm: '' })
    } catch (err) {
      setError(err.message || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pwd-section">
      <div className="pwd-section__header">
        <div className="pwd-section__lock-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div>
          <h3 className="pwd-section__title">Change Password</h3>
          <p className="pwd-section__subtitle">
            Enter your current password then set a new one. Minimum 8 characters.
          </p>
        </div>
      </div>

      <form className="pwd-form" onSubmit={handleSubmit} noValidate>
        <PasswordInput
          id="pwd-current"
          label="Current Password"
          value={form.current}
          onChange={setField('current')}
          show={show.current}
          onToggleShow={toggleShow('current')}
          autoComplete="current-password"
        />
        <PasswordInput
          id="pwd-new"
          label="New Password"
          value={form.newPwd}
          onChange={setField('newPwd')}
          show={show.newPwd}
          onToggleShow={toggleShow('newPwd')}
          autoComplete="new-password"
        />
        <PasswordInput
          id="pwd-confirm"
          label="Confirm New Password"
          value={form.confirm}
          onChange={setField('confirm')}
          show={show.confirm}
          onToggleShow={toggleShow('confirm')}
          autoComplete="new-password"
        />

        {/* Strength hint when user starts typing new password */}
        {form.newPwd.length > 0 && form.newPwd.length < 8 && (
          <p className="pwd-hint pwd-hint--warn">
            {8 - form.newPwd.length} more character{8 - form.newPwd.length !== 1 ? 's' : ''} needed
          </p>
        )}
        {form.newPwd.length >= 8 && form.confirm.length > 0 && form.newPwd !== form.confirm && (
          <p className="pwd-hint pwd-hint--warn">Passwords do not match</p>
        )}
        {form.newPwd.length >= 8 && form.confirm.length > 0 && form.newPwd === form.confirm && (
          <p className="pwd-hint pwd-hint--ok">✓ Passwords match</p>
        )}

        {error && (
          <p className="pwd-message pwd-message--error" role="alert">{error}</p>
        )}
        {success && (
          <p className="pwd-message pwd-message--success" role="status">
            ✓ Password changed successfully. Use your new password next time you log in.
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving || !form.current || !form.newPwd || !form.confirm}
        >
          {saving ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  )
}

/**
 * Admin-only panel for resetting another user's password.
 * Does NOT require the old password.
 */
export function AdminResetPasswordPanel({ userId, username, onClose }) {
  const [form, setForm] = useState({ newPwd: '', confirm: '' })
  const [show, setShow] = useState({ newPwd: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  const setField = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setError(null)
    setSuccess(false)
  }

  const toggleShow = (k) => () => setShow((s) => ({ ...s, [k]: !s[k] }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (form.newPwd.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (form.newPwd !== form.confirm) {
      setError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      await api.post(`/api/admin/users/${userId}/reset-password`, {
        newPassword: form.newPwd,
        confirmPassword: form.confirm,
      })
      setSuccess(true)
      setForm({ newPwd: '', confirm: '' })
    } catch (err) {
      setError(err.message || 'Failed to reset password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pwd-section pwd-section--admin-reset">
      <div className="pwd-section__header">
        <div className="pwd-section__lock-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div>
          <h3 className="pwd-section__title">Reset Password</h3>
          <p className="pwd-section__subtitle">
            Set a new password for <strong>{username}</strong>. The user's current password will be replaced immediately.
          </p>
        </div>
      </div>

      <form className="pwd-form" onSubmit={handleSubmit} noValidate>
        <PasswordInput
          id={`admin-new-${userId}`}
          label="New Password"
          value={form.newPwd}
          onChange={setField('newPwd')}
          show={show.newPwd}
          onToggleShow={toggleShow('newPwd')}
          autoComplete="new-password"
        />
        <PasswordInput
          id={`admin-confirm-${userId}`}
          label="Confirm New Password"
          value={form.confirm}
          onChange={setField('confirm')}
          show={show.confirm}
          onToggleShow={toggleShow('confirm')}
          autoComplete="new-password"
        />

        {form.newPwd.length >= 8 && form.confirm.length > 0 && form.newPwd === form.confirm && (
          <p className="pwd-hint pwd-hint--ok">✓ Passwords match</p>
        )}

        {error && <p className="pwd-message pwd-message--error" role="alert">{error}</p>}
        {success && (
          <p className="pwd-message pwd-message--success" role="status">
            ✓ Password reset for {username}. They can now log in with the new password.
          </p>
        )}

        <div className="pwd-form__actions">
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={saving || !form.newPwd || !form.confirm}
          >
            {saving ? 'Resetting…' : 'Reset Password'}
          </button>
          {onClose && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

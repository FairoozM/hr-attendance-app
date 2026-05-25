/**
 * LinearSettingsPage.jsx
 * GitHub Integration Settings & Diagnostics page.
 * Route: /#/projects/linear/settings
 *
 * Read-only diagnostics — never exposes token/secret values.
 * Uses GET /api/projects/integrations/github/status (manage permission).
 */
import { useState, useCallback, useEffect } from 'react'
import {
  GitPullRequest, CheckCircle2, AlertTriangle, XCircle,
  Copy, Check, RefreshCw, Settings, Webhook,
  Key, Link2, Code2, Zap,
} from 'lucide-react'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { getGithubIntegrationStatus } from '../../lib/projectsApi'
import './LinearSettingsPage.css'

// ── API base URL helper (frontend) ────────────────────────────────────────────
function getApiBaseUrl() {
  return (
    window.API_RUNTIME_CONFIG?.API_BASE_URL?.trim() ||
    import.meta.env.VITE_API_BASE_URL?.trim() ||
    ''
  )
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ configured, labels = ['Ready', 'Not configured'] }) {
  return configured ? (
    <span className="lsp__chip lsp__chip--ready">
      <CheckCircle2 size={12} aria-hidden="true" />
      {labels[0]}
    </span>
  ) : (
    <span className="lsp__chip lsp__chip--warn">
      <AlertTriangle size={12} aria-hidden="true" />
      {labels[1]}
    </span>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    navigator.clipboard.writeText(text).then(markCopied).catch(() => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
        markCopied()
      } catch { /* not available */ }
    })
  }
  return (
    <button type="button" className="lsp__copy-btn" onClick={handle} title={`Copy ${label}`}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearSettingsPage() {
  const [status,    setStatus]   = useState(null)
  const [loading,   setLoading]  = useState(true)
  const [error,     setError]    = useState('')

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getGithubIntegrationStatus()
      setStatus(data)
    } catch (err) {
      setError(err.message || 'Failed to load GitHub integration status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const webhookUrl = status
    ? `${getApiBaseUrl()}${status.webhookPath || '/api/integrations/github/webhook'}`
    : `${getApiBaseUrl()}/api/integrations/github/webhook`

  const allReady = status?.githubTokenConfigured && status?.githubWebhookSecretConfigured

  function fmtDate(raw) {
    if (!raw) return '—'
    try {
      return new Date(raw).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
    } catch { return raw }
  }

  return (
    <div className="lsp-layout">
      <LinearSidebar />

      <main className="lsp-main">
        <header className="lsp-header">
          <div className="lsp-header__title-row">
            <Settings size={20} aria-hidden="true" className="lsp-header__icon" />
            <h1 className="lsp-header__title">Settings</h1>
          </div>
          <p className="lsp-header__sub">GitHub integration diagnostics for Life Smile workspace</p>
        </header>

        <div className="lsp-content">
          {/* ── Overall status banner ─────────────────────────────────────── */}
          {!loading && !error && status && (
            <div className={`lsp__banner ${allReady ? 'lsp__banner--ready' : 'lsp__banner--warn'}`}>
              {allReady
                ? <><CheckCircle2 size={16} /> GitHub integration is fully configured and ready.</>
                : <><AlertTriangle size={16} /> GitHub integration is partially configured. See details below.</>
              }
              <button
                type="button"
                className="lsp__refresh-btn"
                onClick={fetchStatus}
                disabled={loading}
                title="Refresh status"
              >
                <RefreshCw size={13} className={loading ? 'lsp__spin' : ''} />
                Refresh
              </button>
            </div>
          )}

          {loading && (
            <div className="lsp__loading">
              <RefreshCw size={16} className="lsp__spin" />
              Loading GitHub status…
            </div>
          )}

          {error && (
            <div className="lsp__error-banner">
              <XCircle size={14} />
              {error}
              <button type="button" className="lsp__refresh-btn" onClick={fetchStatus}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && status && (
            <div className="lsp__grid">

              {/* ── Card 1: Manual PR Sync ──────────────────────────────── */}
              <div className="lsp__card">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><Key size={16} /></span>
                  <h2 className="lsp__card-title">Manual PR Sync</h2>
                  <StatusChip configured={status.githubTokenConfigured} />
                </div>
                <p className="lsp__card-body">
                  Allows admins to click <strong>Sync PR</strong> in the Dev tab to fetch
                  PR title, branch, status, and commit from GitHub.
                </p>
                <div className="lsp__card-env">
                  <Code2 size={12} />
                  <code>GITHUB_TOKEN</code>
                  {status.githubTokenConfigured
                    ? <span className="lsp__env-ok">Configured ✓</span>
                    : <span className="lsp__env-missing">Not set in backend .env</span>
                  }
                </div>
                {status.lastManualSyncAt && (
                  <p className="lsp__card-meta">
                    Last sync: {fmtDate(status.lastManualSyncAt)}
                    {status.lastManualSyncRepo && <> · <code>{status.lastManualSyncRepo}</code></>}
                  </p>
                )}
              </div>

              {/* ── Card 2: Webhook Automation ────────────────────────── */}
              <div className="lsp__card">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><Webhook size={16} /></span>
                  <h2 className="lsp__card-title">Webhook Automation</h2>
                  <StatusChip configured={status.githubWebhookSecretConfigured} />
                </div>
                <p className="lsp__card-body">
                  Automatically syncs PR metadata when GitHub fires
                  <strong> pull_request</strong> events — no manual action needed.
                </p>
                <div className="lsp__card-env">
                  <Code2 size={12} />
                  <code>GITHUB_WEBHOOK_SECRET</code>
                  {status.githubWebhookSecretConfigured
                    ? <span className="lsp__env-ok">Configured ✓</span>
                    : <span className="lsp__env-missing">Not set in backend .env</span>
                  }
                </div>
                {status.lastWebhookReceivedAt && (
                  <p className="lsp__card-meta">
                    Last event: {fmtDate(status.lastWebhookReceivedAt)}
                    {status.lastWebhookAction && <> · action: <code>{status.lastWebhookAction}</code></>}
                    {status.lastWebhookRepo   && <> · <code>{status.lastWebhookRepo}</code></>}
                  </p>
                )}
              </div>

              {/* ── Card 3: Webhook URL ───────────────────────────────── */}
              <div className="lsp__card lsp__card--full">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><Link2 size={16} /></span>
                  <h2 className="lsp__card-title">Webhook Endpoint</h2>
                </div>
                <div className="lsp__webhook-url-row">
                  <code className="lsp__webhook-url">{webhookUrl}</code>
                  <CopyBtn text={webhookUrl} label="Copy URL" />
                </div>
                <p className="lsp__card-body lsp__card-body--sm">
                  Use this URL when registering the webhook in your GitHub repository settings.
                  Set content type to <code>application/json</code> and send <strong>Pull requests</strong> events only.
                </p>
              </div>

              {/* ── Card 4: Setup instructions ────────────────────────── */}
              <div className="lsp__card lsp__card--full">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><GitPullRequest size={16} /></span>
                  <h2 className="lsp__card-title">GitHub Setup Instructions</h2>
                </div>
                <ol className="lsp__steps">
                  <li>Open your GitHub repository → <strong>Settings → Webhooks → Add webhook</strong></li>
                  <li>Paste the webhook URL above into <strong>Payload URL</strong></li>
                  <li>Set <strong>Content type</strong> to <code>application/json</code></li>
                  <li>Enter your secret into <strong>Secret</strong> (same value as <code>GITHUB_WEBHOOK_SECRET</code> in backend)</li>
                  <li>Under <strong>Which events</strong>, select <em>Let me select individual events</em> → check <strong>Pull requests</strong> only</li>
                  <li>Click <strong>Add webhook</strong></li>
                  <li>Set <code>GITHUB_TOKEN</code> in backend <code>.env</code> to enable manual PR sync</li>
                </ol>
              </div>

              {/* ── Card 5: Supported issue keys ─────────────────────── */}
              <div className="lsp__card">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><Zap size={16} /></span>
                  <h2 className="lsp__card-title">Issue Key Detection</h2>
                </div>
                <p className="lsp__card-body">
                  GitHub will auto-detect issue keys from PR title, branch name, or description.
                </p>
                <div className="lsp__key-list">
                  {(status.supportedIssueKeys || ['WEB','AND','IOS','API','UX','BI']).map((prefix) => (
                    <span key={prefix} className="lsp__key-pill">{prefix}-N</span>
                  ))}
                </div>
                <p className="lsp__card-meta">
                  Example branch: <code>web-12-fix-login-page</code> or <code>AND-5-payment-flow</code>
                </p>
                <div className="lsp__card-env lsp__card-env--sm">
                  <span className="lsp__regex-label">Pattern:</span>
                  <code className="lsp__regex">\b(WEB|AND|IOS|API|UX|BI)-(\d+)\b</code>
                </div>
              </div>

              {/* ── Card 6: Supported events ─────────────────────────── */}
              <div className="lsp__card">
                <div className="lsp__card-header">
                  <span className="lsp__card-icon"><Webhook size={16} /></span>
                  <h2 className="lsp__card-title">Supported Webhook Actions</h2>
                </div>
                <div className="lsp__event-list">
                  {(status.supportedActions || []).map((a) => (
                    <span key={a} className="lsp__event-pill">{a}</span>
                  ))}
                </div>
                <p className="lsp__card-meta lsp__card-meta--sm">
                  Non-supported events are silently acknowledged (2xx) so GitHub doesn't retry.
                  Issue status changes require a manual <strong>Apply</strong> click — nothing changes automatically.
                </p>
              </div>

            </div>
          )}
        </div>
      </main>
    </div>
  )
}

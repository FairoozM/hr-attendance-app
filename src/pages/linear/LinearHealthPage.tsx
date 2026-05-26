import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  RefreshCcw,
  ServerCrash,
  ShieldAlert,
} from 'lucide-react'
import { CommandMenu } from '../../components/linear/CommandMenu'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { canViewAudit } from '../../lib/linearPermissions'
import { getLinearWorkspaceHealthApi } from '../../lib/linearWorkspaceApi'
import './LinearHealthPage.css'

type HealthStatus = 'ok' | 'warning' | 'error'

type HealthItem = {
  scope?: string
  route?: string
  module?: string
  message?: string
  timestamp?: string | null
  status?: number | string | null
}

type HealthCheck = {
  status?: HealthStatus
  message?: string
  responseTimeMs?: number
  [key: string]: any
}

type HealthResponse = {
  status?: HealthStatus
  checkedAt?: string
  checks?: Record<string, HealthCheck>
  recentErrors?: HealthItem[]
  warnings?: HealthItem[] | string[]
}

const CHECK_ORDER = [
  { key: 'database', label: 'Database' },
  { key: 'issuesApi', label: 'Issues API' },
  { key: 'sharedWorkspaceTables', label: 'Shared Workspace' },
  { key: 'aiConfig', label: 'AI' },
  { key: 'githubConfig', label: 'GitHub' },
  { key: 'searchApi', label: 'Search' },
  { key: 'attachmentStorage', label: 'Attachments' },
  { key: 'auditLog', label: 'Audit Log' },
] as const

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatMs(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return ''
  return `${Math.round(Number(value))} ms`
}

function statusLabel(status?: HealthStatus | null) {
  if (status === 'error') return 'Error'
  if (status === 'warning') return 'Warning'
  return 'OK'
}

function StatusIcon({ status }: { status?: HealthStatus | null }) {
  if (status === 'error') return <ServerCrash size={18} />
  if (status === 'warning') return <AlertTriangle size={18} />
  return <CheckCircle2 size={18} />
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return true
    } catch {
      return false
    }
  }
}

function normalizeWarnings(items: HealthResponse['warnings'], checkedAt?: string) {
  return (Array.isArray(items) ? items : []).map((item) => (
    typeof item === 'string'
      ? { scope: 'warning', message: item, timestamp: checkedAt || null }
      : {
        scope: item.scope || 'warning',
        message: item.message || '',
        timestamp: item.timestamp || checkedAt || null,
      }
  )).filter((item) => item.message)
}

function buildCheckDetails(key: string, check: HealthCheck) {
  if (!check) return []

  if (key === 'issuesApi') {
    return [
      `Issues: ${check.issueCount ?? 0}`,
      check.latestIssueUpdatedAt ? `Latest update: ${formatDateTime(check.latestIssueUpdatedAt)}` : '',
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  if (key === 'sharedWorkspaceTables') {
    const tableEntries = Object.entries(check.tables || {})
    const summary = tableEntries.map(([tableKey, tableValue]: [string, any]) => (
      `${tableKey}: ${tableValue.exists ? `${tableValue.count ?? 0}` : 'missing'}`
    ))
    return [
      `Records tracked: ${check.totalCount ?? 0}`,
      ...summary.slice(0, 6),
    ].filter(Boolean)
  }

  if (key === 'aiConfig') {
    return [
      `OpenAI configured: ${check.openaiConfigured ? 'Yes' : 'No'}`,
      `AI enabled: ${check.aiEnabled === null ? 'Unknown' : (check.aiEnabled ? 'Yes' : 'No')}`,
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  if (key === 'githubConfig') {
    return [
      `Token configured: ${check.tokenConfigured ? 'Yes' : 'No'}`,
      `Webhook secret: ${check.webhookSecretConfigured ? 'Yes' : 'No'}`,
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  if (key === 'attachmentStorage') {
    return [
      `Bucket configured: ${check.bucketConfigured ? 'Yes' : 'No'}`,
      `Region configured: ${check.regionConfigured ? 'Yes' : 'No'}`,
      check.checked ? `Check mode: ${String(check.checked).replace(/_/g, ' ')}` : '',
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  if (key === 'auditLog') {
    return [
      `Rows: ${check.count ?? 0}`,
      check.latestAt ? `Latest event: ${formatDateTime(check.latestAt)}` : '',
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  if (key === 'searchApi') {
    return [
      `Min query guard: ${check.minQueryGuardWorks ? 'Yes' : 'No'}`,
      `Probe results: ${check.sampleResultCount ?? 0}`,
      check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
    ].filter(Boolean)
  }

  return [
    check.responseTimeMs != null ? `Response: ${formatMs(check.responseTimeMs)}` : '',
  ].filter(Boolean)
}

function buildHealthSummary(data: HealthResponse | null) {
  if (!data) return 'Workspace health summary unavailable.'

  const checks = data.checks || {}
  const failingChecks = CHECK_ORDER
    .map(({ key, label }) => ({ key, label, check: checks[key] }))
    .filter(({ check }) => check?.status && check.status !== 'ok')
    .map(({ label, check }) => `- ${label}: ${statusLabel(check?.status)}${check?.message ? ` - ${check.message}` : ''}`)

  const warnings = normalizeWarnings(data.warnings, data.checkedAt)
  const issues = checks.issuesApi || {}
  const audit = checks.auditLog || {}
  const ai = checks.aiConfig || {}
  const github = checks.githubConfig || {}
  const attachments = checks.attachmentStorage || {}

  return [
    `Workspace Health: ${statusLabel(data.status)}`,
    `Checked At: ${formatDateTime(data.checkedAt)}`,
    '',
    'Failing Checks:',
    ...(failingChecks.length ? failingChecks : ['- None']),
    '',
    'Warnings:',
    ...(warnings.length ? warnings.map((item) => `- ${item.scope}: ${item.message}`) : ['- None']),
    '',
    'Counts:',
    `- Issues: ${issues.issueCount ?? 0}`,
    `- Audit rows: ${audit.count ?? 0}`,
    '',
    'Config Readiness:',
    `- OpenAI configured: ${ai.openaiConfigured ? 'Yes' : 'No'}`,
    `- AI enabled: ${ai.aiEnabled === null ? 'Unknown' : (ai.aiEnabled ? 'Yes' : 'No')}`,
    `- GitHub token configured: ${github.tokenConfigured ? 'Yes' : 'No'}`,
    `- GitHub webhook secret configured: ${github.webhookSecretConfigured ? 'Yes' : 'No'}`,
    `- Attachment storage bucket configured: ${attachments.bucketConfigured ? 'Yes' : 'No'}`,
  ].join('\n')
}

function HealthCheckCard({ label, checkKey, check }: { label: string, checkKey: string, check: HealthCheck }) {
  const detailLines = buildCheckDetails(checkKey, check)
  return (
    <article className={`lhealth-card lhealth-card--${check?.status || 'ok'}`}>
      <div className="lhealth-card__header">
        <div className={`lhealth-status-chip lhealth-status-chip--${check?.status || 'ok'}`}>
          <StatusIcon status={check?.status} />
          <span>{statusLabel(check?.status)}</span>
        </div>
        <div className="lhealth-card__title-wrap">
          <h3>{label}</h3>
          <p>{check?.message || 'No details available.'}</p>
        </div>
      </div>

      {detailLines.length > 0 && (
        <ul className="lhealth-card__details">
          {detailLines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </article>
  )
}

export default function LinearHealthPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const canOpenHealth = canViewAudit(user)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)
  const actionHandledRef = useRef('')

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await getLinearWorkspaceHealthApi()
      setHealth(response || null)
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load workspace health.')
    } finally {
      setLoading(false)
    }
  }, [])

  const summaryText = useMemo(() => buildHealthSummary(health), [health])
  const warnings = useMemo(() => normalizeWarnings(health?.warnings, health?.checkedAt), [health])
  const recentErrors = useMemo(() => Array.isArray(health?.recentErrors) ? health!.recentErrors! : [], [health])

  const copySummary = useCallback(async () => {
    const ok = await copyText(summaryText)
    setFeedback(ok ? 'Health summary copied.' : 'Copy failed.')
  }, [summaryText])

  useEffect(() => {
    if (!canOpenHealth) return
    loadHealth()
  }, [canOpenHealth, loadHealth])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setCmdMenuOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!health || loading) return
    const params = new URLSearchParams(location.search)
    if (params.get('action') !== 'copy-summary') return
    if (actionHandledRef.current === location.search) return
    actionHandledRef.current = location.search

    void (async () => {
      await copySummary()
      params.delete('action')
      const nextSearch = params.toString()
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
    })()
  }, [copySummary, health, loading, location.pathname, location.search, navigate])

  if (!canOpenHealth) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to access workspace health diagnostics."
      />
    )
  }

  return (
    <div className="lhealth-shell">
      <LinearSidebar />

      <main className="lhealth-page">
        <header className="lhealth-header">
          <div>
            <h1>Workspace Health</h1>
            <p>Internal status for product workspace services and integrations.</p>
          </div>

          <div className="lhealth-header__actions">
            <button type="button" className="lhealth-btn" onClick={copySummary} disabled={!health}>
              <Copy size={14} />
              Copy Health Summary
            </button>
            <button type="button" className="lhealth-btn lhealth-btn--primary" onClick={loadHealth} disabled={loading}>
              {loading ? <Loader2 size={14} className="lhealth-spin" /> : <RefreshCcw size={14} />}
              Refresh
            </button>
          </div>
        </header>

        {feedback && <div className="lhealth-banner">{feedback}</div>}
        {error && <div className="lhealth-banner lhealth-banner--error">{error}</div>}

        <section className={`lhealth-overview lhealth-overview--${health?.status || 'ok'}`}>
          <div className="lhealth-overview__status">
            <div className={`lhealth-status-chip lhealth-status-chip--${health?.status || 'ok'}`}>
              <StatusIcon status={health?.status} />
              <span>{statusLabel(health?.status)}</span>
            </div>
            <div>
              <h2>Overall Status</h2>
              <p>{health?.checkedAt ? `Last checked ${formatDateTime(health.checkedAt)}` : 'Waiting for first check.'}</p>
            </div>
          </div>

          <div className="lhealth-overview__meta">
            <div>
              <Clock3 size={15} />
              <span>{loading ? 'Refreshing checks...' : 'Health checks are read-only and safe to rerun.'}</span>
            </div>
            <div>
              <ShieldAlert size={15} />
              <span>{recentErrors.length} recent workspace errors captured</span>
            </div>
          </div>
        </section>

        <section className="lhealth-grid">
          {CHECK_ORDER.map(({ key, label }) => (
            <HealthCheckCard
              key={key}
              label={label}
              checkKey={key}
              check={(health?.checks || {})[key] || {}}
            />
          ))}
        </section>

        <section className="lhealth-section">
          <div className="lhealth-section__header">
            <div>
              <h2>Recent Warnings & Errors</h2>
              <p>Recent workspace failures plus current setup warnings.</p>
            </div>
          </div>

          <div className="lhealth-feed">
            {recentErrors.map((item, index) => (
              <article key={`${item.timestamp || 'error'}-${item.route || index}`} className="lhealth-feed__item lhealth-feed__item--error">
                <div className="lhealth-feed__title">Error</div>
                <div className="lhealth-feed__meta">
                  <span>{item.route || item.module || 'workspace'}</span>
                  <span>{formatDateTime(item.timestamp)}</span>
                </div>
                <p>{item.message || 'Unexpected workspace error.'}</p>
                {item.status ? <div className="lhealth-feed__tag">HTTP {item.status}</div> : null}
              </article>
            ))}

            {warnings.map((item, index) => (
              <article key={`${item.scope || 'warning'}-${index}`} className="lhealth-feed__item lhealth-feed__item--warning">
                <div className="lhealth-feed__title">Warning</div>
                <div className="lhealth-feed__meta">
                  <span>{item.scope || 'setup'}</span>
                  <span>{formatDateTime(item.timestamp)}</span>
                </div>
                <p>{item.message}</p>
              </article>
            ))}

            {recentErrors.length === 0 && warnings.length === 0 && (
              <div className="lhealth-empty">No recent warnings or errors were reported.</div>
            )}
          </div>
        </section>

        <section className="lhealth-section">
          <div className="lhealth-section__header">
            <div>
              <h2>Setup Reminders</h2>
              <p>Non-blocking configuration reminders for workspace admins.</p>
            </div>
          </div>

          <div className="lhealth-reminders">
            {warnings.length === 0 && <div className="lhealth-empty">No setup reminders right now.</div>}
            {warnings.map((item, index) => (
              <div key={`${item.scope || 'reminder'}-${index}`} className="lhealth-reminder">
                <AlertTriangle size={16} />
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <CommandMenu open={cmdMenuOpen} onClose={() => setCmdMenuOpen(false)} />
    </div>
  )
}

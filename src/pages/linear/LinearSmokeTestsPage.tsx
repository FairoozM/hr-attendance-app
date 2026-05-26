import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCcw,
  ServerCrash,
  TriangleAlert,
} from 'lucide-react'
import { CommandMenu } from '../../components/linear/CommandMenu'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { canViewAudit } from '../../lib/linearPermissions'
import {
  getLinearWorkspaceSmokeTestsApi,
  runLinearWorkspaceSmokeTestsApi,
} from '../../lib/linearWorkspaceApi'
import './LinearSmokeTestsPage.css'

type SmokeTestDefinition = {
  id: string
  name: string
  category: string
  description: string
  destructive: boolean
}

type SmokeStatus = 'passed' | 'warning' | 'failed' | 'skipped'

type SmokeDetailCheck = {
  label?: string
  status?: SmokeStatus
  message?: string
  details?: unknown
}

type SmokeTestResult = {
  id: string
  name: string
  status: SmokeStatus
  durationMs: number
  message: string
  details?: {
    checks?: SmokeDetailCheck[]
    routes?: string[]
    [key: string]: unknown
  } | null
}

type SmokeRunResult = {
  runId: string
  startedAt: string
  finishedAt: string
  status: 'passed' | 'warning' | 'failed'
  mode?: string
  results: SmokeTestResult[]
}

const MANUAL_ROUTE_CHECKLIST = [
  '/#/projects/linear',
  '/#/projects/linear/dashboard',
  '/#/projects/linear/projects',
  '/#/projects/linear/team',
  '/#/projects/linear/roadmap',
  '/#/projects/linear/workload',
  '/#/projects/linear/inbox',
  '/#/projects/linear/releases',
  '/#/projects/linear/intake',
  '/#/projects/linear/docs',
  '/#/projects/linear/search',
  '/#/projects/linear/notifications',
  '/#/projects/linear/settings',
  '/#/projects/linear/health',
] as const

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatMs(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '0 ms'
  return `${Math.round(Number(value))} ms`
}

function runDuration(run: SmokeRunResult | null) {
  if (!run?.startedAt || !run?.finishedAt) return '0 ms'
  const started = new Date(run.startedAt).getTime()
  const finished = new Date(run.finishedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return '0 ms'
  return formatMs(Math.max(finished - started, 0))
}

function statusLabel(status?: SmokeStatus | 'passed' | 'warning' | 'failed' | null) {
  if (status === 'failed') return 'Failed'
  if (status === 'warning') return 'Warning'
  if (status === 'skipped') return 'Skipped'
  return 'Passed'
}

function StatusIcon({ status }: { status?: SmokeStatus | 'passed' | 'warning' | 'failed' | null }) {
  if (status === 'failed') return <ServerCrash size={16} />
  if (status === 'warning' || status === 'skipped') return <TriangleAlert size={16} />
  return <CheckCircle2 size={16} />
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

function toAbsoluteHashUrl(url: string) {
  if (!url) return window.location.href
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('#')) return `${window.location.origin}${window.location.pathname}${url}`
  return `${window.location.origin}${url}`
}

function buildSmokeTestReport(run: SmokeRunResult | null) {
  if (!run) return 'Smoke test report unavailable.'

  const passed = run.results.filter((item) => item.status === 'passed').length
  const warning = run.results.filter((item) => item.status === 'warning' || item.status === 'skipped').length
  const failed = run.results.filter((item) => item.status === 'failed').length
  const failures = run.results.filter((item) => item.status === 'failed')
  const warnings = run.results.filter((item) => item.status === 'warning' || item.status === 'skipped')

  const readinessNote = run.status === 'passed'
    ? 'Deployment readiness looks good. Manual route checklist is still recommended.'
    : run.status === 'warning'
      ? 'Review warnings before confirming deployment readiness. Manual route checklist is recommended.'
      : 'Deployment is not ready until smoke test failures are resolved.'

  return [
    `Smoke Test Run: ${formatDateTime(run.startedAt)}`,
    `Overall Status: ${statusLabel(run.status)}`,
    `Run Duration: ${runDuration(run)}`,
    `Passed: ${passed}`,
    `Warnings: ${warning}`,
    `Failed: ${failed}`,
    '',
    'Failed Checks:',
    ...(failures.length
      ? failures.map((item) => `- ${item.name}: ${item.message}`)
      : ['- None']),
    '',
    'Warnings:',
    ...(warnings.length
      ? warnings.map((item) => `- ${item.name}: ${item.message}`)
      : ['- None']),
    '',
    `Deployment Readiness Note: ${readinessNote}`,
  ].join('\n')
}

function SmokeDetails({ details }: { details: SmokeTestResult['details'] }) {
  const checks = Array.isArray(details?.checks) ? details.checks : []
  const routes = Array.isArray(details?.routes) ? details.routes : []

  return (
    <div className="lsmoke-detail">
      {checks.length > 0 && (
        <div className="lsmoke-detail__checks">
          {checks.map((check, index) => (
            <div key={`${check.label || 'check'}-${index}`} className="lsmoke-detail__check">
              <div className={`lsmoke-status-chip lsmoke-status-chip--${check.status || 'passed'}`}>
                <StatusIcon status={check.status} />
                <span>{statusLabel(check.status)}</span>
              </div>
              <div className="lsmoke-detail__copy">
                <strong>{check.label || 'Check'}</strong>
                <p>{check.message || 'No message provided.'}</p>
                {check.details != null && (
                  <pre>{JSON.stringify(check.details, null, 2)}</pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {routes.length > 0 && (
        <div className="lsmoke-detail__routes">
          <strong>Manual routes</strong>
          <ul>
            {routes.map((route) => <li key={route}>{route}</li>)}
          </ul>
        </div>
      )}

      {checks.length === 0 && routes.length === 0 && details != null && (
        <pre>{JSON.stringify(details, null, 2)}</pre>
      )}
    </div>
  )
}

export default function LinearSmokeTestsPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const canOpenSmokeTests = canViewAudit(user)
  const [availableTests, setAvailableTests] = useState<SmokeTestDefinition[]>([])
  const [selectedTests, setSelectedTests] = useState<string[]>([])
  const [latestRun, setLatestRun] = useState<SmokeRunResult | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)
  const actionHandledRef = useRef('')
  const feedbackTimerRef = useRef<number | null>(null)

  const loadAvailableTests = useCallback(async () => {
    setLoadingList(true)
    setError('')
    try {
      const response = await getLinearWorkspaceSmokeTestsApi()
      const items = Array.isArray(response) ? response as SmokeTestDefinition[] : []
      setAvailableTests(items)
      setSelectedTests((current) => (current.length ? current : items.map((item) => item.id)))
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load smoke tests.')
    } finally {
      setLoadingList(false)
    }
  }, [])

  const flashMessage = useCallback((text: string) => {
    setFeedback(text)
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 2400)
  }, [])

  const runSelectedTests = useCallback(async (testIds: string[] = selectedTests) => {
    const ids = testIds.length ? testIds : availableTests.map((item) => item.id)
    if (ids.length === 0) {
      flashMessage('Select at least one smoke test.')
      return null
    }

    setRunning(true)
    setError('')
    try {
      const result = await runLinearWorkspaceSmokeTestsApi({
        tests: ids,
        mode: 'read_only',
      })
      setLatestRun(result as SmokeRunResult)
      setExpandedIds([])
      flashMessage('Smoke tests finished.')
      return result as SmokeRunResult
    } catch (runError: any) {
      setError(runError?.message || 'Failed to run smoke tests.')
      return null
    } finally {
      setRunning(false)
    }
  }, [availableTests, flashMessage, selectedTests])

  const copyReport = useCallback(async () => {
    if (!latestRun) {
      flashMessage('Run smoke tests first.')
      return
    }
    const ok = await copyText(buildSmokeTestReport(latestRun))
    flashMessage(ok ? 'Smoke test report copied.' : 'Copy failed.')
  }, [flashMessage, latestRun])

  const toggleTest = useCallback((id: string) => {
    setSelectedTests((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ))
  }, [])

  const selectAll = useCallback(() => {
    setSelectedTests(availableTests.map((item) => item.id))
  }, [availableTests])

  const clearSelection = useCallback(() => {
    setSelectedTests([])
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ))
  }, [])

  useEffect(() => {
    if (!canOpenSmokeTests) return
    loadAvailableTests()
  }, [canOpenSmokeTests, loadAvailableTests])

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
  }, [])

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
    if (loadingList || running || availableTests.length === 0) return
    const params = new URLSearchParams(location.search)
    const action = params.get('action')
    if (!action) return
    if (actionHandledRef.current === location.search) return
    actionHandledRef.current = location.search

    void (async () => {
      if (action === 'run-all') {
        const ids = availableTests.map((item) => item.id)
        setSelectedTests(ids)
        await runSelectedTests(ids)
      } else if (action === 'copy-report') {
        await copyReport()
      }

      params.delete('action')
      const nextSearch = params.toString()
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
    })()
  }, [availableTests, copyReport, loadingList, location.pathname, location.search, navigate, runSelectedTests, running])

  const summary = useMemo(() => {
    const results = latestRun?.results || []
    return {
      passed: results.filter((item) => item.status === 'passed').length,
      warning: results.filter((item) => item.status === 'warning' || item.status === 'skipped').length,
      failed: results.filter((item) => item.status === 'failed').length,
    }
  }, [latestRun])

  if (!canOpenSmokeTests) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to access workspace smoke tests."
      />
    )
  }

  return (
    <div className="lsmoke-shell">
      <LinearSidebar />

      <main className="lsmoke-page">
        <header className="lsmoke-header">
          <div>
            <h1>Smoke Tests</h1>
            <p>Run safe read-only checks after deployments.</p>
          </div>

          <div className="lsmoke-header__actions">
            <button type="button" className="lsmoke-btn" onClick={copyReport} disabled={!latestRun}>
              <Copy size={14} />
              Copy Smoke Test Report
            </button>
            <button type="button" className="lsmoke-btn" onClick={loadAvailableTests} disabled={loadingList || running}>
              {loadingList ? <Loader2 size={14} className="lsmoke-spin" /> : <RefreshCcw size={14} />}
              Refresh
            </button>
            <button type="button" className="lsmoke-btn lsmoke-btn--primary" onClick={() => void runSelectedTests()} disabled={running || loadingList}>
              {running ? <Loader2 size={14} className="lsmoke-spin" /> : <Play size={14} />}
              Run Smoke Tests
            </button>
          </div>
        </header>

        {feedback && <div className="lsmoke-banner">{feedback}</div>}
        {error && <div className="lsmoke-banner lsmoke-banner--error">{error}</div>}

        <section className="lsmoke-section">
          <div className="lsmoke-section__header">
            <div>
              <h2>Test Selector</h2>
              <p>Select the read-only smoke checks you want to run.</p>
            </div>

            <div className="lsmoke-selector__actions">
              <button type="button" className="lsmoke-btn" onClick={selectAll} disabled={loadingList || availableTests.length === 0}>
                Select all
              </button>
              <button type="button" className="lsmoke-btn" onClick={clearSelection} disabled={loadingList || selectedTests.length === 0}>
                Clear
              </button>
            </div>
          </div>

          <div className="lsmoke-selector">
            {availableTests.map((test) => (
              <label key={test.id} className={`lsmoke-test-card ${selectedTests.includes(test.id) ? 'lsmoke-test-card--selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedTests.includes(test.id)}
                  onChange={() => toggleTest(test.id)}
                />
                <div>
                  <div className="lsmoke-test-card__title">
                    <strong>{test.name}</strong>
                    <span>{test.category}</span>
                  </div>
                  <p>{test.description}</p>
                  <div className="lsmoke-test-card__meta">
                    {test.destructive ? 'Destructive' : 'Read-only'}
                  </div>
                </div>
              </label>
            ))}

            {!loadingList && availableTests.length === 0 && (
              <div className="lsmoke-empty">No smoke tests are currently available.</div>
            )}
          </div>
        </section>

        <section className={`lsmoke-overview lsmoke-overview--${latestRun?.status || 'passed'}`}>
          <div className="lsmoke-overview__status">
            <div className={`lsmoke-status-chip lsmoke-status-chip--${latestRun?.status || 'passed'}`}>
              <StatusIcon status={latestRun?.status} />
              <span>{statusLabel(latestRun?.status)}</span>
            </div>
            <div>
              <h2>Latest Run</h2>
              <p>{latestRun ? `Started ${formatDateTime(latestRun.startedAt)}` : 'Run smoke tests to generate a report.'}</p>
            </div>
          </div>

          <div className="lsmoke-overview__stats">
            <div><strong>{runDuration(latestRun)}</strong><span>Run duration</span></div>
            <div><strong>{summary.passed}</strong><span>Passed</span></div>
            <div><strong>{summary.warning}</strong><span>Warning</span></div>
            <div><strong>{summary.failed}</strong><span>Failed</span></div>
          </div>
        </section>

        <section className="lsmoke-section">
          <div className="lsmoke-section__header">
            <div>
              <h2>Results</h2>
              <p>Each selected smoke test reports its own status, duration, and expandable details.</p>
            </div>
          </div>

          <div className="lsmoke-results">
            {!latestRun && <div className="lsmoke-empty">No smoke test run yet.</div>}

            {latestRun?.results.map((result) => {
              const expanded = expandedIds.includes(result.id)
              return (
                <article key={`${latestRun.runId}-${result.id}`} className={`lsmoke-result lsmoke-result--${result.status}`}>
                  <div className="lsmoke-result__summary">
                    <div className="lsmoke-result__main">
                      <div className={`lsmoke-status-chip lsmoke-status-chip--${result.status}`}>
                        <StatusIcon status={result.status} />
                        <span>{statusLabel(result.status)}</span>
                      </div>
                      <div>
                        <h3>{result.name}</h3>
                        <p>{result.message}</p>
                      </div>
                    </div>

                    <div className="lsmoke-result__actions">
                      <span>{formatMs(result.durationMs)}</span>
                      <button type="button" className="lsmoke-icon-btn" onClick={() => toggleExpanded(result.id)}>
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {expanded ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {expanded && <SmokeDetails details={result.details || null} />}
                </article>
              )
            })}
          </div>
        </section>

        <section className="lsmoke-section">
          <div className="lsmoke-section__header">
            <div>
              <h2>Route Checklist</h2>
              <p>Manual browser route checklist. This is not automated browser testing.</p>
            </div>
          </div>

          <div className="lsmoke-routes">
            {MANUAL_ROUTE_CHECKLIST.map((route) => (
              <div key={route} className="lsmoke-route-row">
                <code>{route}</code>
                <button
                  type="button"
                  className="lsmoke-btn"
                  onClick={() => window.open(toAbsoluteHashUrl(route.replace('/#', '#')), '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={14} />
                  Open
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      <CommandMenu open={cmdMenuOpen} onClose={() => setCmdMenuOpen(false)} />
    </div>
  )
}

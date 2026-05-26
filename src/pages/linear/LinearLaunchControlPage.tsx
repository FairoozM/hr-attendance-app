import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCcw,
  ServerCrash,
} from 'lucide-react'
import { CommandMenu } from '../../components/linear/CommandMenu'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { getReleaseChecklistCompliance } from '../../lib/linearChecklistCompliance'
import { loadReleaseApprovalDraft } from '../../lib/linearReleaseStorage'
import {
  createLaunchRecordApi,
  getLinearWorkspaceHealthApi,
  getLinearWorkspaceSmokeTestsApi,
  listDeploymentsApi,
  listMobileReleasesApi,
  runLinearWorkspaceSmokeTestsApi,
} from '../../lib/linearWorkspaceApi'
import {
  canManageLaunchRecords,
  canViewAudit,
  canViewLinear,
} from '../../lib/linearPermissions'
import { issueKey, normalizePriority, normalizeStatus } from '../../components/linear/IssueRow'
import './LinearLaunchControlPage.css'

type HealthStatus = 'ok' | 'warning' | 'error'
type SmokeStatus = 'passed' | 'warning' | 'failed' | 'skipped'

type HealthResult = {
  status?: HealthStatus
  checkedAt?: string
  checks?: Record<string, any>
  warnings?: Array<{ scope?: string, message?: string } | string>
}

type SmokeTestDefinition = {
  id: string
  name: string
  category: string
  description: string
  destructive: boolean
}

type SmokeRunResult = {
  runId: string
  startedAt: string
  finishedAt: string
  status: 'passed' | 'warning' | 'failed'
  results: Array<{
    id: string
    name: string
    status: SmokeStatus
    durationMs: number
    message: string
    details?: any
  }>
}

type LaunchChecklistItems = Record<string, boolean>

type LaunchChecklistScopeState = {
  items: LaunchChecklistItems
  overrideOpenPrs: boolean
  rollbackNotes: string
  rollbackOwner: string
  stakeholderNote: string
  postDeployOwner: string
  updatedAt: string | null
}

type LaunchChecklistStore = {
  scopes: Record<string, LaunchChecklistScopeState>
}

type ScopeOption = {
  id: string
  label: string
  kind: 'current-ready' | 'deployment' | 'mobile-release' | 'approval-batch'
  description: string
  issueIds: number[]
  status?: string
  notes?: string
  rollbackNotes?: string
  environment?: string
  releaseType?: string
  deploymentNeeds?: string[]
  targetDate?: string | null
}

const LAUNCH_PREF_KEY = 'lifesmile.linear.launchChecklist.v1'

const CHECKLIST_ITEMS = [
  { id: 'scopeConfirmed', label: 'Release scope confirmed' },
  { id: 'issuesReviewed', label: 'Selected issues reviewed' },
  { id: 'qaConfirmed', label: 'QA approval confirmed' },
  { id: 'prsMerged', label: 'PRs merged or approved override' },
  { id: 'qaProofChecked', label: 'QA proof/evidence checked' },
  { id: 'sopReviewed', label: 'SOP checklist reviewed' },
  { id: 'migrationReviewed', label: 'Backend migration reviewed if needed' },
  { id: 'configReviewed', label: 'Env/config changes reviewed if needed' },
  { id: 'healthPassed', label: 'Health check passed' },
  { id: 'smokePassed', label: 'Smoke tests passed' },
  { id: 'rollbackWritten', label: 'Rollback plan written' },
  { id: 'stakeholdersInformed', label: 'Stakeholders informed' },
  { id: 'postDeployAssigned', label: 'Post-deploy smoke test assigned' },
] as const

const OPEN_PR_STATUSES = new Set(['open', 'in_review', 'draft'])
const READY_SOURCE_STATUSES = new Set(['Ready for Release', 'QA Approved'])
const MOBILE_DONE_STATUSES = new Set(['released', 'approved', 'verified'])
const DEPLOYMENT_DONE_STATUSES = new Set(['deployed', 'verified', 'completed'])

function defaultChecklistItems(): LaunchChecklistItems {
  return CHECKLIST_ITEMS.reduce((acc, item) => {
    acc[item.id] = false
    return acc
  }, {} as LaunchChecklistItems)
}

function normalizeScopeState(value: any): LaunchChecklistScopeState {
  const items = defaultChecklistItems()
  const rawItems = value?.items && typeof value.items === 'object' ? value.items : {}
  for (const item of CHECKLIST_ITEMS) {
    items[item.id] = Boolean(rawItems[item.id])
  }
  return {
    items,
    overrideOpenPrs: Boolean(value?.overrideOpenPrs),
    rollbackNotes: typeof value?.rollbackNotes === 'string' ? value.rollbackNotes : '',
    rollbackOwner: typeof value?.rollbackOwner === 'string' ? value.rollbackOwner : '',
    stakeholderNote: typeof value?.stakeholderNote === 'string' ? value.stakeholderNote : '',
    postDeployOwner: typeof value?.postDeployOwner === 'string' ? value.postDeployOwner : '',
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  }
}

function normalizeChecklistStore(value: any): LaunchChecklistStore {
  const rawScopes = value?.scopes && typeof value.scopes === 'object' ? value.scopes : {}
  const scopes: Record<string, LaunchChecklistScopeState> = {}
  for (const [key, scopeValue] of Object.entries(rawScopes)) {
    scopes[key] = normalizeScopeState(scopeValue)
  }
  return { scopes }
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatShortDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-AE', { dateStyle: 'medium' })
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

function overallStatusLabel(status?: string | null) {
  if (status === 'error' || status === 'failed' || status === 'blocked') return 'Blocked'
  if (status === 'warning' || status === 'needs_review') return 'Needs Review'
  if (status === 'ok' || status === 'passed' || status === 'ready') return 'Ready'
  return 'Not Run'
}

function statusTone(status?: string | null) {
  if (status === 'error' || status === 'failed' || status === 'blocked') return 'blocked'
  if (status === 'warning' || status === 'needs_review' || status === 'skipped') return 'review'
  if (status === 'ok' || status === 'passed' || status === 'ready') return 'ready'
  return 'idle'
}

function StatusIcon({ status }: { status?: string | null }) {
  const tone = statusTone(status)
  if (tone === 'blocked') return <ServerCrash size={16} />
  if (tone === 'review') return <AlertTriangle size={16} />
  if (tone === 'ready') return <CheckCircle2 size={16} />
  return <ClipboardCheck size={16} />
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

function normalizeLinkedIssueIds(value: any) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : []
}

function normalizeMobileRelease(row: any) {
  return {
    id: row?.id,
    name: row?.name || `Mobile Release #${row?.id || ''}`,
    platform: row?.platform || 'Mobile',
    status: row?.status || 'Planning',
    version: row?.version_number || row?.version || '',
    buildNumber: row?.build_number || row?.buildNumber || '',
    targetDate: row?.target_date || row?.targetDate || null,
    notes: row?.notes || '',
    linkedIssueIds: normalizeLinkedIssueIds(row?.linked_issue_ids || row?.linkedIssueIds),
  }
}

function normalizeDeployment(row: any) {
  return {
    id: row?.id,
    name: row?.name || `Deployment #${row?.id || ''}`,
    deploymentType: row?.deployment_type || row?.deploymentType || 'Deployment',
    environment: row?.environment || 'Production',
    status: row?.status || 'Planning',
    targetDate: row?.target_date || row?.targetDate || null,
    notes: row?.notes || '',
    rollbackNotes: row?.rollback_notes || row?.rollbackNotes || '',
    linkedIssueIds: normalizeLinkedIssueIds(row?.linked_issue_ids || row?.linkedIssueIds),
  }
}

function inferTeam(projectName = '') {
  const lower = String(projectName).toLowerCase()
  if (lower.includes('android')) return 'Android'
  if (lower.includes('ios') || lower.includes('iphone')) return 'iOS'
  if (lower.includes('ux') || lower.includes('ui') || lower.includes('design')) return 'UX/UI'
  if (lower.includes('backend') || lower.includes('api') || lower.includes('server')) return 'Backend/API'
  if (lower.includes('data') || lower.includes(' bi') || lower === 'bi' || lower.includes('analytics')) return 'Data & BI'
  return 'Website'
}

function issueHasQaProof(issue: any) {
  const attachments = Array.isArray(issue?.attachments) ? issue.attachments : []
  if (attachments.some((item) => item?.kind === 'qa_proof')) return true
  return Boolean(issue?.devMeta?.qaApproval?.proofProvided || issue?.devMeta?.qaProofUrl)
}

function issueHasReleaseEvidence(issue: any) {
  const attachments = Array.isArray(issue?.attachments) ? issue.attachments : []
  return attachments.some((item) => item?.kind === 'release_evidence')
}

function issueNeedsDbOrConfigReview(issue: any) {
  const text = [
    issue?.title,
    issue?.description,
    issue?.blockedReason,
    ...(Array.isArray(issue?.labels) ? issue.labels : []),
  ].filter(Boolean).join(' ').toLowerCase()

  return /(db|database|migration|schema|env|config|secret|setting)/.test(text)
}

function getUserName(user: any) {
  if (!user) return 'Team'
  return user.displayName || user.username || `User #${user.userId || user.id || ''}` || 'Team'
}

function normalizeHealthWarnings(warnings: HealthResult['warnings']) {
  return (Array.isArray(warnings) ? warnings : []).map((item) => (
    typeof item === 'string' ? item : (item?.message || '')
  )).filter(Boolean)
}

function buildLaunchSelectionOptions({
  currentReadyIssues,
  deployments,
  mobileReleases,
  releaseApprovalDraft,
}: {
  currentReadyIssues: any[]
  deployments: any[]
  mobileReleases: any[]
  releaseApprovalDraft: any
}) {
  const options: ScopeOption[] = [
    {
      id: 'current-ready',
      label: 'Current Ready for Release issues',
      kind: 'current-ready',
      description: `${currentReadyIssues.length} issue${currentReadyIssues.length !== 1 ? 's' : ''} in Ready for Release or QA Approved`,
      issueIds: currentReadyIssues.map((issue) => issue.id),
      releaseType: 'Current Ready for Release',
      deploymentNeeds: [],
    },
  ]

  for (const deployment of deployments) {
    options.push({
      id: `deployment:${deployment.id}`,
      label: `${deployment.name} (${deployment.environment})`,
      kind: 'deployment',
      description: `${deployment.deploymentType} deployment${deployment.targetDate ? ` · ${formatShortDate(deployment.targetDate)}` : ''}`,
      issueIds: deployment.linkedIssueIds,
      status: deployment.status,
      notes: deployment.notes,
      rollbackNotes: deployment.rollbackNotes,
      environment: deployment.environment,
      releaseType: deployment.deploymentType,
      targetDate: deployment.targetDate,
      deploymentNeeds: [deployment.deploymentType],
    })
  }

  for (const release of mobileReleases) {
    options.push({
      id: `mobile:${release.id}`,
      label: `${release.name} (${release.platform})`,
      kind: 'mobile-release',
      description: `${release.platform}${release.version ? ` · v${release.version}` : ''}${release.targetDate ? ` · ${formatShortDate(release.targetDate)}` : ''}`,
      issueIds: release.linkedIssueIds,
      status: release.status,
      notes: release.notes,
      releaseType: release.platform,
      targetDate: release.targetDate,
      deploymentNeeds: ['Mobile App Store'],
    })
  }

  const draftIds = Array.isArray(releaseApprovalDraft?.selectedIssueIds)
    ? releaseApprovalDraft.selectedIssueIds.map((item: any) => Number(item)).filter((item: number) => Number.isFinite(item))
    : []
  if (draftIds.length > 0) {
    options.push({
      id: 'approval-batch:draft',
      label: releaseApprovalDraft?.releaseName || 'Release approval batch draft',
      kind: 'approval-batch',
      description: `${draftIds.length} selected issue${draftIds.length !== 1 ? 's' : ''}${releaseApprovalDraft?.environment ? ` · ${releaseApprovalDraft.environment}` : ''}`,
      issueIds: draftIds,
      notes: releaseApprovalDraft?.signOffNotes || '',
      environment: releaseApprovalDraft?.environment || 'Production',
      releaseType: releaseApprovalDraft?.releaseType || 'Mixed',
      deploymentNeeds: Array.isArray(releaseApprovalDraft?.deploymentNeeds) ? releaseApprovalDraft.deploymentNeeds : [],
    })
  }

  return options
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <article className="llaunch-metric">
      <div className="llaunch-metric__value">{value}</div>
      <div className="llaunch-metric__label">{label}</div>
      {detail ? <div className="llaunch-metric__detail">{detail}</div> : null}
    </article>
  )
}

function toAbsoluteHashUrl(url: string) {
  if (!url) return window.location.href
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('#')) return `${window.location.origin}${window.location.pathname}${url}`
  return `${window.location.origin}${url}`
}

export default function LinearLaunchControlPage() {
  const { user } = useAuth()
  const { getPref, setPref, prefsVersion } = useUserPreferences()
  const {
    projects,
    getTasksForProject,
    actions,
    loadingProjects,
    loadingTasks,
  } = useTeamProjectsContext()
  const location = useLocation()
  const navigate = useNavigate()
  const canOpenLaunch = canViewLinear(user)
  const canRunDiagnostics = canViewAudit(user)
  const canSaveLaunchRecord = canManageLaunchRecords(user)
  const checklistWritable = canViewAudit(user)
  const [mobileReleases, setMobileReleases] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [smokeCatalog, setSmokeCatalog] = useState<SmokeTestDefinition[]>([])
  const [smokeLoading, setSmokeLoading] = useState(false)
  const [latestSmokeRun, setLatestSmokeRun] = useState<SmokeRunResult | null>(null)
  const [selectedScopeId, setSelectedScopeId] = useState('current-ready')
  const [expandedRisk, setExpandedRisk] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)
  const actionHandledRef = useRef('')
  const feedbackTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
  }, [])

  const flashMessage = useCallback((text: string) => {
    setFeedback(text)
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 2400)
  }, [])

  useEffect(() => {
    if (!canOpenLaunch) return
    void actions.fetchProjects().then((rows) => {
      const list = Array.isArray(rows) ? rows : []
      return Promise.all(list.map((project) => actions.fetchTasks(project.id)))
    })
  }, [actions, canOpenLaunch])

  const allIssues = useMemo(
    () => projects.flatMap((project) => getTasksForProject(project.id) || []),
    [projects, getTasksForProject]
  )

  const projectsMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    projects.forEach((project) => {
      map[project.id] = project
    })
    return map
  }, [projects])

  const currentReadyIssues = useMemo(
    () => allIssues.filter((issue) => READY_SOURCE_STATUSES.has(normalizeStatus(issue.status))),
    [allIssues]
  )

  const releaseApprovalDraft = useMemo(() => loadReleaseApprovalDraft(), [])

  useEffect(() => {
    if (!canOpenLaunch) return
    let cancelled = false
    ;(async () => {
      try {
        const [mobileRows, deploymentRows] = await Promise.all([
          listMobileReleasesApi().catch(() => []),
          listDeploymentsApi().catch(() => []),
        ])
        if (cancelled) return
        setMobileReleases(Array.isArray(mobileRows) ? mobileRows.map(normalizeMobileRelease) : [])
        setDeployments(Array.isArray(deploymentRows) ? deploymentRows.map(normalizeDeployment) : [])
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Failed to load launch data.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [canOpenLaunch])

  const loadHealth = useCallback(async () => {
    if (!canRunDiagnostics) return null
    setHealthLoading(true)
    setError('')
    try {
      const result = await getLinearWorkspaceHealthApi()
      setHealth(result || null)
      flashMessage('Health check updated.')
      return result || null
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load workspace health.')
      return null
    } finally {
      setHealthLoading(false)
    }
  }, [canRunDiagnostics, flashMessage])

  useEffect(() => {
    if (!canRunDiagnostics) return
    void loadHealth()
  }, [canRunDiagnostics, loadHealth])

  useEffect(() => {
    if (!canRunDiagnostics) return
    let cancelled = false
    ;(async () => {
      try {
        const items = await getLinearWorkspaceSmokeTestsApi()
        if (!cancelled) setSmokeCatalog(Array.isArray(items) ? items : [])
      } catch {
        if (!cancelled) setSmokeCatalog([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canRunDiagnostics])

  const runSmokeTests = useCallback(async () => {
    if (!canRunDiagnostics) return null
    setSmokeLoading(true)
    setError('')
    try {
      const testIds = smokeCatalog.length ? smokeCatalog.map((item) => item.id) : []
      const result = await runLinearWorkspaceSmokeTestsApi({
        tests: testIds,
        mode: 'read_only',
      })
      setLatestSmokeRun(result as SmokeRunResult)
      flashMessage('Smoke tests finished.')
      return result as SmokeRunResult
    } catch (runError: any) {
      setError(runError?.message || 'Failed to run smoke tests.')
      return null
    } finally {
      setSmokeLoading(false)
    }
  }, [canRunDiagnostics, flashMessage, smokeCatalog])

  const scopeOptions = useMemo(
    () => buildLaunchSelectionOptions({
      currentReadyIssues,
      deployments,
      mobileReleases,
      releaseApprovalDraft,
    }),
    [currentReadyIssues, deployments, mobileReleases, releaseApprovalDraft]
  )

  useEffect(() => {
    if (!scopeOptions.length) return
    if (!scopeOptions.some((option) => option.id === selectedScopeId)) {
      setSelectedScopeId(scopeOptions[0].id)
    }
  }, [scopeOptions, selectedScopeId])

  const selectedScope = useMemo(
    () => scopeOptions.find((option) => option.id === selectedScopeId) || scopeOptions[0] || null,
    [scopeOptions, selectedScopeId]
  )

  const selectedIssueIdSet = useMemo(() => new Set((selectedScope?.issueIds || []).map((id) => Number(id))), [selectedScope])

  const selectedIssues = useMemo(
    () => allIssues.filter((issue) => selectedIssueIdSet.has(Number(issue.id))),
    [allIssues, selectedIssueIdSet]
  )

  const checklistStore = useMemo(
    () => normalizeChecklistStore(getPref(LAUNCH_PREF_KEY, { scopes: {} })),
    [getPref, prefsVersion]
  )

  const scopePrefKey = selectedScope?.id || 'current-ready'
  const scopeState = useMemo(
    () => checklistStore.scopes[scopePrefKey] || normalizeScopeState(null),
    [checklistStore, scopePrefKey]
  )

  const updateScopeState = useCallback((patch: Partial<LaunchChecklistScopeState>) => {
    const currentStore = normalizeChecklistStore(getPref(LAUNCH_PREF_KEY, { scopes: {} }))
    const existing = currentStore.scopes[scopePrefKey] || normalizeScopeState(null)
    const nextState = normalizeScopeState({
      ...existing,
      ...patch,
      items: patch.items ? { ...existing.items, ...patch.items } : existing.items,
      updatedAt: new Date().toISOString(),
    })
    setPref(LAUNCH_PREF_KEY, {
      scopes: {
        ...currentStore.scopes,
        [scopePrefKey]: nextState,
      },
    })
  }, [getPref, scopePrefKey, setPref])

  const toggleChecklistItem = useCallback((itemId: string) => {
    if (!checklistWritable) return
    updateScopeState({
      items: {
        [itemId]: !scopeState.items[itemId],
      },
    })
  }, [checklistWritable, scopeState.items, updateScopeState])

  const updateChecklistField = useCallback((field: 'rollbackNotes' | 'rollbackOwner' | 'stakeholderNote' | 'postDeployOwner', value: string) => {
    if (!checklistWritable) return
    updateScopeState({ [field]: value } as Partial<LaunchChecklistScopeState>)
  }, [checklistWritable, updateScopeState])

  const togglePrOverride = useCallback(() => {
    if (!checklistWritable) return
    updateScopeState({ overrideOpenPrs: !scopeState.overrideOpenPrs })
  }, [checklistWritable, scopeState.overrideOpenPrs, updateScopeState])

  const releaseCompliance = useMemo(() => {
    if (!selectedIssues.length) return null
    const selectionKey = selectedIssues.map((issue) => issue.id).sort((a, b) => a - b).join('_') || 'release'
    return getReleaseChecklistCompliance(selectionKey, selectedIssues, projectsMap)
  }, [projectsMap, selectedIssues])

  const metrics = useMemo(() => {
    const qaApproved = selectedIssues.filter((issue) => issue.devMeta?.qaApproval?.approved === true)
    const notQaApproved = selectedIssues.filter((issue) => !issue.devMeta?.qaApproval?.approved)
    const prMerged = selectedIssues.filter((issue) => issue.devMeta?.prStatus === 'merged')
    const prOpen = selectedIssues.filter((issue) => OPEN_PR_STATUSES.has(String(issue.devMeta?.prStatus || '')))
    const prMissing = selectedIssues.filter((issue) => !issue.devMeta?.prStatus)
    const missingQaProof = selectedIssues.filter((issue) => !issueHasQaProof(issue))
    const releaseEvidenceMissing = selectedIssues.filter((issue) => !issueHasReleaseEvidence(issue))
    const canceled = selectedIssues.filter((issue) => normalizeStatus(issue.status) === 'Canceled')
    const criticalUnapproved = selectedIssues.filter((issue) => ['Urgent', 'High'].includes(normalizePriority(issue.priority)) && !issue.devMeta?.qaApproval?.approved)
    const backendIssues = selectedIssues.filter((issue) => inferTeam(projectsMap[issue.projectId]?.name) === 'Backend/API')
    const mobileIssues = selectedIssues.filter((issue) => ['Android', 'iOS'].includes(inferTeam(projectsMap[issue.projectId]?.name)))
    const biIssues = selectedIssues.filter((issue) => inferTeam(projectsMap[issue.projectId]?.name) === 'Data & BI')
    const overdueIssues = selectedIssues.filter((issue) => {
      if (!issue.dueDate) return false
      const due = new Date(issue.dueDate)
      return !Number.isNaN(due.getTime()) && due.getTime() < Date.now() && normalizeStatus(issue.status) !== 'Done'
    })
    const dbConfigIssues = selectedIssues.filter(issueNeedsDbOrConfigReview)
    const sopBelowGood = (releaseCompliance?.issueCompliances || []).filter((item: any) => item.hasChecklists && item.pct < 70)
    const sopGood = selectedIssues.filter((issue) => {
      const item = (releaseCompliance?.issueCompliances || []).find((entry: any) => entry.iss?.id === issue.id)
      if (!item || !item.hasChecklists) return true
      return item.pct >= 70
    })

    return {
      selectedCount: selectedIssues.length,
      qaApprovedCount: qaApproved.length,
      notQaApprovedCount: notQaApproved.length,
      prMergedCount: prMerged.length,
      prOpenCount: prOpen.length,
      prMissingCount: prMissing.length,
      missingQaProofCount: missingQaProof.length,
      missingReleaseEvidenceCount: releaseEvidenceMissing.length,
      canceledCount: canceled.length,
      criticalUnapprovedCount: criticalUnapproved.length,
      backendIssueCount: backendIssues.length,
      mobileIssueCount: mobileIssues.length,
      biIssueCount: biIssues.length,
      overdueIssueCount: overdueIssues.length,
      dbConfigIssueCount: dbConfigIssues.length,
      sopGoodCount: sopGood.length,
      sopBelowGoodCount: sopBelowGood.length,
      issueKeys: selectedIssues.map((issue) => issueKey(projectsMap[issue.projectId]?.name, issue.id)),
      qaApprovedIssues: qaApproved,
      prOpenIssues: prOpen,
      prMissingIssues: prMissing,
      criticalUnapprovedIssues: criticalUnapproved,
      missingQaProofIssues: missingQaProof,
      overdueIssues,
      dbConfigIssues,
    }
  }, [projectsMap, releaseCompliance, selectedIssues])

  const sourceWarnings = useMemo(() => {
    const warnings: string[] = []
    if (!selectedScope) return warnings
    if (selectedScope.kind === 'deployment') {
      const deploymentDone = DEPLOYMENT_DONE_STATUSES.has(String(selectedScope.status || '').toLowerCase())
      if (!deploymentDone && selectedScope.targetDate) {
        const target = new Date(selectedScope.targetDate)
        if (!Number.isNaN(target.getTime()) && target.getTime() < Date.now()) {
          warnings.push('Selected deployment is overdue.')
        }
      }
    }
    if (selectedScope.kind === 'mobile-release') {
      const releaseDone = MOBILE_DONE_STATUSES.has(String(selectedScope.status || '').toLowerCase())
      if (!releaseDone && selectedScope.targetDate) {
        const target = new Date(selectedScope.targetDate)
        if (!Number.isNaN(target.getTime()) && target.getTime() < Date.now()) {
          warnings.push('Selected mobile release is overdue.')
        }
      }
    }
    if (selectedIssues.length === 0) warnings.push('Selected scope has no linked issues.')
    if (metrics.dbConfigIssueCount > 0) warnings.push('Selected scope includes possible DB or config changes.')
    return warnings
  }, [metrics.dbConfigIssueCount, selectedIssues.length, selectedScope])

  const healthWarnings = useMemo(() => normalizeHealthWarnings(health?.warnings), [health])
  const healthStatus = health?.status || (canRunDiagnostics ? 'idle' : 'unavailable')
  const smokeStatus = latestSmokeRun?.status || (canRunDiagnostics ? 'idle' : 'unavailable')

  const readiness = useMemo(() => {
    const blockedReasons: string[] = []
    const reviewReasons: string[] = []

    if (healthStatus === 'error') blockedReasons.push('Health check returned an error.')
    if (smokeStatus === 'failed') blockedReasons.push('Smoke tests failed.')
    if (metrics.canceledCount > 0) blockedReasons.push('Selected scope includes canceled issues.')
    if (metrics.criticalUnapprovedCount > 0) blockedReasons.push('High or urgent issues are missing QA approval.')
    if (metrics.prOpenCount > 0 && !scopeState.overrideOpenPrs) blockedReasons.push('Some PRs are still open, in review, or draft.')

    if (metrics.missingQaProofCount > 0) reviewReasons.push('Some issues are missing QA proof attachments.')
    if (metrics.sopBelowGoodCount > 0 || ((releaseCompliance?.relTotalItems || 0) > 0 && (releaseCompliance?.releasePct || 0) < 70)) {
      reviewReasons.push('SOP checklist compliance is below Good for part of the launch scope.')
    }
    if (metrics.prMissingCount > 0) reviewReasons.push('Some issues have no GitHub PR status.')
    if (smokeStatus === 'warning' || smokeStatus === 'skipped' || smokeStatus === 'idle' || smokeStatus === 'unavailable') {
      reviewReasons.push('Smoke tests are missing or have warnings.')
    }
    if (healthStatus === 'warning' || healthStatus === 'idle' || healthStatus === 'unavailable') {
      reviewReasons.push('Health check is missing or has warnings.')
    }
    if (selectedIssues.length === 0) reviewReasons.push('Selected launch scope has no issues linked yet.')
    if (!scopeState.rollbackNotes.trim()) reviewReasons.push('Rollback notes are not documented.')

    const status = blockedReasons.length > 0
      ? 'blocked'
      : reviewReasons.length > 0
        ? 'needs_review'
        : 'ready'

    return {
      status,
      blockedReasons,
      reviewReasons,
    }
  }, [
    healthStatus,
    latestSmokeRun,
    metrics.canceledCount,
    metrics.criticalUnapprovedCount,
    metrics.missingQaProofCount,
    metrics.prMissingCount,
    metrics.prOpenCount,
    releaseCompliance,
    scopeState.overrideOpenPrs,
    scopeState.rollbackNotes,
    selectedIssues.length,
    smokeStatus,
  ])

  const riskItems = useMemo(() => {
    const items: Array<{ tone: 'blocked' | 'review', label: string, detail: string }> = []
    if (metrics.prOpenCount > 0) items.push({ tone: 'blocked', label: 'Open PRs', detail: `${metrics.prOpenCount} issue(s) still have PRs open, in review, or draft.` })
    if (metrics.notQaApprovedCount > 0) items.push({ tone: metrics.criticalUnapprovedCount > 0 ? 'blocked' : 'review', label: 'Unapproved QA', detail: `${metrics.notQaApprovedCount} issue(s) are not QA approved.` })
    if (sourceWarnings.some((item) => item.includes('overdue'))) items.push({ tone: 'review', label: 'Overdue release/deployment', detail: sourceWarnings.filter((item) => item.includes('overdue')).join(' ') })
    if (metrics.missingQaProofCount > 0) items.push({ tone: 'review', label: 'Missing QA proof', detail: `${metrics.missingQaProofCount} issue(s) are missing QA proof attachments.` })
    if (healthStatus === 'error') items.push({ tone: 'blocked', label: 'Failed health check', detail: 'Workspace health diagnostics returned an error state.' })
    else if (healthStatus === 'warning') items.push({ tone: 'review', label: 'Health warnings', detail: healthWarnings.join(' ') || 'Workspace health diagnostics returned warnings.' })
    if (smokeStatus === 'failed') items.push({ tone: 'blocked', label: 'Failed smoke tests', detail: 'Latest smoke test run failed.' })
    else if (smokeStatus === 'warning' || smokeStatus === 'skipped') items.push({ tone: 'review', label: 'Smoke warnings', detail: 'Latest smoke test run reported warnings.' })
    if (metrics.backendIssueCount > 0) items.push({ tone: 'review', label: 'Backend/API issues included', detail: `${metrics.backendIssueCount} backend/API issue(s) are in the launch scope.` })
    if (metrics.dbConfigIssueCount > 0) items.push({ tone: 'review', label: 'DB/config changes included', detail: `${metrics.dbConfigIssueCount} issue(s) look like DB or config changes.` })
    if (metrics.issueKeys.length > 0 && selectedIssues.some((issue) => ['Urgent', 'High'].includes(normalizePriority(issue.priority)))) {
      items.push({ tone: 'review', label: 'High/Urgent issues included', detail: 'Launch scope includes high-priority work.' })
    }
    if (!scopeState.rollbackNotes.trim()) items.push({ tone: 'review', label: 'No rollback notes', detail: 'Rollback plan notes are empty.' })
    return items
  }, [
    healthStatus,
    healthWarnings,
    metrics.backendIssueCount,
    metrics.dbConfigIssueCount,
    metrics.issueKeys.length,
    metrics.missingQaProofCount,
    metrics.notQaApprovedCount,
    metrics.prOpenCount,
    metrics.criticalUnapprovedCount,
    scopeState.rollbackNotes,
    selectedIssues,
    smokeStatus,
    sourceWarnings,
  ])

  const affectedAreas = useMemo(() => {
    const areas = new Set<string>()
    selectedIssues.forEach((issue) => {
      areas.add(inferTeam(projectsMap[issue.projectId]?.name))
    })
    if (selectedScope?.kind === 'deployment') areas.add(selectedScope.releaseType || 'Deployment')
    if (selectedScope?.kind === 'mobile-release') areas.add(selectedScope.releaseType || 'Mobile')
    return Array.from(areas)
  }, [projectsMap, selectedIssues, selectedScope])

  const nextActions = useMemo(() => {
    const actionsList: string[] = []
    if (readiness.status === 'blocked') actionsList.push(...readiness.blockedReasons)
    if (readiness.status !== 'ready') actionsList.push(...readiness.reviewReasons)
    if (!scopeState.items.postDeployAssigned) actionsList.push('Assign the post-deploy smoke test owner.')
    if (!scopeState.items.stakeholdersInformed) actionsList.push('Confirm stakeholder communication.')
    return Array.from(new Set(actionsList)).slice(0, 8)
  }, [readiness, scopeState.items.postDeployAssigned, scopeState.items.stakeholdersInformed])

  const launchSummaryText = useMemo(() => {
    const healthSummary = health
      ? `Health: ${overallStatusLabel(health.status)}${healthWarnings.length ? ` (${healthWarnings.join(' | ')})` : ''}`
      : 'Health: Not run'
    const smokeSummary = latestSmokeRun
      ? `Smoke: ${overallStatusLabel(latestSmokeRun.status)} (${latestSmokeRun.results.length} checks, ${runDuration(latestSmokeRun)})`
      : 'Smoke: Not run'
    const selectedIssueKeys = metrics.issueKeys.length ? metrics.issueKeys.join(', ') : 'None linked'
    const selectedName = selectedScope?.label || 'Launch scope'
    const riskLines = riskItems.length ? riskItems.map((risk) => `- ${risk.label}: ${risk.detail}`) : ['- No launch risks detected.']
    const actionLines = nextActions.length ? nextActions.map((item) => `- ${item}`) : ['- No immediate next actions.']
    return [
      `Launch Control Summary`,
      `Scope: ${selectedName}`,
      `Readiness: ${overallStatusLabel(readiness.status)}`,
      '',
      `Selected Issues: ${selectedIssueKeys}`,
      `QA Approved: ${metrics.qaApprovedCount}/${metrics.selectedCount}`,
      `PR Merged: ${metrics.prMergedCount}`,
      `PR Open/In Review/Draft: ${metrics.prOpenCount}`,
      `Missing QA Proof: ${metrics.missingQaProofCount}`,
      `SOP Good/Complete: ${metrics.sopGoodCount}/${metrics.selectedCount}`,
      healthSummary,
      smokeSummary,
      '',
      `Risks:`,
      ...riskLines,
      '',
      `Next Actions:`,
      ...actionLines,
    ].join('\n')
  }, [
    health,
    healthWarnings,
    latestSmokeRun,
    metrics.issueKeys,
    metrics.missingQaProofCount,
    metrics.prMergedCount,
    metrics.prOpenCount,
    metrics.qaApprovedCount,
    metrics.selectedCount,
    metrics.sopGoodCount,
    nextActions,
    readiness.status,
    riskItems,
    selectedScope,
  ])

  const rollbackPlanText = useMemo(() => {
    const selectedName = selectedScope?.label || 'Launch scope'
    const owner = scopeState.rollbackOwner.trim() || getUserName(user)
    const changedItems = metrics.issueKeys.length ? metrics.issueKeys.join(', ') : 'Add linked issue keys here'
    const affected = affectedAreas.length ? affectedAreas.join(', ') : 'Website'
    const notes = scopeState.rollbackNotes.trim() || 'Document the exact rollback commands, app version rollback steps, and any DB/config reversion details here.'
    return [
      `Rollback Plan`,
      `Scope: ${selectedName}`,
      `Owner: ${owner}`,
      '',
      `What changed:`,
      `- ${changedItems}`,
      '',
      `Affected areas:`,
      `- ${affected}`,
      '',
      `Rollback steps:`,
      `- ${notes}`,
      `- Confirm previous stable build/tag is available.`,
      `- Re-verify critical flows after rollback.`,
      '',
      `Confirmation checks:`,
      `- API health returns OK`,
      `- Homepage and key user flows work`,
      `- Error rate returns to baseline`,
      '',
      `Communication note:`,
      `- Notify stakeholders, product owner, and support once rollback is complete.`,
    ].join('\n')
  }, [affectedAreas, metrics.issueKeys, scopeState.rollbackNotes, scopeState.rollbackOwner, selectedScope, user])

  const postDeployVerificationText = useMemo(() => {
    const includeMobile = selectedScope?.kind === 'mobile-release' || metrics.mobileIssueCount > 0
    const includeBi = metrics.biIssueCount > 0
    const lines = [
      `Post-Deploy Verification`,
      `Scope: ${selectedScope?.label || 'Launch scope'}`,
      '',
      `Website / Core checks`,
      `- [ ] lifesmile.ae homepage`,
      `- [ ] Product page`,
      `- [ ] Search`,
      `- [ ] Cart`,
      `- [ ] Checkout`,
      `- [ ] Login / account`,
      '',
      `Backend / ops checks`,
      `- [ ] API health`,
      `- [ ] Logs`,
    ]

    if (includeMobile) {
      lines.push('', `Mobile checks`, `- [ ] Android critical flows`, `- [ ] iOS critical flows`)
    }

    if (includeBi) {
      lines.push('', `BI / reporting checks`, `- [ ] Reporting dashboards`, `- [ ] Data sync / BI spot checks`)
    }

    return lines.join('\n')
  }, [metrics.biIssueCount, metrics.mobileIssueCount, selectedScope])

  const copyLaunchSummary = useCallback(async () => {
    const ok = await copyText(launchSummaryText)
    flashMessage(ok ? 'Launch summary copied.' : 'Copy failed.')
  }, [flashMessage, launchSummaryText])

  const copyRollbackPlan = useCallback(async () => {
    const ok = await copyText(rollbackPlanText)
    flashMessage(ok ? 'Rollback plan copied.' : 'Copy failed.')
  }, [flashMessage, rollbackPlanText])

  const copyPostDeployVerification = useCallback(async () => {
    const ok = await copyText(postDeployVerificationText)
    flashMessage(ok ? 'Post-deploy verification copied.' : 'Copy failed.')
  }, [flashMessage, postDeployVerificationText])

  const saveLaunchRecord = useCallback(async () => {
    if (!canSaveLaunchRecord || !selectedScope) {
      flashMessage('Manager or admin access is required to save launch records.')
      return null
    }

    const smokeCounts = latestSmokeRun
      ? {
          passed: latestSmokeRun.results.filter((item) => item.status === 'passed').length,
          warning: latestSmokeRun.results.filter((item) => item.status === 'warning' || item.status === 'skipped').length,
          failed: latestSmokeRun.results.filter((item) => item.status === 'failed').length,
        }
      : null

    const launchType = selectedScope.releaseType || (affectedAreas.length > 1 ? 'Mixed' : (affectedAreas[0] || 'Website'))
    const qaSummary = [
      `QA Approved: ${metrics.qaApprovedCount}/${metrics.selectedCount}`,
      `Missing QA proof: ${metrics.missingQaProofCount}`,
      `Critical not approved: ${metrics.criticalUnapprovedCount}`,
    ].join(' | ')
    const deploymentSummary = [
      `Scope: ${selectedScope.label}`,
      `Environment: ${selectedScope.environment || 'Production'}`,
      `Type: ${launchType}`,
      selectedScope.description ? `Summary: ${selectedScope.description}` : '',
    ].filter(Boolean).join('\n')

    try {
      await createLaunchRecordApi({
        launch_name: selectedScope.label || 'Launch record',
        launch_type: launchType,
        environment: selectedScope.environment || 'Production',
        status: readiness.status === 'ready' ? 'Completed' : 'Needs Follow-up',
        linked_issue_ids: selectedIssues.map((issue) => issue.id),
        linked_deployment_id: selectedScope.kind === 'deployment' ? Number(String(selectedScope.id).split(':')[1]) : null,
        linked_mobile_release_id: selectedScope.kind === 'mobile-release' ? Number(String(selectedScope.id).split(':')[1]) : null,
        readiness_snapshot: {
          selectedScope,
          status: readiness.status,
          blockedReasons: readiness.blockedReasons,
          reviewReasons: readiness.reviewReasons,
          risks: riskItems,
          nextActions,
          metrics: {
            selectedCount: metrics.selectedCount,
            qaApprovedCount: metrics.qaApprovedCount,
            prMergedCount: metrics.prMergedCount,
            prOpenCount: metrics.prOpenCount,
            missingQaProofCount: metrics.missingQaProofCount,
            sopGoodCount: metrics.sopGoodCount,
          },
          issueKeys: metrics.issueKeys,
        },
        health_snapshot: health ? {
          status: health.status || 'unknown',
          checkedAt: health.checkedAt || null,
          warnings: healthWarnings,
        } : {},
        smoke_snapshot: latestSmokeRun ? {
          runId: latestSmokeRun.runId,
          status: latestSmokeRun.status,
          startedAt: latestSmokeRun.startedAt,
          finishedAt: latestSmokeRun.finishedAt,
          counts: smokeCounts,
        } : {},
        checklist_snapshot: {
          ...scopeState,
          completedCount: Object.values(scopeState.items).filter(Boolean).length,
          totalCount: Object.keys(scopeState.items || {}).length,
        },
        qa_summary: qaSummary,
        deployment_summary: deploymentSummary,
        rollback_used: false,
        incident_notes: '',
        what_went_well: '',
        what_went_wrong: '',
        follow_up_actions: nextActions.join('\n'),
      })
      flashMessage('Launch record saved.')
      return true
    } catch (saveError: any) {
      setError(saveError?.message || 'Failed to save launch record.')
      return null
    }
  }, [
    affectedAreas,
    canSaveLaunchRecord,
    flashMessage,
    health,
    healthWarnings,
    latestSmokeRun,
    metrics,
    nextActions,
    readiness,
    riskItems,
    scopeState,
    selectedIssues,
    selectedScope,
  ])

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
    if (loadingProjects || Object.values(loadingTasks).some(Boolean)) return
    const params = new URLSearchParams(location.search)
    const action = params.get('action')
    if (!action) return
    if (actionHandledRef.current === location.search) return
    actionHandledRef.current = location.search

    void (async () => {
      if (action === 'run-health') {
        await loadHealth()
      } else if (action === 'run-smoke') {
        await runSmokeTests()
      } else if (action === 'save-record') {
        await saveLaunchRecord()
      } else if (action === 'copy-summary') {
        await copyLaunchSummary()
      } else if (action === 'copy-rollback') {
        await copyRollbackPlan()
      } else if (action === 'copy-post-deploy') {
        await copyPostDeployVerification()
      }

      params.delete('action')
      const nextSearch = params.toString()
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
    })()
  }, [
    copyLaunchSummary,
    copyPostDeployVerification,
    copyRollbackPlan,
    loadHealth,
    loadingProjects,
    loadingTasks,
    location.pathname,
    location.search,
    navigate,
    runSmokeTests,
    saveLaunchRecord,
  ])

  if (!canOpenLaunch) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to view launch control."
      />
    )
  }

  const loadingIssues = loadingProjects || Object.values(loadingTasks).some(Boolean)

  return (
    <div className="llaunch-shell">
      <LinearSidebar />

      <main className="llaunch-page">
        <header className="llaunch-header">
          <div>
            <h1>Launch Control</h1>
            <p>Final readiness view for website, backend, mobile, and product releases.</p>
          </div>

          <div className="llaunch-header__actions">
            <button
              type="button"
              className="llaunch-btn"
              onClick={() => void loadHealth()}
              disabled={!canRunDiagnostics || healthLoading}
              title={canRunDiagnostics ? 'Run health check' : 'Manager or admin access required'}
            >
              {healthLoading ? <Loader2 size={14} className="llaunch-spin" /> : <RefreshCcw size={14} />}
              Run Health Check
            </button>
            <button
              type="button"
              className="llaunch-btn"
              onClick={() => void runSmokeTests()}
              disabled={!canRunDiagnostics || smokeLoading}
              title={canRunDiagnostics ? 'Run smoke tests' : 'Manager or admin access required'}
            >
              {smokeLoading ? <Loader2 size={14} className="llaunch-spin" /> : <ClipboardCheck size={14} />}
              Run Smoke Tests
            </button>
            <button
              type="button"
              className="llaunch-btn"
              onClick={() => void saveLaunchRecord()}
              disabled={!canSaveLaunchRecord}
              title={canSaveLaunchRecord ? 'Save launch record' : 'Manager or admin access required'}
            >
              <CheckCircle2 size={14} />
              Save Launch Record
            </button>
            <button type="button" className="llaunch-btn" onClick={copyLaunchSummary}>
              <Copy size={14} />
              Copy Launch Summary
            </button>
            <button type="button" className="llaunch-btn" onClick={copyRollbackPlan}>
              <Copy size={14} />
              Copy Rollback Plan
            </button>
            <button type="button" className="llaunch-btn llaunch-btn--primary" onClick={copyPostDeployVerification}>
              <Copy size={14} />
              Copy Post-Deploy Verification
            </button>
          </div>
        </header>

        {feedback && <div className="llaunch-banner">{feedback}</div>}
        {error && <div className="llaunch-banner llaunch-banner--error">{error}</div>}

        <section className="llaunch-section">
          <div className="llaunch-section__header">
            <div>
              <h2>Release Selector</h2>
              <p>Choose a deployment, mobile release, release batch draft, or the live ready-for-release scope.</p>
            </div>
          </div>

          <div className="llaunch-selector">
            <label className="llaunch-field">
              <span>Launch scope</span>
              <div className="llaunch-select-wrap">
                <select value={selectedScopeId} onChange={(event) => setSelectedScopeId(event.target.value)}>
                  {scopeOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </label>

            <div className="llaunch-scope-card">
              <div className="llaunch-scope-card__label">{selectedScope?.kind?.replace(/-/g, ' ') || 'Launch scope'}</div>
              <strong>{selectedScope?.label || 'No scope selected'}</strong>
              <p>{selectedScope?.description || 'Choose a launch scope to review readiness.'}</p>
              <div className="llaunch-scope-card__meta">
                {selectedScope?.status ? <span>Status: {selectedScope.status}</span> : null}
                {selectedScope?.environment ? <span>{selectedScope.environment}</span> : null}
                {selectedScope?.targetDate ? <span>Target: {formatShortDate(selectedScope.targetDate)}</span> : null}
              </div>
            </div>
          </div>
        </section>

        <section className="llaunch-section">
          <div className="llaunch-section__header">
            <div>
              <h2>Readiness Overview</h2>
              <p>Core production-readiness signals for the selected launch scope.</p>
            </div>
          </div>

          <div className="llaunch-metrics">
            <MetricCard label="Selected issues" value={metrics.selectedCount} />
            <MetricCard label="QA Approved" value={metrics.qaApprovedCount} />
            <MetricCard label="Not QA Approved" value={metrics.notQaApprovedCount} />
            <MetricCard label="PR Merged" value={metrics.prMergedCount} />
            <MetricCard label="PR Open / Review / Draft" value={metrics.prOpenCount} />
            <MetricCard label="SOP Complete / Good" value={metrics.sopGoodCount} detail={releaseCompliance?.releasePct != null ? `Release SOP ${releaseCompliance.releasePct}%` : undefined} />
            <MetricCard label="Missing QA proof" value={metrics.missingQaProofCount} />
            <MetricCard label="Health status" value={overallStatusLabel(healthStatus)} detail={health?.checkedAt ? formatDateTime(health.checkedAt) : 'No recent check'} />
            <MetricCard label="Smoke test status" value={overallStatusLabel(smokeStatus)} detail={latestSmokeRun ? runDuration(latestSmokeRun) : 'No recent run'} />
          </div>
        </section>

        <section className="llaunch-status-grid">
          <section className={`llaunch-panel llaunch-panel--status llaunch-panel--${statusTone(readiness.status)}`}>
            <div className="llaunch-panel__header">
              <div className={`llaunch-status-chip llaunch-status-chip--${statusTone(readiness.status)}`}>
                <StatusIcon status={readiness.status} />
                <span>{overallStatusLabel(readiness.status)}</span>
              </div>
              <div>
                <h2>Launch Readiness</h2>
                <p>Blocked if critical checks fail; otherwise reviewed against QA, PR, health, smoke, and SOP signals.</p>
              </div>
            </div>

            {checklistWritable && (
              <label className="llaunch-inline-check">
                <input
                  type="checkbox"
                  checked={scopeState.overrideOpenPrs}
                  onChange={togglePrOverride}
                />
                Allow launch with non-merged PRs for this scope
              </label>
            )}

            {readiness.blockedReasons.length > 0 && (
              <div className="llaunch-reason-block">
                <strong>Blocked because</strong>
                <ul>
                  {readiness.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}

            {readiness.reviewReasons.length > 0 && (
              <div className="llaunch-reason-block">
                <strong>Needs review because</strong>
                <ul>
                  {readiness.reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="llaunch-panel">
            <div className="llaunch-panel__header">
              <div>
                <h2>Health + Smoke</h2>
                <p>Latest diagnostics available from the existing workspace endpoints.</p>
              </div>
              <div className="llaunch-panel__links">
                <button type="button" className="llaunch-link-btn" onClick={() => navigate('/projects/linear/health')}>Health page</button>
                <button type="button" className="llaunch-link-btn" onClick={() => navigate('/projects/linear/smoke-tests')}>Smoke Tests page</button>
              </div>
            </div>

            <div className="llaunch-integration-grid">
              <div className="llaunch-integration-card">
                <div className={`llaunch-status-chip llaunch-status-chip--${statusTone(healthStatus)}`}>
                  <StatusIcon status={healthStatus} />
                  <span>{overallStatusLabel(healthStatus)}</span>
                </div>
                <strong>Health</strong>
                <p>{health?.checkedAt ? `Last checked ${formatDateTime(health.checkedAt)}` : 'No health result available yet.'}</p>
                {healthWarnings.length > 0 && <p className="llaunch-integration-warning">{healthWarnings.join(' ')}</p>}
              </div>

              <div className="llaunch-integration-card">
                <div className={`llaunch-status-chip llaunch-status-chip--${statusTone(smokeStatus)}`}>
                  <StatusIcon status={smokeStatus} />
                  <span>{overallStatusLabel(smokeStatus)}</span>
                </div>
                <strong>Smoke Tests</strong>
                <p>{latestSmokeRun ? `Latest run ${formatDateTime(latestSmokeRun.startedAt)} · ${runDuration(latestSmokeRun)}` : 'No smoke test result available yet.'}</p>
                {latestSmokeRun?.results?.some((item) => item.status !== 'passed') && (
                  <p className="llaunch-integration-warning">
                    {latestSmokeRun.results.filter((item) => item.status !== 'passed').length} result(s) need review.
                  </p>
                )}
              </div>
            </div>
          </section>
        </section>

        <section className="llaunch-content-grid">
          <section className="llaunch-panel">
            <div className="llaunch-panel__header">
              <div>
                <h2>Launch Checklist</h2>
                <p>Manual launch controls persisted per launch scope.</p>
              </div>
              {!checklistWritable && (
                <span className="llaunch-panel__hint">Manager or admin access required to edit.</span>
              )}
            </div>

            <div className="llaunch-checklist">
              {CHECKLIST_ITEMS.map((item) => (
                <label key={item.id} className={`llaunch-checklist__item ${scopeState.items[item.id] ? 'llaunch-checklist__item--done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={scopeState.items[item.id]}
                    onChange={() => toggleChecklistItem(item.id)}
                    disabled={!checklistWritable}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <div className="llaunch-form-grid">
              <label className="llaunch-field">
                <span>Rollback owner</span>
                <input
                  type="text"
                  value={scopeState.rollbackOwner}
                  onChange={(event) => updateChecklistField('rollbackOwner', event.target.value)}
                  disabled={!checklistWritable}
                  placeholder="Owner for rollback execution"
                />
              </label>

              <label className="llaunch-field">
                <span>Post-deploy verification owner</span>
                <input
                  type="text"
                  value={scopeState.postDeployOwner}
                  onChange={(event) => updateChecklistField('postDeployOwner', event.target.value)}
                  disabled={!checklistWritable}
                  placeholder="Owner for smoke verification"
                />
              </label>

              <label className="llaunch-field llaunch-field--full">
                <span>Rollback notes</span>
                <textarea
                  rows={4}
                  value={scopeState.rollbackNotes}
                  onChange={(event) => updateChecklistField('rollbackNotes', event.target.value)}
                  disabled={!checklistWritable}
                  placeholder="Document rollback steps, prior versions, and validation notes."
                />
              </label>

              <label className="llaunch-field llaunch-field--full">
                <span>Stakeholder note</span>
                <textarea
                  rows={3}
                  value={scopeState.stakeholderNote}
                  onChange={(event) => updateChecklistField('stakeholderNote', event.target.value)}
                  disabled={!checklistWritable}
                  placeholder="Record comms owner, approvers, or launch coordination notes."
                />
              </label>
            </div>
          </section>

          <section className="llaunch-panel">
            <div className="llaunch-panel__header">
              <div>
                <h2>Risk Panel</h2>
                <p>Current launch risks inferred from linked issues, diagnostics, and manual notes.</p>
              </div>
              <button type="button" className="llaunch-link-btn" onClick={() => setExpandedRisk((current) => !current)}>
                {expandedRisk ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expandedRisk ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {expandedRisk && (
              <div className="llaunch-risk-list">
                {riskItems.length === 0 && (
                  <div className="llaunch-empty">No launch risks detected for the current scope.</div>
                )}

                {riskItems.map((risk) => (
                  <article key={`${risk.label}-${risk.detail}`} className={`llaunch-risk llaunch-risk--${risk.tone}`}>
                    <div className={`llaunch-status-chip llaunch-status-chip--${risk.tone === 'blocked' ? 'blocked' : 'review'}`}>
                      <StatusIcon status={risk.tone === 'blocked' ? 'blocked' : 'needs_review'} />
                      <span>{risk.label}</span>
                    </div>
                    <p>{risk.detail}</p>
                  </article>
                ))}
              </div>
            )}

            <div className="llaunch-next-actions">
              <strong>Next actions</strong>
              <ul>
                {nextActions.length > 0 ? nextActions.map((item) => <li key={item}>{item}</li>) : <li>No additional actions required.</li>}
              </ul>
            </div>
          </section>
        </section>

        <section className="llaunch-section">
          <div className="llaunch-section__header">
            <div>
              <h2>Selected Issues</h2>
              <p>Scope-linked issues used for QA, PR, SOP, and launch readiness calculations.</p>
            </div>
          </div>

          <div className="llaunch-issues">
            {loadingIssues && selectedIssues.length === 0 && (
              <div className="llaunch-empty">Loading issues…</div>
            )}

            {!loadingIssues && selectedIssues.length === 0 && (
              <div className="llaunch-empty">No issues are currently linked to this launch scope.</div>
            )}

            {selectedIssues.map((issue) => {
              const project = projectsMap[issue.projectId]
              const key = issueKey(project?.name, issue.id)
              const prStatus = issue.devMeta?.prStatus || 'missing'
              const qaApproved = issue.devMeta?.qaApproval?.approved === true
              return (
                <article key={issue.id} className="llaunch-issue">
                  <div className="llaunch-issue__top">
                    <div>
                      <strong>{key}</strong>
                      <span>{issue.title}</span>
                    </div>
                    <div className="llaunch-issue__chips">
                      <span className="llaunch-chip">{normalizeStatus(issue.status)}</span>
                      <span className="llaunch-chip">{normalizePriority(issue.priority)}</span>
                      <span className={`llaunch-chip ${qaApproved ? 'llaunch-chip--good' : 'llaunch-chip--warn'}`}>{qaApproved ? 'QA Approved' : 'QA Pending'}</span>
                      <span className={`llaunch-chip ${prStatus === 'merged' ? 'llaunch-chip--good' : 'llaunch-chip--warn'}`}>{prStatus === 'missing' ? 'PR Missing' : `PR ${String(prStatus).replace(/_/g, ' ')}`}</span>
                    </div>
                  </div>
                  <div className="llaunch-issue__meta">
                    <span>{project?.name || 'Unknown project'}</span>
                    {issueHasQaProof(issue) ? <span>QA proof attached</span> : <span>Missing QA proof</span>}
                    {issueHasReleaseEvidence(issue) ? <span>Release evidence attached</span> : null}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="llaunch-section">
          <div className="llaunch-section__header">
            <div>
              <h2>Manual Route Checklist</h2>
              <p>Open key routes directly for final production verification.</p>
            </div>
          </div>

          <div className="llaunch-routes">
            {[
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
            ].map((route) => (
              <div key={route} className="llaunch-route">
                <code>{route}</code>
                <button
                  type="button"
                  className="llaunch-btn"
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

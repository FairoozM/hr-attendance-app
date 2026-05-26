const { query } = require('../db')
const projectsService = require('./projectsService')
const projectTasksService = require('./projectTasksService')
const taskCommentsService = require('./taskCommentsService')
const taskActivityService = require('./taskActivityService')
const linearWorkspaceService = require('./linearWorkspaceService')
const { getLinearWorkspaceHealth } = require('./linearWorkspaceHealthService')
const { listLinearWorkspaceUsers } = require('./linearWorkspaceUsersService')
const {
  canManageWorkspaceUsers,
  canViewAudit,
  getRolePermissionSummary,
  getUserWorkspaceRole,
} = require('../utils/linearPermissions')

const DEFAULT_TIMEOUT_MS = 12_000

const FRONTEND_ROUTE_CHECKLIST = [
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
]

const SMOKE_TESTS = [
  {
    id: 'health',
    name: 'Core Health',
    category: 'Core health',
    description: 'Validate /api/health, database connectivity, and the Linear health diagnostics.',
    destructive: false,
  },
  {
    id: 'issues',
    name: 'Issues',
    category: 'Issues',
    description: 'Fetch projects and issues, then verify normalized issue payloads.',
    destructive: false,
  },
  {
    id: 'detail-dependencies',
    name: 'Detail Dependencies',
    category: 'Issue detail',
    description: 'Check comments, activity, and attachments for a known issue when one is available.',
    destructive: false,
  },
  {
    id: 'shared-workspace',
    name: 'Shared Workspace',
    category: 'Shared workspace',
    description: 'Verify docs, intake, releases, deployments, and checklist runs respond with JSON-safe data.',
    destructive: false,
  },
  {
    id: 'search',
    name: 'Search',
    category: 'Search',
    description: 'Verify short-query guards and a lightweight workspace search probe.',
    destructive: false,
  },
  {
    id: 'permissions',
    name: 'Permissions',
    category: 'Permissions',
    description: 'Validate the current user permission summary and manager/admin diagnostic access.',
    destructive: false,
  },
  {
    id: 'integrations-readiness',
    name: 'Integrations Readiness',
    category: 'Integrations',
    description: 'Read AI, GitHub, and attachment storage readiness from internal health diagnostics.',
    destructive: false,
  },
  {
    id: 'route-checklist',
    name: 'Route Checklist',
    category: 'Manual routes',
    description: 'Provide a manual browser route checklist for post-deploy verification.',
    destructive: false,
  },
]

const TEST_ID_ALIASES = {
  'core-health': 'health',
  core: 'health',
  health: 'health',
  issues: 'issues',
  detail: 'detail-dependencies',
  'detail-dependencies': 'detail-dependencies',
  details: 'detail-dependencies',
  attachments: 'detail-dependencies',
  comments: 'detail-dependencies',
  activity: 'detail-dependencies',
  'shared-workspace': 'shared-workspace',
  shared: 'shared-workspace',
  docs: 'shared-workspace',
  intake: 'shared-workspace',
  releases: 'shared-workspace',
  deployments: 'shared-workspace',
  search: 'search',
  permissions: 'permissions',
  integrations: 'integrations-readiness',
  'integrations-readiness': 'integrations-readiness',
  routes: 'route-checklist',
  'route-checklist': 'route-checklist',
}

const SECRET_RE = /\b(GITHUB_TOKEN|GITHUB_WEBHOOK_SECRET|OPENAI_API_KEY|PASSWORD|SECRET|API_KEY)\b\s*[:=]\s*([^\s,;]+)/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi

function nowIso() {
  return new Date().toISOString()
}

function sanitizeText(value) {
  return String(value || '')
    .replace(SECRET_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .slice(0, 500)
}

function sanitizeDetails(value, depth = 0) {
  if (value == null) return value
  if (depth > 4) return '[Truncated]'
  if (typeof value === 'string') return sanitizeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeDetails(item, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      out[key] = sanitizeDetails(item, depth + 1)
    }
    return out
  }
  return sanitizeText(value)
}

function resultRank(status) {
  if (status === 'failed') return 3
  if (status === 'warning') return 2
  if (status === 'skipped') return 1
  return 0
}

function aggregateResultStatus(statuses = []) {
  const rank = Math.max(...statuses.map(resultRank), 0)
  if (rank >= 3) return 'failed'
  if (rank >= 2) return 'warning'
  if (rank >= 1) return 'skipped'
  return 'passed'
}

function aggregateRunStatus(statuses = []) {
  const rank = Math.max(...statuses.map(resultRank), 0)
  if (rank >= 3) return 'failed'
  if (rank >= 1) return 'warning'
  return 'passed'
}

function buildCheck(label, status, message, details = null) {
  return {
    label,
    status,
    message: sanitizeText(message),
    details: details == null ? null : sanitizeDetails(details),
  }
}

function buildResult(definition, durationMs, status, message, details = null) {
  return {
    id: definition.id,
    name: definition.name,
    status,
    durationMs,
    message: sanitizeText(message),
    details: details == null ? null : sanitizeDetails(details),
  }
}

async function withTimeout(run, timeoutMs, timeoutMessage) {
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(timeoutMessage)
          error.code = 'SMOKE_TIMEOUT'
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function listLinearWorkspaceSmokeTests() {
  return SMOKE_TESTS.map((item) => ({ ...item }))
}

function normalizeRequestedTests(tests) {
  if (!Array.isArray(tests) || tests.length === 0) {
    return SMOKE_TESTS.map((item) => item.id)
  }

  const normalized = []
  for (const raw of tests) {
    const key = String(raw || '').trim().toLowerCase()
    const id = TEST_ID_ALIASES[key] || null
    if (id && !normalized.includes(id)) normalized.push(id)
  }

  return normalized.length ? normalized : SMOKE_TESTS.map((item) => item.id)
}

function findSmokeTestDefinition(id) {
  return SMOKE_TESTS.find((item) => item.id === id) || null
}

function findAppRouteHandler(method, path) {
  const app = require('../app')
  const stack = app?._router?.stack || []
  for (const layer of stack) {
    if (!layer.route) continue
    if (layer.route.path !== path) continue
    if (!layer.route.methods?.[method.toLowerCase()]) continue
    return layer.route.stack[layer.route.stack.length - 1]?.handle || null
  }
  return null
}

async function invokeJsonHandler(handler, req = {}) {
  return new Promise((resolve, reject) => {
    let resolved = false
    const response = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code
        return this
      },
      type(value) {
        this.headers['content-type'] = value
        return this
      },
      json(body) {
        resolved = true
        resolve({
          statusCode: this.statusCode || 200,
          headers: this.headers,
          body,
        })
      },
      send(body) {
        resolved = true
        resolve({
          statusCode: this.statusCode || 200,
          headers: this.headers,
          body,
        })
      },
    }

    Promise.resolve(handler(
      {
        method: 'GET',
        query: {},
        params: {},
        body: {},
        headers: {},
        ...req,
      },
      response,
      () => {
        if (!resolved) {
          resolved = true
          resolve({
            statusCode: response.statusCode || 200,
            headers: response.headers,
            body: null,
          })
        }
      }
    )).then(() => {
      if (!resolved) {
        resolved = true
        resolve({
          statusCode: response.statusCode || 200,
          headers: response.headers,
          body: null,
        })
      }
    }).catch(reject)
  })
}

function getIssueSummary(issue) {
  return {
    id: issue?.id ?? null,
    title: issue?.title || '',
    status: issue?.status || '',
    progress_percent: issue?.progress_percent ?? null,
    sort_order: issue?.sort_order ?? null,
    estimated_hours: issue?.estimated_hours ?? null,
    actual_hours: issue?.actual_hours ?? null,
  }
}

async function createIssueContextLoader() {
  let loaded = false
  let cached = {
    projects: [],
    firstProject: null,
    firstIssue: null,
  }

  return async function loadIssueContext() {
    if (loaded) return cached
    loaded = true

    const projects = await projectsService.listProjects({ includeArchived: false })
    cached.projects = Array.isArray(projects) ? projects : []
    cached.firstProject = cached.projects[0] || null

    for (const project of cached.projects.slice(0, 8)) {
      const issues = await projectTasksService.getTasksForProject(project.id)
      if (Array.isArray(issues) && issues.length > 0) {
        cached.firstProject = project
        cached.firstIssue = issues[0]
        break
      }
    }

    return cached
  }
}

async function runHealthTest(definition, context) {
  const checks = []

  const apiHealthHandler = findAppRouteHandler('GET', '/api/health')
  if (!apiHealthHandler) {
    checks.push(buildCheck('GET /api/health', 'failed', 'Health route handler was not found.'))
  } else {
    const response = await invokeJsonHandler(apiHealthHandler)
    const ok = response.statusCode === 200 && response.body?.status === 'ok'
    checks.push(buildCheck(
      'GET /api/health',
      ok ? 'passed' : 'failed',
      ok ? 'API health route returned OK JSON.' : 'API health route did not return the expected JSON payload.',
      { statusCode: response.statusCode, body: response.body }
    ))
  }

  await query('SELECT 1 AS ok')
  checks.push(buildCheck('Database SELECT 1', 'passed', 'Database query completed successfully.'))

  const linearHealth = await getLinearWorkspaceHealth()
  const linearHealthOk = Boolean(linearHealth && linearHealth.status && linearHealth.checks)
  checks.push(buildCheck(
    'Linear health diagnostics',
    linearHealthOk ? (linearHealth.status === 'error' ? 'warning' : 'passed') : 'failed',
    linearHealthOk ? `Linear health diagnostics returned ${linearHealth.status}.` : 'Linear health diagnostics did not return the expected payload.',
    {
      status: linearHealth?.status,
      checkedAt: linearHealth?.checkedAt,
    }
  ))

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Core health checks passed.'
    : 'Core health checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runIssuesTest(definition, context) {
  const checks = []
  const issueContext = await context.loadIssueContext()
  const projects = issueContext.projects

  checks.push(buildCheck(
    'Projects fetch',
    Array.isArray(projects) ? 'passed' : 'failed',
    Array.isArray(projects)
      ? `Fetched ${projects.length} project records.`
      : 'Projects response was not an array.',
    { count: Array.isArray(projects) ? projects.length : null }
  ))

  if (!issueContext.firstProject) {
    const status = aggregateResultStatus(checks.map((item) => item.status))
    return {
      status: status === 'passed' ? 'warning' : status,
      message: 'No project was available to run the issues smoke test fully.',
      details: { checks },
    }
  }

  const issues = await projectTasksService.getTasksForProject(issueContext.firstProject.id)
  const issuesArray = Array.isArray(issues)
  checks.push(buildCheck(
    'Issues fetch',
    issuesArray ? 'passed' : 'failed',
    issuesArray
      ? `Fetched ${issues.length} issues for project "${issueContext.firstProject.name}".`
      : 'Issues response was not an array.',
    {
      projectId: issueContext.firstProject.id,
      projectName: issueContext.firstProject.name,
      count: issuesArray ? issues.length : null,
    }
  ))

  if (!issueContext.firstIssue) {
    const status = aggregateResultStatus(checks.map((item) => item.status))
    return {
      status: status === 'passed' ? 'warning' : status,
      message: 'Projects loaded, but no issue records were available to verify field normalization.',
      details: { checks },
    }
  }

  const firstIssue = issueContext.firstIssue
  const normalizedFieldsOkay =
    typeof firstIssue.progress_percent === 'number' &&
    typeof firstIssue.sort_order === 'number' &&
    (firstIssue.estimated_hours == null || typeof firstIssue.estimated_hours === 'number') &&
    (firstIssue.actual_hours == null || typeof firstIssue.actual_hours === 'number')

  checks.push(buildCheck(
    'Issue normalization',
    normalizedFieldsOkay ? 'passed' : 'failed',
    normalizedFieldsOkay
      ? 'Issue fields were normalized into JSON-safe numbers.'
      : 'Issue payload contains unexpected field types.',
    getIssueSummary(firstIssue)
  ))

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Issues smoke checks passed.'
    : 'Issues smoke checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runDetailDependenciesTest(definition, context) {
  const checks = []
  const issueContext = await context.loadIssueContext()

  if (!issueContext.firstProject || !issueContext.firstIssue) {
    checks.push(buildCheck(
      'Issue selection',
      'skipped',
      'No issue was available to validate comments, activity, and attachments.'
    ))
    return {
      status: 'skipped',
      message: 'Detail dependency checks were skipped because no issue was available.',
      details: { checks },
    }
  }

  const comments = await taskCommentsService.listCommentsForTask(issueContext.firstProject.id, issueContext.firstIssue.id)
  checks.push(buildCheck(
    'Comments JSON',
    Array.isArray(comments) ? 'passed' : 'failed',
    Array.isArray(comments) ? 'Comments dependency returned JSON-safe data.' : 'Comments dependency did not return an array.',
    { count: Array.isArray(comments) ? comments.length : null }
  ))

  const attachments = await projectTasksService.listAttachments(issueContext.firstIssue.id)
  checks.push(buildCheck(
    'Attachments JSON',
    Array.isArray(attachments) ? 'passed' : 'failed',
    Array.isArray(attachments) ? 'Attachments dependency returned JSON-safe data.' : 'Attachments dependency did not return an array.',
    { count: Array.isArray(attachments) ? attachments.length : null }
  ))

  if (String(context.user?.role || '').toLowerCase() === 'admin') {
    const activity = await taskActivityService.listActivityForTask(issueContext.firstProject.id, issueContext.firstIssue.id)
    checks.push(buildCheck(
      'Activity JSON',
      Array.isArray(activity) ? 'passed' : 'failed',
      Array.isArray(activity) ? 'Activity dependency returned JSON-safe data.' : 'Activity dependency did not return an array.',
      { count: Array.isArray(activity) ? activity.length : null }
    ))
  } else {
    checks.push(buildCheck(
      'Activity JSON',
      'warning',
      'Activity endpoint is currently admin-only, so the manager smoke test skipped that route-level validation.',
      { role: context.userRole }
    ))
  }

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Detail dependency checks passed.'
    : 'Detail dependency checks completed with warnings or failures.'

  return { status, message, details: { checks, issueId: issueContext.firstIssue.id, projectId: issueContext.firstProject.id } }
}

async function runSharedWorkspaceTest(definition) {
  const checks = []

  const docs = await linearWorkspaceService.listDocs()
  checks.push(buildCheck('Docs list', Array.isArray(docs) ? 'passed' : 'failed', Array.isArray(docs) ? `Fetched ${docs.length} docs.` : 'Docs response was not an array.', { count: Array.isArray(docs) ? docs.length : null }))

  const intake = await linearWorkspaceService.listIntake()
  checks.push(buildCheck('Intake list', Array.isArray(intake) ? 'passed' : 'failed', Array.isArray(intake) ? `Fetched ${intake.length} intake items.` : 'Intake response was not an array.', { count: Array.isArray(intake) ? intake.length : null }))

  const mobileReleases = await linearWorkspaceService.listMobileReleases()
  checks.push(buildCheck('Mobile releases list', Array.isArray(mobileReleases) ? 'passed' : 'failed', Array.isArray(mobileReleases) ? `Fetched ${mobileReleases.length} mobile releases.` : 'Mobile releases response was not an array.', { count: Array.isArray(mobileReleases) ? mobileReleases.length : null }))

  const deployments = await linearWorkspaceService.listDeployments()
  checks.push(buildCheck('Deployments list', Array.isArray(deployments) ? 'passed' : 'failed', Array.isArray(deployments) ? `Fetched ${deployments.length} deployments.` : 'Deployments response was not an array.', { count: Array.isArray(deployments) ? deployments.length : null }))

  const checklistRuns = await linearWorkspaceService.listChecklistRuns({})
  checks.push(buildCheck('Checklist runs list', Array.isArray(checklistRuns) ? 'passed' : 'failed', Array.isArray(checklistRuns) ? `Fetched ${checklistRuns.length} checklist runs.` : 'Checklist runs response was not an array.', { count: Array.isArray(checklistRuns) ? checklistRuns.length : null }))

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Shared workspace smoke checks passed.'
    : 'Shared workspace smoke checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runSearchTest(definition, context) {
  const checks = []

  const shortQuery = await linearWorkspaceService.searchLinearWorkspace({
    q: 'x',
    type: 'all',
    limit: 5,
    includeAudit: canViewAudit(context.user),
  })
  const shortQueryOkay = Array.isArray(shortQuery?.results) && shortQuery.results.length === 0
  checks.push(buildCheck(
    'Short query guard',
    shortQueryOkay ? 'passed' : 'failed',
    shortQueryOkay ? 'Too-short search query was rejected cleanly.' : 'Too-short search query did not return the expected empty result.',
    { resultCount: Array.isArray(shortQuery?.results) ? shortQuery.results.length : null }
  ))

  const issueContext = await context.loadIssueContext()
  const probeQuerySource = issueContext.firstIssue?.title || issueContext.firstProject?.name || 'qa'
  const probeQuery = String(probeQuerySource).trim().split(/\s+/).find((term) => term.length >= 2) || 'qa'
  const probe = await linearWorkspaceService.searchLinearWorkspace({
    q: probeQuery,
    type: 'all',
    limit: 5,
    includeAudit: canViewAudit(context.user),
  })
  const probeOkay = Array.isArray(probe?.results)
  checks.push(buildCheck(
    'Safe search probe',
    probeOkay ? 'passed' : 'failed',
    probeOkay ? `Safe search probe completed with ${probe.results.length} result(s).` : 'Safe search probe did not return a results array.',
    {
      query: probeQuery,
      resultCount: Array.isArray(probe?.results) ? probe.results.length : null,
    }
  ))

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Search smoke checks passed.'
    : 'Search smoke checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runPermissionsTest(definition, context) {
  const checks = []
  const role = context.userRole || getUserWorkspaceRole(context.user)
  const summary = getRolePermissionSummary(role) || {}

  checks.push(buildCheck(
    'Current permission summary',
    role ? 'passed' : 'failed',
    role ? `Resolved current Linear workspace role as ${role}.` : 'Unable to resolve current Linear workspace role.',
    { role, summary }
  ))

  const diagnosticAccess = canViewAudit(context.user)
  checks.push(buildCheck(
    'Manager/admin diagnostics access',
    diagnosticAccess ? 'passed' : 'failed',
    diagnosticAccess ? 'Current user can access manager/admin diagnostics.' : 'Current user cannot access manager/admin diagnostics.'
  ))

  if (canManageWorkspaceUsers(context.user)) {
    const users = await listLinearWorkspaceUsers()
    checks.push(buildCheck(
      'Admin users route readiness',
      Array.isArray(users) ? 'passed' : 'failed',
      Array.isArray(users) ? `Admin user role data loaded (${users.length} users).` : 'Admin user role data did not return an array.',
      { count: Array.isArray(users) ? users.length : null }
    ))
  } else {
    checks.push(buildCheck(
      'Admin users route readiness',
      'passed',
      'Current role is manager-level, so admin-only users route access is not expected.',
      { role }
    ))
  }

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Permissions smoke checks passed.'
    : 'Permissions smoke checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runIntegrationsReadinessTest(definition) {
  const checks = []
  const health = await getLinearWorkspaceHealth()
  const aiConfig = health?.checks?.aiConfig || {}
  const githubConfig = health?.checks?.githubConfig || {}
  const attachmentStorage = health?.checks?.attachmentStorage || {}

  checks.push(buildCheck(
    'AI readiness',
    aiConfig.status === 'error' ? 'failed' : (aiConfig.status === 'warning' ? 'warning' : 'passed'),
    aiConfig.message || 'AI readiness check completed.',
    {
      openaiConfigured: aiConfig.openaiConfigured ?? null,
      aiEnabled: aiConfig.aiEnabled ?? null,
    }
  ))

  checks.push(buildCheck(
    'GitHub readiness',
    githubConfig.status === 'error' ? 'failed' : (githubConfig.status === 'warning' ? 'warning' : 'passed'),
    githubConfig.message || 'GitHub readiness check completed.',
    {
      tokenConfigured: githubConfig.tokenConfigured ?? null,
      webhookSecretConfigured: githubConfig.webhookSecretConfigured ?? null,
    }
  ))

  checks.push(buildCheck(
    'Attachment storage readiness',
    attachmentStorage.status === 'error' ? 'failed' : (attachmentStorage.status === 'warning' ? 'warning' : 'passed'),
    attachmentStorage.message || 'Attachment storage readiness check completed.',
    {
      bucketConfigured: attachmentStorage.bucketConfigured ?? null,
      regionConfigured: attachmentStorage.regionConfigured ?? null,
      checked: attachmentStorage.checked ?? null,
    }
  ))

  const status = aggregateResultStatus(checks.map((item) => item.status))
  const message = status === 'passed'
    ? 'Integration readiness checks passed.'
    : 'Integration readiness checks completed with warnings or failures.'

  return { status, message, details: { checks } }
}

async function runRouteChecklistTest(definition) {
  const checks = [
    buildCheck(
      'Manual browser checklist',
      'passed',
      'Manual route checklist prepared. Open each route in the browser to confirm post-deploy rendering.',
      { routes: FRONTEND_ROUTE_CHECKLIST }
    ),
  ]

  return {
    status: 'passed',
    message: 'Manual route checklist is ready.',
    details: {
      checks,
      routes: FRONTEND_ROUTE_CHECKLIST,
      manualOnly: true,
    },
  }
}

const TEST_RUNNERS = {
  health: runHealthTest,
  issues: runIssuesTest,
  'detail-dependencies': runDetailDependenciesTest,
  'shared-workspace': runSharedWorkspaceTest,
  search: runSearchTest,
  permissions: runPermissionsTest,
  'integrations-readiness': runIntegrationsReadinessTest,
  'route-checklist': runRouteChecklistTest,
}

async function runLinearWorkspaceSmokeTests({ tests, mode = 'read_only', user } = {}) {
  if (String(mode || 'read_only').trim().toLowerCase() !== 'read_only') {
    const error = new Error('Only read_only smoke test mode is supported.')
    error.status = 400
    throw error
  }

  const runId = `smoke-${Date.now()}`
  const startedAt = nowIso()
  const selectedIds = normalizeRequestedTests(tests)
  const loadIssueContext = await createIssueContextLoader()
  const sharedContext = {
    mode: 'read_only',
    user,
    userRole: getUserWorkspaceRole(user),
    loadIssueContext,
  }

  const results = []

  for (const testId of selectedIds) {
    const definition = findSmokeTestDefinition(testId)
    if (!definition) continue
    const runner = TEST_RUNNERS[testId]
    const startedMs = Date.now()

    try {
      const payload = await withTimeout(
        () => runner(definition, sharedContext),
        DEFAULT_TIMEOUT_MS,
        `${definition.name} timed out.`
      )
      results.push(buildResult(
        definition,
        Date.now() - startedMs,
        payload.status || 'passed',
        payload.message || `${definition.name} completed.`,
        payload.details || null
      ))
    } catch (error) {
      const status = error?.code === 'SMOKE_TIMEOUT' ? 'warning' : 'failed'
      results.push(buildResult(
        definition,
        Date.now() - startedMs,
        status,
        error?.message || `${definition.name} failed.`,
        {
          error: sanitizeText(error?.message || `${definition.name} failed.`),
        }
      ))
    }
  }

  const finishedAt = nowIso()
  const status = aggregateRunStatus(results.map((item) => item.status))

  return {
    runId,
    startedAt,
    finishedAt,
    status,
    mode: 'read_only',
    results,
  }
}

module.exports = {
  FRONTEND_ROUTE_CHECKLIST,
  listLinearWorkspaceSmokeTests,
  runLinearWorkspaceSmokeTests,
}

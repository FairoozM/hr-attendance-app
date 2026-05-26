const { query } = require('../db')
const linearWorkspaceService = require('./linearWorkspaceService')
const { getBudgetSettings } = require('./aiBudgetService')

const MAX_RECENT_ERRORS = 20
const recentWorkspaceErrors = []

const SECRET_RE = /\b(GITHUB_TOKEN|GITHUB_WEBHOOK_SECRET|OPENAI_API_KEY|PASSWORD|SECRET|API_KEY)\b\s*[:=]\s*([^\s,;]+)/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi

const SHARED_TABLES = [
  { key: 'docs', table: 'linear_docs', latestColumn: 'updated_at', optional: false },
  { key: 'intake', table: 'linear_intake_items', latestColumn: 'updated_at', optional: false },
  { key: 'mobileReleases', table: 'linear_mobile_releases', latestColumn: 'updated_at', optional: false },
  { key: 'deployments', table: 'linear_deployments', latestColumn: 'updated_at', optional: false },
  { key: 'checklistRuns', table: 'linear_checklist_runs', latestColumn: 'updated_at', optional: false },
  { key: 'auditLog', table: 'linear_audit_log', latestColumn: 'created_at', optional: false },
  { key: 'notificationPreferences', table: 'linear_notification_preferences', latestColumn: 'updated_at', optional: false },
  { key: 'digestOutbox', table: 'linear_digest_outbox', latestColumn: 'updated_at', optional: true },
]

function sanitizeMessage(value) {
  return String(value || '')
    .replace(SECRET_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .slice(0, 280)
}

function severityRank(status) {
  if (status === 'error') return 2
  if (status === 'warning') return 1
  return 0
}

function maxStatus(statuses = []) {
  const rank = Math.max(...statuses.map(severityRank), 0)
  if (rank >= 2) return 'error'
  if (rank >= 1) return 'warning'
  return 'ok'
}

function nowIso() {
  return new Date().toISOString()
}

function tableNameSql(tableName) {
  return String(tableName || '').replace(/[^a-zA-Z0-9_]/g, '')
}

function recordLinearWorkspaceError({ route, message, status = 500, error = null, module = 'workspace' }) {
  const item = {
    timestamp: nowIso(),
    module,
    route: String(route || 'unknown'),
    status: Number.isFinite(Number(status)) ? Number(status) : 500,
    message: sanitizeMessage(message || error?.message || 'Unexpected workspace error'),
  }
  recentWorkspaceErrors.unshift(item)
  if (recentWorkspaceErrors.length > MAX_RECENT_ERRORS) recentWorkspaceErrors.length = MAX_RECENT_ERRORS
  return item
}

function listRecentWorkspaceErrors() {
  return recentWorkspaceErrors.map((item) => ({ ...item }))
}

async function timedCheck(run) {
  const startedAt = Date.now()
  const result = await run()
  return {
    responseTimeMs: Date.now() - startedAt,
    ...result,
  }
}

async function tableExists(tableName) {
  const { rows } = await query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`])
  return Boolean(rows[0]?.exists)
}

async function getTableStats({ table, latestColumn, optional = false }) {
  return timedCheck(async () => {
    const exists = await tableExists(table)
    if (!exists) {
      return {
        status: optional ? 'warning' : 'error',
        exists: false,
        count: 0,
        latestAt: null,
        message: optional ? `${table} is not available.` : `${table} is missing.`,
      }
    }

    const safeTable = tableNameSql(table)
    const safeLatestColumn = tableNameSql(latestColumn)
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count, MAX(${safeLatestColumn}) AS latest_at FROM ${safeTable}`
    )
    return {
      status: 'ok',
      exists: true,
      count: rows[0]?.count || 0,
      latestAt: rows[0]?.latest_at || null,
      message: `${table} is available.`,
    }
  })
}

async function checkDatabase() {
  return timedCheck(async () => {
    await query('SELECT 1 AS ok')
    return {
      status: 'ok',
      message: 'Database query succeeded.',
    }
  })
}

async function checkIssuesApi() {
  return timedCheck(async () => {
    const [projectTasksExists, projectsExists, usersExists] = await Promise.all([
      tableExists('project_tasks'),
      tableExists('projects'),
      tableExists('users'),
    ])

    if (!projectTasksExists || !projectsExists || !usersExists) {
      return {
        status: 'error',
        tables: {
          project_tasks: projectTasksExists,
          projects: projectsExists,
          users: usersExists,
        },
        issueCount: 0,
        latestIssueUpdatedAt: null,
        message: 'One or more core issue tables are missing.',
      }
    }

    const { rows } = await query(
      `SELECT COUNT(*)::int AS issue_count, MAX(updated_at) AS latest_issue_updated_at
       FROM project_tasks`
    )

    return {
      status: 'ok',
      tables: {
        project_tasks: true,
        projects: true,
        users: true,
      },
      issueCount: rows[0]?.issue_count || 0,
      latestIssueUpdatedAt: rows[0]?.latest_issue_updated_at || null,
      message: 'Core issue tables are available.',
    }
  })
}

async function checkSharedWorkspaceTables() {
  const tableResults = await Promise.all(
    SHARED_TABLES.map(async (config) => [config.key, await getTableStats(config)])
  )
  const tables = Object.fromEntries(tableResults)
  const status = maxStatus(Object.values(tables).map((item) => item.status))
  const totalCount = Object.values(tables).reduce((sum, item) => sum + (item.count || 0), 0)
  return {
    status,
    tables,
    totalCount,
    message: status === 'ok'
      ? 'Shared workspace tables are available.'
      : 'One or more shared workspace tables need attention.',
  }
}

async function checkAiConfig() {
  return timedCheck(async () => {
    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim())
    let aiEnabled = null
    try {
      const settings = await getBudgetSettings()
      aiEnabled = settings?.allow_ai_generation ?? null
    } catch {
      aiEnabled = null
    }

    const warnings = []
    if (!openaiConfigured) warnings.push('OPENAI_API_KEY is not configured.')
    if (aiEnabled === false) warnings.push('AI generation is disabled in budget settings.')

    return {
      status: warnings.length ? 'warning' : 'ok',
      openaiConfigured,
      aiEnabled,
      message: warnings[0] || 'AI configuration looks ready.',
    }
  })
}

async function checkGithubConfig() {
  return timedCheck(async () => {
    const tokenConfigured = Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim())
    const webhookSecretConfigured = Boolean(process.env.GITHUB_WEBHOOK_SECRET && process.env.GITHUB_WEBHOOK_SECRET.trim())
    const warnings = []
    if (!tokenConfigured) warnings.push('GitHub token is not configured.')
    if (!webhookSecretConfigured) warnings.push('GitHub webhook secret is not configured.')
    return {
      status: warnings.length ? 'warning' : 'ok',
      tokenConfigured,
      webhookSecretConfigured,
      message: warnings[0] || 'GitHub configuration looks ready.',
    }
  })
}

async function checkSearchApi() {
  return timedCheck(async () => {
    const shortQuery = await linearWorkspaceService.searchLinearWorkspace({
      q: 'x',
      type: 'issues',
      limit: 1,
      includeAudit: false,
    })
    const probe = await linearWorkspaceService.searchLinearWorkspace({
      q: 'qa',
      type: 'issues',
      limit: 1,
      includeAudit: false,
    })

    return {
      status: 'ok',
      minQueryGuardWorks: Array.isArray(shortQuery?.results) && shortQuery.results.length === 0,
      sampleResultCount: Array.isArray(probe?.results) ? probe.results.length : 0,
      message: 'Search dependencies responded to a lightweight probe.',
    }
  })
}

async function checkAttachmentStorage() {
  return timedCheck(async () => {
    const bucketConfigured = Boolean((process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '').trim())
    const regionConfigured = Boolean((process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1').trim())
    const status = bucketConfigured ? 'ok' : 'warning'
    return {
      status,
      bucketConfigured,
      regionConfigured,
      checked: 'config_only',
      message: bucketConfigured
        ? 'Attachment storage configuration is present. External storage was not probed.'
        : 'Attachment storage bucket is not configured.',
    }
  })
}

async function checkAuditLog() {
  return timedCheck(async () => {
    const exists = await tableExists('linear_audit_log')
    if (!exists) {
      return {
        status: 'error',
        count: 0,
        latestAt: null,
        message: 'Audit log table is missing.',
      }
    }
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count, MAX(created_at) AS latest_at
       FROM linear_audit_log`
    )
    return {
      status: 'ok',
      count: rows[0]?.count || 0,
      latestAt: rows[0]?.latest_at || null,
      message: 'Audit log query succeeded.',
    }
  })
}

async function safeCheck(run, fallback) {
  try {
    return await run()
  } catch (error) {
    return {
      status: 'error',
      responseTimeMs: 0,
      message: sanitizeMessage(error?.message || fallback),
    }
  }
}

async function getLinearWorkspaceHealth() {
  const checkedAt = nowIso()

  const [
    database,
    issuesApi,
    sharedWorkspaceTables,
    aiConfig,
    githubConfig,
    searchApi,
    attachmentStorage,
    auditLog,
  ] = await Promise.all([
    safeCheck(checkDatabase, 'Database health check failed.'),
    safeCheck(checkIssuesApi, 'Issues API health check failed.'),
    safeCheck(checkSharedWorkspaceTables, 'Shared workspace health check failed.'),
    safeCheck(checkAiConfig, 'AI configuration health check failed.'),
    safeCheck(checkGithubConfig, 'GitHub configuration health check failed.'),
    safeCheck(checkSearchApi, 'Search health check failed.'),
    safeCheck(checkAttachmentStorage, 'Attachment storage health check failed.'),
    safeCheck(checkAuditLog, 'Audit log health check failed.'),
  ])

  const checks = {
    database,
    issuesApi,
    sharedWorkspaceTables,
    aiConfig,
    githubConfig,
    searchApi,
    attachmentStorage,
    auditLog,
  }

  const warnings = []
  if (!aiConfig.openaiConfigured) {
    warnings.push({ scope: 'aiConfig', message: 'AI is not configured because OPENAI_API_KEY is missing.' })
  }
  if (aiConfig.aiEnabled === false) {
    warnings.push({ scope: 'aiConfig', message: 'AI generation is disabled by current budget settings.' })
  }
  if (!githubConfig.tokenConfigured) {
    warnings.push({ scope: 'githubConfig', message: 'GitHub token is missing.' })
  }
  if (!githubConfig.webhookSecretConfigured) {
    warnings.push({ scope: 'githubConfig', message: 'GitHub webhook secret is missing.' })
  }
  if (!attachmentStorage.bucketConfigured) {
    warnings.push({ scope: 'attachmentStorage', message: 'Attachment storage bucket is not configured.' })
  }

  const status = maxStatus([
    ...Object.values(checks).map((item) => item.status),
    warnings.length ? 'warning' : 'ok',
  ])

  return {
    status,
    checkedAt,
    checks,
    recentErrors: listRecentWorkspaceErrors(),
    warnings,
  }
}

module.exports = {
  getLinearWorkspaceHealth,
  recordLinearWorkspaceError,
  listRecentWorkspaceErrors,
}

const express = require('express')
const auth = require('../middleware/auth')
const projectsController = require('../controllers/projectsController')
const projectTasksController = require('../controllers/projectTasksController')
const taskCommentsController = require('../controllers/taskCommentsController')
const taskActivityController = require('../controllers/taskActivityController')
const projectCyclesController = require('../controllers/projectCyclesController')
const issueAIController = require('../controllers/issueAIController')
const issueGitHubController  = require('../controllers/issueGitHubController')
const attachmentAIController = require('../controllers/attachmentAIController')
const issueQAController      = require('../controllers/issueQAController')
const weeklyReportAIController = require('../controllers/weeklyReportAIController')
const linearWorkspaceController = require('../controllers/linearWorkspaceController')

const router = express.Router()

// All routes require auth (attachAuth applied in app.js)
router.use(auth.requireAuth)

const view = [auth.requirePermission('planner', 'view')]
const manage = [auth.requirePermission('planner', 'manage')]

// ---- Projects ----
router.get('/dashboard', ...view, projectsController.getDashboard)

// ---- Weekly Report AI Summary (Phase 11C) ----
// Must be registered BEFORE /:id routes to avoid param collision.
router.post('/linear/reports/weekly/ai-summary', ...view, weeklyReportAIController.generateSummary)

// ---- Linear Workspace (Phase 14A) — registered before /:id to avoid collision ----
router.get   ('/linear/admin/users',             linearWorkspaceController.listWorkspaceUsers)
router.patch ('/linear/admin/users/:userId/role',linearWorkspaceController.updateWorkspaceUserRole)
router.get   ('/linear/admin/permissions/audit', linearWorkspaceController.getPermissionsAudit)
router.post  ('/linear/admin/permissions/simulate', linearWorkspaceController.simulatePermissions)
router.get   ('/linear/admin/export',            linearWorkspaceController.exportWorkspaceData)
router.post  ('/linear/admin/import/dry-run',    linearWorkspaceController.dryRunImportWorkspaceData)
router.post  ('/linear/admin/import/preview',    linearWorkspaceController.previewImportWorkspaceData)
router.post  ('/linear/admin/import/apply',      linearWorkspaceController.applyImportWorkspaceData)
router.get   ('/linear/smoke-tests',             ...view, linearWorkspaceController.listWorkspaceSmokeTests)
router.post  ('/linear/smoke-tests/run',         ...view, linearWorkspaceController.runWorkspaceSmokeTests)
router.get   ('/linear/health',                  ...view, linearWorkspaceController.getWorkspaceHealth)
router.get   ('/linear/audit',                   linearWorkspaceController.getAuditLog)
router.get   ('/linear/search',                  ...view, linearWorkspaceController.searchWorkspace)
router.get   ('/linear/notifications/preferences', ...view, linearWorkspaceController.getNotificationPreferences)
router.patch ('/linear/notifications/preferences', ...view, linearWorkspaceController.updateNotificationPreferences)
router.get   ('/linear/notifications/digests',     ...view, linearWorkspaceController.listDigestOutbox)
router.post  ('/linear/notifications/digests',     ...view, linearWorkspaceController.createDigestOutbox)
router.patch ('/linear/notifications/digests/:id', ...view, linearWorkspaceController.updateDigestOutbox)
router.delete('/linear/notifications/digests/:id', ...view, linearWorkspaceController.deleteDigestOutbox)
router.get   ('/linear/docs',                    ...view,   linearWorkspaceController.listDocs)
router.post  ('/linear/docs',                    ...manage, linearWorkspaceController.createDoc)
router.get   ('/linear/docs/:id',                ...view,   linearWorkspaceController.getDoc)
router.patch ('/linear/docs/:id',                ...manage, linearWorkspaceController.updateDoc)
router.delete('/linear/docs/:id',                ...manage, linearWorkspaceController.deleteDoc)

router.get   ('/linear/intake',                  ...view,   linearWorkspaceController.listIntake)
router.post  ('/linear/intake',                  linearWorkspaceController.createIntake)
router.patch ('/linear/intake/:id',              linearWorkspaceController.updateIntake)
router.delete('/linear/intake/:id',              linearWorkspaceController.deleteIntake)

router.get   ('/linear/mobile-releases',         ...view,   linearWorkspaceController.listMobileReleases)
router.post  ('/linear/mobile-releases',         ...manage, linearWorkspaceController.createMobileRelease)
router.patch ('/linear/mobile-releases/:id',     ...manage, linearWorkspaceController.updateMobileRelease)
router.delete('/linear/mobile-releases/:id',     ...manage, linearWorkspaceController.deleteMobileRelease)

router.get   ('/linear/deployments',             ...view,   linearWorkspaceController.listDeployments)
router.post  ('/linear/deployments',             ...manage, linearWorkspaceController.createDeployment)
router.patch ('/linear/deployments/:id',         ...manage, linearWorkspaceController.updateDeployment)
router.delete('/linear/deployments/:id',         ...manage, linearWorkspaceController.deleteDeployment)

router.get   ('/linear/launch-records',          ...view,   linearWorkspaceController.listLaunchRecords)
router.post  ('/linear/launch-records',          ...view,   linearWorkspaceController.createLaunchRecord)
router.patch ('/linear/launch-records/:id',      ...view,   linearWorkspaceController.updateLaunchRecord)
router.delete('/linear/launch-records/:id',      ...view,   linearWorkspaceController.deleteLaunchRecord)

router.get   ('/linear/checklist-runs',          ...view,   linearWorkspaceController.listChecklistRuns)
router.post  ('/linear/checklist-runs',          ...manage, linearWorkspaceController.upsertChecklistRun)
router.delete('/linear/checklist-runs/:id',      ...manage, linearWorkspaceController.deleteChecklistRun)

router.get('/', ...view, projectsController.listProjects)
router.post('/', ...manage, projectsController.createProject)
router.get('/:id', ...view, projectsController.getProject)
router.patch('/:id', ...manage, projectsController.updateProject)
router.delete('/:id', ...manage, projectsController.deleteProject)

// ---- Sections ----
router.post('/:id/sections', ...manage, projectsController.createSection)
router.patch('/:id/sections/:sectionId', ...manage, projectsController.updateSection)
router.delete('/:id/sections/:sectionId', ...manage, projectsController.deleteSection)

// ---- Tasks ----
router.get('/:id/tasks', ...view, projectTasksController.listTasks)
router.post('/:id/tasks', projectTasksController.createTask)
router.patch('/:projectId/tasks/:taskId', projectTasksController.updateTask)
router.delete('/:projectId/tasks/:taskId', projectTasksController.deleteTask)

// ---- Comments (Phase 3) ----
router.get(
  '/:projectId/tasks/:taskId/comments',
  ...view,
  taskCommentsController.listComments
)
router.post(
  '/:projectId/tasks/:taskId/comments',
  taskCommentsController.createComment
)

// ---- Activity log (Phase 3) ----
router.get(
  '/:projectId/tasks/:taskId/activity',
  ...view,
  taskActivityController.listActivity
)

// ---- Dependencies ----
router.post('/:projectId/tasks/:taskId/dependencies', ...manage, projectTasksController.addDependency)
router.delete('/:projectId/tasks/:taskId/dependencies/:depId', ...manage, projectTasksController.removeDependency)

// ---- Cycles (Phase 4B) — backed by sprints table internally ----
// UI says "Cycle"; DB column/table remains sprint_id / sprints.
router.get(   '/:projectId/cycles',            ...view,   projectCyclesController.listCycles)
router.post(  '/:projectId/cycles',            ...manage, projectCyclesController.createCycle)
router.patch( '/:projectId/cycles/:cycleId',   ...manage, projectCyclesController.updateCycle)

// ---- Issue AI Assistant (Phase 6B) ----
router.post(
  '/:projectId/tasks/:taskId/ai/assist',
  ...view,
  issueAIController.aiAssist
)

// ---- GitHub PR Sync (Phase 7A) ----
router.post(
  '/:projectId/tasks/:taskId/github/sync-pr',
  issueGitHubController.syncPr
)

// ---- GitHub Integration Diagnostics (Phase 7D) ----
router.get('/integrations/github/status', ...manage, async (req, res) => {
  try {
    const tokenConfigured   = !!(process.env.GITHUB_TOKEN          && process.env.GITHUB_TOKEN.trim())
    const secretConfigured  = !!(process.env.GITHUB_WEBHOOK_SECRET && process.env.GITHUB_WEBHOOK_SECRET.trim())

    // Last webhook event — query most-recently updated task that has a lastWebhookAction
    const { query } = require('../db')
    const webhookRow = await query(
      `SELECT
         id,
         dev_meta->>'lastWebhookAction' AS last_action,
         dev_meta->>'repo'              AS last_repo,
         dev_meta->>'githubUpdatedAt'   AS last_github_ts,
         updated_at
       FROM project_tasks
       WHERE dev_meta ? 'lastWebhookAction'
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    const lastWebhook = webhookRow.rows[0] || null

    // Last manual sync — most-recently updated task that has prTitle (set by 7A sync)
    const syncRow = await query(
      `SELECT
         id,
         dev_meta->>'prTitle'         AS pr_title,
         dev_meta->>'repo'            AS repo,
         dev_meta->>'githubUpdatedAt' AS github_ts,
         updated_at
       FROM project_tasks
       WHERE dev_meta ? 'prTitle'
         AND NOT (dev_meta ? 'lastWebhookAction')
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    // also check webhook tasks for manual-sync indicator — combine both
    const syncRow2 = await query(
      `SELECT
         id,
         dev_meta->>'prTitle'         AS pr_title,
         dev_meta->>'repo'            AS repo,
         dev_meta->>'githubUpdatedAt' AS github_ts,
         updated_at
       FROM project_tasks
       WHERE dev_meta ? 'prTitle'
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    const lastSync = syncRow2.rows[0] || syncRow.rows[0] || null

    return res.json({
      githubTokenConfigured:          tokenConfigured,
      githubWebhookSecretConfigured:  secretConfigured,
      manualSyncAvailable:            tokenConfigured,
      webhookAvailable:               secretConfigured,
      webhookPath:                    '/api/integrations/github/webhook',
      supportedEvents:                ['pull_request'],
      supportedActions:               ['opened', 'edited', 'synchronize', 'ready_for_review', 'closed', 'reopened'],
      supportedIssueKeys:             ['WEB', 'AND', 'IOS', 'API', 'UX', 'BI'],
      ...(lastWebhook ? {
        lastWebhookReceivedAt:   lastWebhook.updated_at,
        lastWebhookAction:       lastWebhook.last_action,
        lastWebhookRepo:         lastWebhook.last_repo,
        lastWebhookIssueId:      lastWebhook.id,
      } : {}),
      ...(lastSync ? {
        lastManualSyncAt:        lastSync.updated_at,
        lastManualSyncRepo:      lastSync.repo,
      } : {}),
    })
  } catch (err) {
    console.error('[github/status]', err.message)
    return res.status(500).json({ error: 'Failed to fetch GitHub integration status.' })
  }
})

// ---- GitHub Automation Audit Log (Phase 7E) ----
// TODO: Unmatched webhook events (no task found) are not yet stored — they are
//       silently ignored. A future phase can add a github_webhook_log table for
//       these. For now, only matched events (from task_activity_log) appear here.
router.get('/integrations/github/audit', ...manage, async (req, res) => {
  try {
    const { query } = require('../db')
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500)
    const offset = parseInt(req.query.offset, 10) || 0

    const result = await query(
      `SELECT
          al.id,
          al.task_id,
          al.user_id,
          al.meta,
          al.created_at,
          pt.project_id,
          pt.dev_meta,
          p.name AS project_name
        FROM task_activity_log al
        JOIN project_tasks pt ON pt.id = al.task_id
        JOIN projects       p  ON p.id  = pt.project_id
        WHERE al.action = 'dev_meta_updated'
          AND al.meta->>'summary' ILIKE 'GitHub PR%'
        ORDER BY al.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    // Parse each row's summary string into structured fields
    // Format from 7A: "GitHub PR synced: owner/repo#123 (open)"
    // Format from 7B: "GitHub PR opened: owner/repo#123 (open)"
    const SUMMARY_RE = /^(GitHub PR [^:]+):\s+([^#\s]+)#(\d+)\s*\(([^)]+)\)/i

    const rows = result.rows.map((row) => {
      const summary = row.meta?.summary || ''
      const m = SUMMARY_RE.exec(summary)

      const eventVerb  = m ? m[1].trim() : 'GitHub PR updated'
      const repo       = m ? m[2].trim() : (row.dev_meta?.repo || '')
      const prNumber   = m ? parseInt(m[3], 10) : (row.dev_meta?.prNumber || null)
      const prStatus   = m ? m[4].trim() : (row.dev_meta?.prStatus || '')

      // "synced" = Phase 7A manual sync; any other verb = Phase 7B webhook
      const source = eventVerb.toLowerCase().includes('synced') ? 'manual-sync' : 'webhook'

      return {
        id:          row.id,
        createdAt:   row.created_at,
        taskId:      row.task_id,
        projectId:   row.project_id,
        projectName: row.project_name || '',
        actorUserId: row.user_id,
        eventType:   eventVerb,
        message:     summary,
        source,
        repo,
        prNumber,
        prStatus,
        prUrl:       row.dev_meta?.prUrl || null,
        matched:     true,
      }
    })

    return res.json({ rows, total: rows.length })
  } catch (err) {
    console.error('[github/audit]', err.message)
    return res.status(500).json({ error: 'Failed to fetch GitHub audit log.' })
  }
})

// ---- Attachments ----
router.get('/:projectId/tasks/:taskId/attachments', ...view, projectTasksController.listAttachments)
router.post(
  '/:projectId/tasks/:taskId/attachments/upload-url',
  projectTasksController.getAttachmentUploadUrl
)
router.post('/:projectId/tasks/:taskId/attachments', projectTasksController.saveAttachment)
router.patch('/:projectId/tasks/:taskId/attachments/:attachId', projectTasksController.patchAttachment)
router.delete('/:projectId/tasks/:taskId/attachments/:attachId', projectTasksController.deleteAttachment)
router.get(
  '/:projectId/tasks/:taskId/attachments/:attachId/download-url',
  ...view,
  projectTasksController.getAttachmentDownloadUrl
)

// ---- Attachment AI Analysis ----
router.post(
  '/:projectId/tasks/:taskId/attachments/:attachmentId/ai/analyze',
  ...manage,
  attachmentAIController.analyze
)

// ---- QA Review ----
router.post('/:projectId/tasks/:taskId/qa/approve', issueQAController.approve)
router.post('/:projectId/tasks/:taskId/qa/revoke',  issueQAController.revoke)

module.exports = router

const express = require('express')
const auth = require('../middleware/auth')
const projectsController = require('../controllers/projectsController')
const projectTasksController = require('../controllers/projectTasksController')
const taskCommentsController = require('../controllers/taskCommentsController')
const taskActivityController = require('../controllers/taskActivityController')
const projectCyclesController = require('../controllers/projectCyclesController')
const issueAIController = require('../controllers/issueAIController')
const issueGitHubController = require('../controllers/issueGitHubController')

const router = express.Router()

// All routes require auth (attachAuth applied in app.js)
router.use(auth.requireAuth)

const view = [auth.requirePermission('planner', 'view')]
const manage = [auth.requirePermission('planner', 'manage')]

// ---- Projects ----
router.get('/dashboard', ...view, projectsController.getDashboard)
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
router.post('/:id/tasks', ...manage, projectTasksController.createTask)
router.patch('/:projectId/tasks/:taskId', ...manage, projectTasksController.updateTask)
router.delete('/:projectId/tasks/:taskId', ...manage, projectTasksController.deleteTask)

// ---- Comments (Phase 3) ----
router.get(
  '/:projectId/tasks/:taskId/comments',
  ...view,
  taskCommentsController.listComments
)
router.post(
  '/:projectId/tasks/:taskId/comments',
  ...manage,
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
  ...manage,
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

// ---- Attachments ----
router.post(
  '/:projectId/tasks/:taskId/attachments/upload-url',
  ...manage,
  projectTasksController.getAttachmentUploadUrl
)
router.post('/:projectId/tasks/:taskId/attachments', ...manage, projectTasksController.saveAttachment)
router.delete('/:projectId/tasks/:taskId/attachments/:attachId', ...manage, projectTasksController.deleteAttachment)
router.get(
  '/:projectId/tasks/:taskId/attachments/:attachId/download-url',
  ...view,
  projectTasksController.getAttachmentDownloadUrl
)

module.exports = router

const express = require('express')
const auth = require('../middleware/auth')
const projectsController = require('../controllers/projectsController')
const projectTasksController = require('../controllers/projectTasksController')
const taskCommentsController = require('../controllers/taskCommentsController')
const taskActivityController = require('../controllers/taskActivityController')
const projectCyclesController = require('../controllers/projectCyclesController')

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

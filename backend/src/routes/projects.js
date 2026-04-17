const express = require('express')
const { requireAuth } = require('../middleware/auth')
const projectsController = require('../controllers/projectsController')
const projectTasksController = require('../controllers/projectTasksController')

const router = express.Router()

// All routes require auth (attachAuth applied in app.js)
router.use(requireAuth)

// ---- Projects ----
router.get('/dashboard', projectsController.getDashboard)
router.get('/', projectsController.listProjects)
router.post('/', projectsController.createProject)
router.get('/:id', projectsController.getProject)
router.patch('/:id', projectsController.updateProject)
router.delete('/:id', projectsController.deleteProject)

// ---- Sections ----
router.post('/:id/sections', projectsController.createSection)
router.patch('/:id/sections/:sectionId', projectsController.updateSection)
router.delete('/:id/sections/:sectionId', projectsController.deleteSection)

// ---- Tasks ----
router.get('/:id/tasks', projectTasksController.listTasks)
router.post('/:id/tasks', projectTasksController.createTask)
router.patch('/:projectId/tasks/:taskId', projectTasksController.updateTask)
router.delete('/:projectId/tasks/:taskId', projectTasksController.deleteTask)

// ---- Dependencies ----
router.post('/:projectId/tasks/:taskId/dependencies', projectTasksController.addDependency)
router.delete('/:projectId/tasks/:taskId/dependencies/:depId', projectTasksController.removeDependency)

// ---- Attachments ----
router.post('/:projectId/tasks/:taskId/attachments/upload-url', projectTasksController.getAttachmentUploadUrl)
router.post('/:projectId/tasks/:taskId/attachments', projectTasksController.saveAttachment)
router.delete('/:projectId/tasks/:taskId/attachments/:attachId', projectTasksController.deleteAttachment)
router.get('/:projectId/tasks/:taskId/attachments/:attachId/download-url', projectTasksController.getAttachmentDownloadUrl)

module.exports = router

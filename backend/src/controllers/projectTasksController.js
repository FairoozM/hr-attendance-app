const projectTasksService = require('../services/projectTasksService')
const { recordLinearWorkspaceError } = require('../services/linearWorkspaceHealthService')
const {
  canCreateIssue,
  canDeleteIssue,
  canManageDependencies,
  canManageIssueAttachments,
  canViewLinear,
  getAllowedIssueUpdateFields,
} = require('../utils/linearPermissions')

function sendForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'You do not have permission to perform this action.',
  })
}

function getUserId(req) {
  return req.user?.userId || req.user?.id || null
}

function trackTaskError(route, error, fallbackStatus = 500) {
  recordLinearWorkspaceError({
    route,
    error,
    status: error?.status || fallbackStatus,
    module: 'projectTasksController',
  })
}

function pickAllowedFields(body, allowedFields) {
  const next = {}
  for (const key of allowedFields) {
    if (body[key] !== undefined) next[key] = body[key]
  }
  return next
}

async function listTasks(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const tasks = await projectTasksService.getTasksForProject(req.params.id, {
      sprintId: req.query?.sprint_id,
      assigneeId: req.query?.assignee_id,
      issueType: req.query?.issue_type,
      status: req.query?.status,
    })
    res.json(tasks)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks', err)
    console.error('[tasks] list error:', err)
    res.status(500).json({ error: 'Failed to load tasks', detail: String(err.message || '').slice(0, 240) })
  }
}

async function createTask(req, res) {
  try {
    if (!canCreateIssue(req.user)) return sendForbidden(res)
    const {
      title, description, status, priority, section_id, parent_task_id,
      start_date, due_date, estimated_hours, sort_order,
      assignee_user_id, reporter_user_id, issue_type, story_points, labels, sprint_id,
    } = req.body
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Task title is required' })
    }
    const task = await projectTasksService.createTask({
      project_id: Number(req.params.id),
      section_id: section_id || null,
      parent_task_id: parent_task_id || null,
      title: String(title).trim(),
      description,
      status,
      priority,
      start_date,
      due_date,
      estimated_hours,
      sort_order,
      created_by: getUserId(req),
      assignee_user_id: assignee_user_id || null,
      reporter_user_id: reporter_user_id || null,
      issue_type: issue_type || null,
      story_points: story_points || null,
      labels: labels || [],
      sprint_id: sprint_id || null,
    })
    res.status(201).json(task)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks', err)
    console.error('[tasks] create error:', err)
    res.status(500).json({ error: 'Failed to create task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function updateTask(req, res) {
  try {
    const existingTask = await projectTasksService.getTaskById(req.params.taskId)
    if (!existingTask) return res.status(404).json({ error: 'Task not found' })
    if (!canViewLinear(req.user)) return sendForbidden(res)

    const requestedKeys = Object.keys(req.body || {})
    if (requestedKeys.length === 0) {
      return res.json(existingTask)
    }

    const allowedFields = getAllowedIssueUpdateFields(req.user, existingTask)
    if (requestedKeys.length > 0 && allowedFields.size === 0) return sendForbidden(res)
    const filteredBody = pickAllowedFields(req.body || {}, allowedFields)
    if (Object.keys(filteredBody).length === 0) return sendForbidden(res)
    const task = await projectTasksService.updateTask(
      req.params.taskId,
      filteredBody,
      getUserId(req)
    )
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json(task)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId', err)
    console.error('[tasks] update error:', err)
    res.status(500).json({ error: 'Failed to update task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteTask(req, res) {
  try {
    if (!canDeleteIssue(req.user)) return sendForbidden(res)
    await projectTasksService.deleteTask(req.params.projectId, req.params.taskId, getUserId(req))
    res.json({ success: true })
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId', err)
    console.error('[tasks] delete error:', err)
    res.status(500).json({ error: 'Failed to delete task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function addDependency(req, res) {
  try {
    if (!canManageDependencies(req.user)) return sendForbidden(res)
    const { depends_on_task_id, dependency_type } = req.body
    if (!depends_on_task_id) {
      return res.status(400).json({ error: 'depends_on_task_id is required' })
    }
    const dep = await projectTasksService.addDependency(
      req.params.taskId,
      depends_on_task_id,
      dependency_type || 'finish-to-start'
    )
    res.status(201).json(dep || { success: true })
  } catch (err) {
    const status = err.status || 500
    trackTaskError('/api/projects/:projectId/tasks/:taskId/dependencies', err, status)
    console.error('[tasks] addDependency error:', err)
    res.status(status).json({ error: err.message || 'Failed to add dependency' })
  }
}

async function removeDependency(req, res) {
  try {
    if (!canManageDependencies(req.user)) return sendForbidden(res)
    await projectTasksService.removeDependency(req.params.depId)
    res.json({ success: true })
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/dependencies/:depId', err)
    console.error('[tasks] removeDependency error:', err)
    res.status(500).json({ error: 'Failed to remove dependency', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getAttachmentUploadUrl(req, res) {
  try {
    if (!canManageIssueAttachments(req.user)) return sendForbidden(res)
    const { fileName, contentType, fileSize } = req.body
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' })
    }
    const result = await projectTasksService.getAttachmentUploadUrl(req.params.taskId, { fileName, contentType, fileSize })
    res.json(result)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments/upload-url', err)
    console.error('[tasks] uploadUrl error:', err)
    res.status(500).json({ error: 'Failed to get upload URL', detail: String(err.message || '').slice(0, 240) })
  }
}

async function saveAttachment(req, res) {
  try {
    if (!canManageIssueAttachments(req.user)) return sendForbidden(res)
    const { s3Key, fileName, fileType, fileSize, kind } = req.body
    if (!s3Key || !fileName) {
      return res.status(400).json({ error: 's3Key and fileName are required' })
    }
    const attachment = await projectTasksService.saveAttachment(req.params.taskId, {
      s3Key,
      fileName,
      fileType,
      fileSize,
      kind,
      uploadedBy: getUserId(req),
    })
    res.status(201).json(attachment)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments', err)
    console.error('[tasks] saveAttachment error:', err)
    res.status(500).json({ error: 'Failed to save attachment', detail: String(err.message || '').slice(0, 240) })
  }
}

async function patchAttachment(req, res) {
  try {
    if (!canManageIssueAttachments(req.user)) return sendForbidden(res)
    const attachmentId = Number(req.params.attachId)
    const { kind } = req.body
    if (!kind) return res.status(400).json({ error: 'kind is required' })
    const att = await projectTasksService.patchAttachment(
      attachmentId, { kind }, getUserId(req)
    )
    res.json(att)
  } catch (err) {
    if (err.code === 'NOT_FOUND')    return res.status(404).json({ error: err.message })
    if (err.code === 'INVALID_KIND') return res.status(400).json({ error: err.message })
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments/:attachId', err)
    console.error('[tasks] patchAttachment error:', err)
    res.status(500).json({ error: 'Failed to update attachment', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteAttachment(req, res) {
  try {
    if (!canManageIssueAttachments(req.user)) return sendForbidden(res)
    await projectTasksService.deleteAttachment(req.params.attachId, getUserId(req))
    res.json({ success: true })
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments/:attachId', err)
    console.error('[tasks] deleteAttachment error:', err)
    res.status(500).json({ error: 'Failed to delete attachment', detail: String(err.message || '').slice(0, 240) })
  }
}

async function listAttachments(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const rows = await projectTasksService.listAttachments(req.params.taskId)
    res.json(rows)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments', err)
    console.error('[tasks] listAttachments error:', err)
    res.status(500).json({ error: 'Failed to list attachments', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getAttachmentDownloadUrl(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const result = await projectTasksService.getAttachmentDownloadUrl(req.params.attachId)
    if (!result) return res.status(404).json({ error: 'Attachment not found' })
    res.json(result)
  } catch (err) {
    trackTaskError('/api/projects/:projectId/tasks/:taskId/attachments/:attachId/download-url', err)
    console.error('[tasks] downloadUrl error:', err)
    res.status(500).json({ error: 'Failed to get download URL', detail: String(err.message || '').slice(0, 240) })
  }
}

module.exports = {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
  getAttachmentUploadUrl,
  saveAttachment,
  patchAttachment,
  deleteAttachment,
  getAttachmentDownloadUrl,
  listAttachments,
}

const projectTasksService = require('../services/projectTasksService')

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return false
  }
  return true
}

async function listTasks(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const tasks = await projectTasksService.getTasksForProject(req.params.id)
    res.json(tasks)
  } catch (err) {
    console.error('[tasks] list error:', err)
    res.status(500).json({ error: 'Failed to load tasks', detail: String(err.message || '').slice(0, 240) })
  }
}

async function createTask(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { title, description, status, priority, section_id, parent_task_id, start_date, due_date, estimated_hours, sort_order } = req.body
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Task title is required' })
    }
    const task = await projectTasksService.createTask({
      project_id: req.params.id,
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
      created_by: req.user.userId,
    })
    res.status(201).json(task)
  } catch (err) {
    console.error('[tasks] create error:', err)
    res.status(500).json({ error: 'Failed to create task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function updateTask(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const task = await projectTasksService.updateTask(req.params.taskId, req.body)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json(task)
  } catch (err) {
    console.error('[tasks] update error:', err)
    res.status(500).json({ error: 'Failed to update task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteTask(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    await projectTasksService.deleteTask(req.params.taskId)
    res.json({ success: true })
  } catch (err) {
    console.error('[tasks] delete error:', err)
    res.status(500).json({ error: 'Failed to delete task', detail: String(err.message || '').slice(0, 240) })
  }
}

async function addDependency(req, res) {
  try {
    if (!requireAdmin(req, res)) return
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
    console.error('[tasks] addDependency error:', err)
    res.status(status).json({ error: err.message || 'Failed to add dependency' })
  }
}

async function removeDependency(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    await projectTasksService.removeDependency(req.params.depId)
    res.json({ success: true })
  } catch (err) {
    console.error('[tasks] removeDependency error:', err)
    res.status(500).json({ error: 'Failed to remove dependency', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getAttachmentUploadUrl(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { fileName, contentType, fileSize } = req.body
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' })
    }
    const result = await projectTasksService.getAttachmentUploadUrl(req.params.taskId, { fileName, contentType, fileSize })
    res.json(result)
  } catch (err) {
    console.error('[tasks] uploadUrl error:', err)
    res.status(500).json({ error: 'Failed to get upload URL', detail: String(err.message || '').slice(0, 240) })
  }
}

async function saveAttachment(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { s3Key, fileName, fileType, fileSize } = req.body
    if (!s3Key || !fileName) {
      return res.status(400).json({ error: 's3Key and fileName are required' })
    }
    const attachment = await projectTasksService.saveAttachment(req.params.taskId, {
      s3Key,
      fileName,
      fileType,
      fileSize,
      uploadedBy: req.user.userId,
    })
    res.status(201).json(attachment)
  } catch (err) {
    console.error('[tasks] saveAttachment error:', err)
    res.status(500).json({ error: 'Failed to save attachment', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteAttachment(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    await projectTasksService.deleteAttachment(req.params.attachId)
    res.json({ success: true })
  } catch (err) {
    console.error('[tasks] deleteAttachment error:', err)
    res.status(500).json({ error: 'Failed to delete attachment', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getAttachmentDownloadUrl(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const result = await projectTasksService.getAttachmentDownloadUrl(req.params.attachId)
    if (!result) return res.status(404).json({ error: 'Attachment not found' })
    res.json(result)
  } catch (err) {
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
  deleteAttachment,
  getAttachmentDownloadUrl,
}

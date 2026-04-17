const { query } = require('../db')
const s3Service = require('./s3Service')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToTask(row) {
  return {
    ...row,
    progress_percent: parseInt(row.progress_percent || 0),
    sort_order: parseInt(row.sort_order || 0),
    estimated_hours: row.estimated_hours ? parseFloat(row.estimated_hours) : null,
    actual_hours: row.actual_hours ? parseFloat(row.actual_hours) : null,
  }
}

// ---------------------------------------------------------------------------
// Circular dependency detection (DFS)
// ---------------------------------------------------------------------------

/**
 * Returns true if adding an edge (taskId → dependsOnTaskId) would create a cycle.
 * Walks the existing dependency graph starting from dependsOnTaskId and checks
 * if taskId is reachable.
 */
async function wouldCreateCycle(taskId, dependsOnTaskId) {
  if (taskId === dependsOnTaskId) return true

  const visited = new Set()
  const stack = [dependsOnTaskId]

  while (stack.length > 0) {
    const current = stack.pop()
    if (visited.has(current)) continue
    visited.add(current)

    const deps = await query(
      `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1`,
      [current]
    )
    for (const dep of deps.rows) {
      const next = dep.depends_on_task_id
      if (next === taskId) return true
      if (!visited.has(next)) stack.push(next)
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function getTasksForProject(projectId) {
  const tasks = await query(
    `SELECT t.*
     FROM project_tasks t
     WHERE t.project_id = $1 AND t.archived = false
     ORDER BY t.sort_order ASC, t.id ASC`,
    [projectId]
  )

  const taskIds = tasks.rows.map((t) => t.id)
  if (taskIds.length === 0) return []

  const deps = await query(
    `SELECT td.*, t.title AS depends_on_title, t.status AS depends_on_status
     FROM task_dependencies td
     JOIN project_tasks t ON t.id = td.depends_on_task_id
     WHERE td.task_id = ANY($1::int[])`,
    [taskIds]
  )

  const attachments = await query(
    `SELECT * FROM task_attachments WHERE task_id = ANY($1::int[]) ORDER BY uploaded_at ASC`,
    [taskIds]
  )

  const depsByTask = {}
  for (const d of deps.rows) {
    if (!depsByTask[d.task_id]) depsByTask[d.task_id] = []
    depsByTask[d.task_id].push(d)
  }

  const attachsByTask = {}
  for (const a of attachments.rows) {
    if (!attachsByTask[a.task_id]) attachsByTask[a.task_id] = []
    attachsByTask[a.task_id].push(a)
  }

  const allTasks = tasks.rows.map((t) => ({
    ...rowToTask(t),
    dependencies: depsByTask[t.id] || [],
    attachments: attachsByTask[t.id] || [],
    subtasks: [],
  }))

  // Nest subtasks under parents
  const topLevel = []
  const byId = {}
  for (const t of allTasks) byId[t.id] = t
  for (const t of allTasks) {
    if (t.parent_task_id && byId[t.parent_task_id]) {
      byId[t.parent_task_id].subtasks.push(t)
    } else if (!t.parent_task_id) {
      topLevel.push(t)
    }
  }

  // Determine blocked state: task is blocked if any dependency is not Completed
  for (const t of allTasks) {
    t.is_blocked = t.dependencies.some((d) => d.depends_on_status !== 'Completed')
  }

  return topLevel
}

async function getTaskById(taskId) {
  const result = await query(`SELECT * FROM project_tasks WHERE id = $1`, [taskId])
  if (result.rowCount === 0) return null
  const task = rowToTask(result.rows[0])

  const deps = await query(
    `SELECT td.*, t.title AS depends_on_title, t.status AS depends_on_status
     FROM task_dependencies td
     JOIN project_tasks t ON t.id = td.depends_on_task_id
     WHERE td.task_id = $1`,
    [taskId]
  )
  task.dependencies = deps.rows

  const attachments = await query(
    `SELECT * FROM task_attachments WHERE task_id = $1 ORDER BY uploaded_at ASC`,
    [taskId]
  )
  task.attachments = attachments.rows

  const subtasks = await query(
    `SELECT * FROM project_tasks WHERE parent_task_id = $1 AND archived = false ORDER BY sort_order ASC, id ASC`,
    [taskId]
  )
  task.subtasks = subtasks.rows.map(rowToTask)
  task.is_blocked = task.dependencies.some((d) => d.depends_on_status !== 'Completed')

  return task
}

async function createTask({ project_id, section_id, parent_task_id, title, description, status, priority, start_date, due_date, estimated_hours, sort_order, created_by }) {
  const maxOrder = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM project_tasks WHERE project_id = $1 AND section_id IS NOT DISTINCT FROM $2`,
    [project_id, section_id || null]
  )
  const nextOrder = sort_order ?? parseInt(maxOrder.rows[0].next_order || 0)

  const result = await query(
    `INSERT INTO project_tasks
       (project_id, section_id, parent_task_id, title, description, status, priority,
        start_date, due_date, estimated_hours, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      project_id,
      section_id || null,
      parent_task_id || null,
      title,
      description || '',
      status || 'Not Started',
      priority || 'Medium',
      start_date || null,
      due_date || null,
      estimated_hours || null,
      nextOrder,
      created_by || null,
    ]
  )
  return rowToTask(result.rows[0])
}

async function updateTask(taskId, fields) {
  const allowed = [
    'title', 'description', 'status', 'priority', 'start_date', 'due_date',
    'section_id', 'parent_task_id', 'estimated_hours', 'actual_hours',
    'progress_percent', 'sort_order', 'archived',
  ]
  const sets = []
  const values = []
  let idx = 1

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`)
      values.push(fields[key] === '' ? null : fields[key])
      idx++
    }
  }

  if (fields.status === 'Completed') {
    sets.push(`completed_at = NOW()`)
  } else if (fields.status && fields.status !== 'Completed') {
    sets.push(`completed_at = NULL`)
  }

  if (sets.length === 0) return getTaskById(taskId)
  sets.push(`updated_at = NOW()`)
  values.push(taskId)

  await query(
    `UPDATE project_tasks SET ${sets.join(', ')} WHERE id = $${idx}`,
    values
  )
  return getTaskById(taskId)
}

async function deleteTask(taskId) {
  // Attachments: delete S3 objects first
  const attachments = await query(`SELECT s3_key FROM task_attachments WHERE task_id = $1`, [taskId])
  for (const a of attachments.rows) {
    await s3Service.deleteObjectIfExists(a.s3_key).catch(() => {})
  }
  await query(`DELETE FROM project_tasks WHERE id = $1`, [taskId])
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

async function addDependency(taskId, dependsOnTaskId, dependencyType = 'finish-to-start') {
  if (await wouldCreateCycle(parseInt(taskId), parseInt(dependsOnTaskId))) {
    const err = new Error('Circular dependency detected')
    err.status = 400
    throw err
  }
  const result = await query(
    `INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
     RETURNING *`,
    [taskId, dependsOnTaskId, dependencyType]
  )
  return result.rows[0]
}

async function removeDependency(dependencyId) {
  await query(`DELETE FROM task_dependencies WHERE id = $1`, [dependencyId])
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

async function getAttachmentUploadUrl(taskId, { fileName, contentType, fileSize }) {
  const s3Key = s3Service.createTaskAttachmentKey(taskId, fileName)
  const uploadUrl = await s3Service.getUploadUrl({ key: s3Key, contentType })
  return { uploadUrl, s3Key }
}

async function saveAttachment(taskId, { s3Key, fileName, fileType, fileSize, uploadedBy }) {
  const result = await query(
    `INSERT INTO task_attachments (task_id, file_name, s3_key, file_type, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [taskId, fileName, s3Key, fileType || null, fileSize || null, uploadedBy || null]
  )
  return result.rows[0]
}

async function deleteAttachment(attachmentId) {
  const result = await query(`SELECT s3_key FROM task_attachments WHERE id = $1`, [attachmentId])
  if (result.rowCount > 0) {
    await s3Service.deleteObjectIfExists(result.rows[0].s3_key).catch(() => {})
  }
  await query(`DELETE FROM task_attachments WHERE id = $1`, [attachmentId])
}

async function getAttachmentDownloadUrl(attachmentId) {
  const result = await query(`SELECT * FROM task_attachments WHERE id = $1`, [attachmentId])
  if (result.rowCount === 0) return null
  const attachment = result.rows[0]
  const url = await s3Service.getDownloadUrl({ key: attachment.s3_key })
  return { ...attachment, downloadUrl: url }
}

module.exports = {
  getTasksForProject,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
  getAttachmentUploadUrl,
  saveAttachment,
  deleteAttachment,
  getAttachmentDownloadUrl,
  wouldCreateCycle,
}

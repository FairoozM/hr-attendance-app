const { query } = require('../db')

async function assertTaskInProject(projectId, taskId) {
  const result = await query(
    `SELECT id FROM project_tasks WHERE id = $1 AND project_id = $2`,
    [taskId, projectId]
  )
  if (result.rowCount === 0) {
    const err = new Error('Issue not found in this project')
    err.status = 404
    throw err
  }
}

async function logActivity(taskId, userId, action, oldValue = null, newValue = null, meta = {}) {
  await query(
    `INSERT INTO task_activity_log (task_id, user_id, action, old_value, new_value, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      taskId,
      userId || null,
      action,
      oldValue != null ? String(oldValue) : null,
      newValue != null ? String(newValue) : null,
      JSON.stringify(meta && typeof meta === 'object' ? meta : {}),
    ]
  )
}

async function listActivityForTask(projectId, taskId) {
  await assertTaskInProject(projectId, taskId)
  const { rows } = await query(
    `SELECT a.*,
            u.username,
            e.full_name AS employee_full_name
     FROM task_activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE a.task_id = $1
     ORDER BY a.created_at DESC`,
    [taskId]
  )
  return rows.map((row) => ({
    ...row,
    author_name: row.employee_full_name || row.username || null,
  }))
}

/**
 * Compare before/after task rows and append activity entries for changed fields.
 */
async function logTaskFieldChanges(before, after, fields, actorUserId) {
  if (!before || !after || !actorUserId) return

  const track = [
    ['status', 'status_changed'],
    ['priority', 'priority_changed'],
    ['assignee_user_id', 'assignee_changed'],
    ['issue_type', 'issue_type_changed'],
    ['title', 'title_changed'],
    ['due_date', 'due_date_changed'],
    ['story_points', 'story_points_changed'],
    ['blocked_reason', 'blocked_reason_changed'],
    ['sprint_id', 'cycle_changed'],
  ]

  for (const [key, action] of track) {
    if (fields[key] === undefined) continue
    const oldVal = before[key]
    const newVal = after[key]
    const oldStr = oldVal == null ? '' : String(oldVal)
    const newStr = newVal == null ? '' : String(newVal)
    if (oldStr !== newStr) {
      await logActivity(after.id, actorUserId, action, oldStr || null, newStr || null)
    }
  }

  if (fields.description !== undefined && String(before.description || '') !== String(after.description || '')) {
    await logActivity(after.id, actorUserId, 'description_updated', null, null, { truncated: true })
  }

  if (fields.dev_meta !== undefined) {
    // Log a single compact activity entry when dev metadata changes
    const beforeMeta = before.dev_meta || {}
    const afterMeta  = after.dev_meta  || {}
    const changed = Object.keys(afterMeta).some((k) => {
      const bv = beforeMeta[k] == null ? '' : String(beforeMeta[k])
      const av = afterMeta[k]  == null ? '' : String(afterMeta[k])
      return bv !== av
    })
    if (changed) {
      await logActivity(after.id, actorUserId, 'dev_meta_updated', null, null, { summary: 'Dev metadata updated' })
    }
  }
}

module.exports = {
  assertTaskInProject,
  logActivity,
  listActivityForTask,
  logTaskFieldChanges,
}

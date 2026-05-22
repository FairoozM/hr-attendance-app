const { query } = require('../db')
const { assertTaskInProject } = require('./taskActivityService')
const taskActivityService = require('./taskActivityService')

async function listCommentsForTask(projectId, taskId) {
  await assertTaskInProject(projectId, taskId)
  const { rows } = await query(
    `SELECT c.*,
            u.username,
            e.full_name AS employee_full_name
     FROM task_comments c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE c.task_id = $1
     ORDER BY c.created_at ASC`,
    [taskId]
  )
  return rows.map((row) => ({
    ...row,
    author_name: row.employee_full_name || row.username || null,
  }))
}

async function createComment(projectId, taskId, { body, user_id }) {
  await assertTaskInProject(projectId, taskId)
  const text = String(body || '').trim()
  if (!text) {
    const err = new Error('Comment body is required')
    err.status = 400
    throw err
  }

  const { rows } = await query(
    `INSERT INTO task_comments (task_id, user_id, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [taskId, user_id || null, text]
  )
  const comment = rows[0]

  if (user_id) {
    await taskActivityService.logActivity(taskId, user_id, 'comment_added', null, null, {
      comment_id: comment.id,
    })
  }

  const enriched = await query(
    `SELECT c.*, u.username, e.full_name AS employee_full_name
     FROM task_comments c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE c.id = $1`,
    [comment.id]
  )
  const row = enriched.rows[0]
  return {
    ...row,
    author_name: row.employee_full_name || row.username || null,
  }
}

module.exports = {
  listCommentsForTask,
  createComment,
}

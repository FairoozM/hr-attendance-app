const taskCommentsService = require('../services/taskCommentsService')

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return false
  }
  return true
}

async function listComments(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const comments = await taskCommentsService.listCommentsForTask(
      req.params.projectId,
      req.params.taskId
    )
    res.json(comments)
  } catch (err) {
    const status = err.status || 500
    console.error('[comments] list error:', err)
    res.status(status).json({ error: err.message || 'Failed to load comments' })
  }
}

async function createComment(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const comment = await taskCommentsService.createComment(
      req.params.projectId,
      req.params.taskId,
      { body: req.body.body, user_id: req.user.userId }
    )
    res.status(201).json(comment)
  } catch (err) {
    const status = err.status || 500
    console.error('[comments] create error:', err)
    res.status(status).json({ error: err.message || 'Failed to add comment' })
  }
}

module.exports = {
  listComments,
  createComment,
}

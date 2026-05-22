const taskActivityService = require('../services/taskActivityService')

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return false
  }
  return true
}

async function listActivity(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const rows = await taskActivityService.listActivityForTask(
      req.params.projectId,
      req.params.taskId
    )
    res.json(rows)
  } catch (err) {
    const status = err.status || 500
    console.error('[activity] list error:', err)
    res.status(status).json({ error: err.message || 'Failed to load activity' })
  }
}

module.exports = {
  listActivity,
}

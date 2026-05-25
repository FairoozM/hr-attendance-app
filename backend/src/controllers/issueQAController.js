const { approveQA, revokeQA } = require('../services/issueQAService')

/**
 * POST /api/projects/:projectId/tasks/:taskId/qa/approve
 * Body: { notes?: string, moveToQaApproved?: boolean }
 */
async function approve(req, res) {
  const projectId = Number(req.params.projectId)
  const taskId    = Number(req.params.taskId)
  if (!projectId || !taskId) return res.status(400).json({ error: 'Invalid route parameters.' })

  const { notes = '', moveToQaApproved = true } = req.body
  try {
    const task = await approveQA(taskId, projectId, { notes, moveToQaApproved }, req.user?.userId)
    return res.json(task)
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message })
    console.error('[qa] approve error:', err.message)
    return res.status(500).json({ error: err.message || 'Failed to approve QA.' })
  }
}

/**
 * POST /api/projects/:projectId/tasks/:taskId/qa/revoke
 */
async function revoke(req, res) {
  const projectId = Number(req.params.projectId)
  const taskId    = Number(req.params.taskId)
  if (!projectId || !taskId) return res.status(400).json({ error: 'Invalid route parameters.' })

  try {
    const task = await revokeQA(taskId, projectId, req.user?.userId)
    return res.json(task)
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message })
    console.error('[qa] revoke error:', err.message)
    return res.status(500).json({ error: err.message || 'Failed to revoke QA approval.' })
  }
}

module.exports = { approve, revoke }

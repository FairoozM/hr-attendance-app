const { analyzeAttachment } = require('../services/attachmentAIService')

/**
 * POST /api/projects/:projectId/tasks/:taskId/attachments/:attachmentId/ai/analyze
 *
 * Returns:
 *   { success: true, analysis: { summary, observations, suggestedIssueDescription,
 *                                acceptanceCriteria, qaChecklist, cursorPrompt } }
 * or
 *   { success: false, message: '...' }
 */
async function analyze(req, res) {
  const projectId    = Number(req.params.projectId)
  const taskId       = Number(req.params.taskId)
  const attachmentId = Number(req.params.attachmentId)

  if (!projectId || !taskId || !attachmentId) {
    return res.status(400).json({ success: false, message: 'Invalid route parameters.' })
  }

  try {
    const analysis = await analyzeAttachment({
      projectId,
      taskId,
      attachmentId,
      reqUser: req.user || null,
    })
    return res.json({ success: true, analysis })
  } catch (err) {
    const code = err.code || ''

    if (code === 'NOT_FOUND')       return res.status(404).json({ success: false, message: err.message })
    if (code === 'UNSUPPORTED_TYPE') return res.status(400).json({ success: false, message: err.message })
    if (code === 'FILE_TOO_LARGE')  return res.status(413).json({ success: false, message: err.message })
    if (code === 'S3_FETCH_FAILED') return res.status(503).json({ success: false, message: err.message })
    if (code === 'AI_DISABLED')     return res.status(503).json({ success: false, message: 'AI generation is currently disabled.' })
    if (code === 'BUDGET_EXCEEDED') return res.status(402).json({ success: false, message: 'AI budget limit reached. Please try again later.' })

    console.error('[attachment-ai] Unexpected error:', err.message, err.cause || '')
    return res.status(500).json({ success: false, message: err.message || 'Image analysis failed. Please try again.' })
  }
}

module.exports = { analyze }

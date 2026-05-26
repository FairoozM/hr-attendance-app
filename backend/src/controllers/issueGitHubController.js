/**
 * issueGitHubController.js
 * POST /api/projects/:projectId/tasks/:taskId/github/sync-pr
 * Validates the PR URL, fetches GitHub metadata server-side, updates dev_meta.
 */
'use strict'

const { syncPrMetadata, parsePrUrl } = require('../services/githubPrService')
const projectTasksService = require('../services/projectTasksService')
const { canUseGitHubSync } = require('../utils/linearPermissions')

function sendForbidden(res) {
  return res.status(403).json({
    success: false,
    error: 'Forbidden',
    message: 'You do not have permission to perform this action.',
  })
}

async function syncPr(req, res) {
  const projectId = Number(req.params.projectId)
  const taskId    = Number(req.params.taskId)
  const { prUrl } = req.body || {}

  if (!prUrl || typeof prUrl !== 'string' || !prUrl.trim()) {
    return res.status(400).json({ success: false, message: 'prUrl is required.' })
  }

  if (!parsePrUrl(prUrl)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid GitHub pull request URL. Expected: https://github.com/owner/repo/pull/123',
    })
  }

  try {
    const task = await projectTasksService.getTaskById(taskId)
    if (!task || Number(task.project_id) !== projectId) {
      return res.status(404).json({ success: false, message: 'Issue not found.' })
    }
    if (!canUseGitHubSync(req.user, task)) {
      return sendForbidden(res)
    }
    const { devMeta } = await syncPrMetadata({
      taskId,
      projectId,
      prUrl: prUrl.trim(),
      actorUserId: req.user?.userId || null,
    })
    return res.json({ success: true, devMeta })
  } catch (err) {
    // Map known error codes to appropriate HTTP status + clean message
    const code = err.code || ''
    if (code === 'MISSING_GITHUB_TOKEN') {
      return res.status(503).json({ success: false, message: err.message })
    }
    if (code === 'INVALID_PR_URL') {
      return res.status(400).json({ success: false, message: err.message })
    }
    if (code === 'GITHUB_AUTH_ERROR') {
      return res.status(403).json({ success: false, message: err.message })
    }
    if (code === 'GITHUB_NOT_FOUND') {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (code === 'GITHUB_RATE_LIMIT') {
      return res.status(429).json({ success: false, message: err.message })
    }
    console.error('[github sync-pr] error:', err.message)
    return res.status(500).json({ success: false, message: err.message || 'GitHub sync failed.' })
  }
}

module.exports = { syncPr }

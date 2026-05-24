/**
 * issueAIController.js
 * POST /api/projects/:projectId/tasks/:taskId/ai/assist
 * Requires planner view permission + AI budget check.
 */
'use strict'

const { runIssueAIAction } = require('../services/issueAIService')
const { getBudgetSettings } = require('../services/aiBudgetService')
const { AiGenerationDisabledError, BudgetBlockedError } = require('../services/aiRequestService')
const { query } = require('../db')

const VALID_ACTIONS = [
  'improve_title',
  'draft_description',
  'acceptance_criteria',
  'qa_checklist',
  'cursor_prompt',
  'release_note',
]

async function aiAssist(req, res) {
  const projectId = Number(req.params.projectId)
  const taskId    = Number(req.params.taskId)
  const { action, extra_context: extraContext } = req.body || {}

  // Validate action
  if (!action || !VALID_ACTIONS.includes(action)) {
    return res.status(400).json({
      success: false,
      message: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`,
    })
  }

  // Fetch task + project (lightweight — just need the fields for prompting)
  let issue, project
  try {
    const taskResult = await query(
      `SELECT id, project_id, title, description, status, priority,
              issue_type, labels, blocked_reason, due_date, story_points
       FROM project_tasks WHERE id = $1 AND project_id = $2`,
      [taskId, projectId]
    )
    if (!taskResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Issue not found' })
    }
    issue = taskResult.rows[0]

    const projResult = await query(
      `SELECT id, name FROM projects WHERE id = $1`,
      [projectId]
    )
    project = projResult.rows[0] || { id: projectId, name: '' }
  } catch (err) {
    console.error('[issueAI] DB error:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to load issue' })
  }

  // Fetch budget settings once (avoids double DB hit inside service)
  let cachedSettings
  try {
    cachedSettings = await getBudgetSettings()
  } catch {
    return res.status(500).json({ success: false, message: 'AI settings unavailable' })
  }

  try {
    const result = await runIssueAIAction({
      issue,
      project,
      action,
      extraContext: extraContext || '',
      reqUser: req.user,
      cachedSettings,
    })
    return res.json({ success: true, action: result.action, output: result.output })
  } catch (err) {
    if (err instanceof AiGenerationDisabledError) {
      return res.status(503).json({ success: false, message: 'AI generation is disabled in settings.' })
    }
    if (err instanceof BudgetBlockedError) {
      return res.status(429).json({ success: false, message: 'AI budget limit reached.' })
    }
    if (err.code === 'MISSING_API_KEY') {
      return res.status(503).json({ success: false, message: 'AI is not configured on this server (no API key).' })
    }
    if (err.code === 'UNKNOWN_ACTION') {
      return res.status(400).json({ success: false, message: err.message })
    }
    console.error('[issueAI] error:', err.message)
    return res.status(500).json({ success: false, message: err.message || 'AI request failed' })
  }
}

module.exports = { aiAssist }

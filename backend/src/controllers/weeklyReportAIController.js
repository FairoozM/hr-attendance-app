/**
 * weeklyReportAIController.js
 * Handles POST /api/projects/linear/reports/weekly/ai-summary
 *
 * Accepts reportData + action, runs AI, returns { success, action, output }.
 * No DB mutations. No issue status changes.
 */
'use strict'

const { generateWeeklyReportSummary, VALID_ACTIONS } = require('../services/weeklyReportAIService')
const { BudgetBlockedError, AiGenerationDisabledError } = require('../services/aiRequestService')
const { getApiKey } = require('../services/openaiService')

async function generateSummary(req, res) {
  const { action, reportData } = req.body || {}

  // Validate action
  if (!action || !VALID_ACTIONS.includes(action)) {
    return res.status(400).json({
      success: false,
      message: `Invalid action. Valid actions: ${VALID_ACTIONS.join(', ')}`,
    })
  }

  // Check API key configured early for a clean error
  if (!getApiKey()) {
    return res.status(200).json({
      success: false,
      message: 'AI summary is not configured. Please add OPENAI_API_KEY to your server environment.',
    })
  }

  if (!reportData || typeof reportData !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'reportData is required and must be an object.',
    })
  }

  try {
    const { output } = await generateWeeklyReportSummary({
      action,
      reportData,
      reqUser: req.user,
    })

    return res.json({ success: true, action, output })
  } catch (err) {
    const code = err?.code || ''

    if (err instanceof AiGenerationDisabledError || code === 'AI_GENERATION_DISABLED') {
      return res.status(200).json({
        success: false,
        message: 'AI generation is disabled in settings. Enable it under Settings → AI.',
      })
    }

    if (err instanceof BudgetBlockedError || code === 'BUDGET_EXCEEDED') {
      return res.status(200).json({
        success: false,
        message: 'AI monthly budget exceeded. Contact your administrator.',
      })
    }

    if (code === 'MISSING_API_KEY') {
      return res.status(200).json({
        success: false,
        message: 'AI summary is not configured. Please add OPENAI_API_KEY to your server environment.',
      })
    }

    if (code === 'OPENAI_TIMEOUT') {
      return res.status(200).json({
        success: false,
        message: 'AI request timed out. Please try again.',
      })
    }

    if (code === 'EMPTY_RESPONSE') {
      return res.status(200).json({
        success: false,
        message: 'AI returned an empty response. Please try again.',
      })
    }

    console.error('[weeklyReportAI]', err.message || err)
    return res.status(200).json({
      success: false,
      message: `AI request failed: ${err?.message || 'Unknown error'}`,
    })
  }
}

module.exports = { generateSummary }

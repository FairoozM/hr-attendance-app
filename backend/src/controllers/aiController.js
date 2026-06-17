const { getBudgetSettings } = require('../services/aiBudgetService')
const {
  aggregateDashboard,
  listRecentLogs,
  getDailyTrend,
  getModelUsageMonth,
} = require('../services/aiUsageService')
const { getApiKey } = require('../services/aiRequestService')
const { testOpenAI } = require('../services/openaiService')

/**
 * GET /api/ai/usage/summary
 */
async function getUsageSummary(req, res) {
  const settings = await getBudgetSettings()
  const agg = await aggregateDashboard()

  const dailyLimit = settings?.daily_budget_usd ?? 0
  const monthlyLimit = settings?.monthly_budget_usd ?? 0
  const threshold = (settings?.alert_threshold_percent ?? 80) / 100

  const remainingDaily = Math.max(0, dailyLimit - agg.todayCost)
  const remainingMonthly = Math.max(0, monthlyLimit - agg.monthCost)

  const dailyRatio = dailyLimit > 0 ? agg.todayCost / dailyLimit : 0
  const monthlyRatio = monthlyLimit > 0 ? agg.monthCost / monthlyLimit : 0

  const [trend, models] = await Promise.all([getDailyTrend(14), getModelUsageMonth()])

  res.json({
    todayCost: agg.todayCost,
    monthCost: agg.monthCost,
    totalTokensUsed: agg.totalTokensAllTime,
    productsGenerated: agg.productsGenerated,
    avgCostPerRequest: agg.avgCostPerRequest,
    failedRequestsMonth: agg.failedRequestsMonth,
    remainingBudgetDaily: remainingDaily,
    remainingBudgetMonthly: remainingMonthly,
    limits: {
      daily_budget_usd: dailyLimit,
      monthly_budget_usd: monthlyLimit,
      alert_threshold_percent: settings?.alert_threshold_percent ?? 80,
    },
    alerts: {
      dailyNearOrOver: dailyRatio >= threshold,
      monthlyNearOrOver: monthlyRatio >= threshold,
    },
    usageByModule: agg.byModule,
    usageTrend: trend,
    modelUsageMonth: models,
    openaiConfigured: Boolean(getApiKey()),
    allow_ai_generation: settings?.allow_ai_generation ?? false,
    default_model: settings?.default_model ?? 'gpt-4.1-mini',
  })
}

/**
 * GET /api/ai/usage/recent?limit=
 */
async function getRecentUsage(req, res) {
  const limit = req.query?.limit
  const rows = await listRecentLogs(limit)
  res.json({ items: rows })
}

/**
 * GET /api/ai/test-openai — verifies OPENAI_API_KEY and chat completions for `default_model`.
 */
async function getTestOpenAI(req, res) {
  try {
    const result = await testOpenAI()
    res.json({
      success: true,
      reply: result.reply,
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
      },
    })
  } catch (err) {
    const code = err?.code || (err?.name === 'OpenAIServiceError' ? err.code : undefined)

    if (code === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        error: 'OPENAI_API_KEY is not set on the server',
        code: 'MISSING_API_KEY',
        usage: null,
      })
    }

    if (err?.name === 'OpenAIServiceError') {
      return res.status(502).json({
        success: false,
        error: err.message || 'OpenAI request failed',
        code: code || 'OPENAI_ERROR',
        usage: null,
      })
    }

    console.error('[ai] GET /test-openai:', err)
    return res.status(500).json({
      success: false,
      error: 'Unexpected error while testing OpenAI',
      code: 'INTERNAL_ERROR',
      usage: null,
    })
  }
}

module.exports = {
  getUsageSummary,
  getRecentUsage,
  getTestOpenAI,
}

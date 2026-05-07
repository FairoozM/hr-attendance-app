const { getBudgetSettings } = require('../services/aiBudgetService')
const {
  aggregateDashboard,
  listRecentLogs,
  getDailyTrend,
  getModelUsageMonth,
} = require('../services/aiUsageService')
const { getApiKey } = require('../services/aiRequestService')

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

module.exports = {
  getUsageSummary,
  getRecentUsage,
}

const { query } = require('../db')
const { getTodaySuccessfulSpend, getMonthSuccessfulSpend } = require('./aiUsageService')

class BudgetBlockedError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'BudgetBlockedError'
    this.code = 'BUDGET_EXCEEDED'
    this.details = details
  }
}

class AiGenerationDisabledError extends Error {
  constructor() {
    super('AI generation is disabled by an administrator.')
    this.name = 'AiGenerationDisabledError'
    this.code = 'AI_DISABLED'
  }
}

function normalizeSettingsRow(row) {
  if (!row) return null
  return {
    daily_budget_usd: Number(row.daily_budget_usd),
    monthly_budget_usd: Number(row.monthly_budget_usd),
    alert_threshold_percent: Number(row.alert_threshold_percent),
    default_model: row.default_model,
    max_batch_size: Number(row.max_batch_size),
    allow_ai_generation: Boolean(row.allow_ai_generation),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function getBudgetSettings() {
  const r = await query(`SELECT * FROM ai_budget_settings WHERE id = 1`)
  return normalizeSettingsRow(r.rows[0])
}

async function updateBudgetSettings(patch) {
  const cur = await getBudgetSettings()
  if (!cur) throw new Error('AI budget settings row missing')

  const next = {
    daily_budget_usd:
      patch.daily_budget_usd != null ? Number(patch.daily_budget_usd) : cur.daily_budget_usd,
    monthly_budget_usd:
      patch.monthly_budget_usd != null ? Number(patch.monthly_budget_usd) : cur.monthly_budget_usd,
    alert_threshold_percent:
      patch.alert_threshold_percent != null
        ? Number(patch.alert_threshold_percent)
        : cur.alert_threshold_percent,
    default_model:
      patch.default_model != null ? String(patch.default_model).trim() : cur.default_model,
    max_batch_size:
      patch.max_batch_size != null ? Number(patch.max_batch_size) : cur.max_batch_size,
    allow_ai_generation:
      patch.allow_ai_generation != null ? Boolean(patch.allow_ai_generation) : cur.allow_ai_generation,
  }

  if (!(next.daily_budget_usd >= 0) || !(next.monthly_budget_usd >= 0)) {
    const err = new Error('Budget amounts must be non-negative numbers')
    err.code = 'VALIDATION'
    throw err
  }
  if (!(next.alert_threshold_percent >= 0 && next.alert_threshold_percent <= 100)) {
    const err = new Error('alert_threshold_percent must be between 0 and 100')
    err.code = 'VALIDATION'
    throw err
  }
  if (!next.default_model) {
    const err = new Error('default_model is required')
    err.code = 'VALIDATION'
    throw err
  }
  if (!(next.max_batch_size >= 1 && next.max_batch_size <= 500)) {
    const err = new Error('max_batch_size must be between 1 and 500')
    err.code = 'VALIDATION'
    throw err
  }

  await query(
    `UPDATE ai_budget_settings SET
      daily_budget_usd = $1,
      monthly_budget_usd = $2,
      alert_threshold_percent = $3,
      default_model = $4,
      max_batch_size = $5,
      allow_ai_generation = $6,
      updated_at = NOW()
    WHERE id = 1`,
    [
      next.daily_budget_usd,
      next.monthly_budget_usd,
      next.alert_threshold_percent,
      next.default_model,
      next.max_batch_size,
      next.allow_ai_generation,
    ]
  )
  return getBudgetSettings()
}

async function assertBudgetAllowsRequest(settings) {
  const dailyLimit = Number(settings.daily_budget_usd)
  const monthlyLimit = Number(settings.monthly_budget_usd)
  const dailySpend = await getTodaySuccessfulSpend()
  const monthlySpend = await getMonthSuccessfulSpend()

  if (dailySpend >= dailyLimit) {
    throw new BudgetBlockedError('Daily AI budget exceeded', {
      scope: 'daily',
      spend: dailySpend,
      limit: dailyLimit,
    })
  }
  if (monthlySpend >= monthlyLimit) {
    throw new BudgetBlockedError('Monthly AI budget exceeded', {
      scope: 'monthly',
      spend: monthlySpend,
      limit: monthlyLimit,
    })
  }
  return { dailySpend, monthlySpend, dailyLimit, monthlyLimit }
}

module.exports = {
  getBudgetSettings,
  updateBudgetSettings,
  normalizeSettingsRow,
  assertBudgetAllowsRequest,
  BudgetBlockedError,
  AiGenerationDisabledError,
}

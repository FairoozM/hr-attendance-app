const { getBudgetSettings, updateBudgetSettings } = require('../services/aiBudgetSettingsService')

/**
 * GET /api/admin/ai/budget-settings
 */
async function getBudgetSettingsHandler(_req, res) {
  const s = await getBudgetSettings()
  res.json({ settings: s })
}

/**
 * PUT /api/admin/ai/budget-settings
 */
async function putBudgetSettingsHandler(req, res) {
  try {
    const body = req.body || {}
    const updated = await updateBudgetSettings({
      daily_budget_usd: body.daily_budget_usd,
      monthly_budget_usd: body.monthly_budget_usd,
      alert_threshold_percent: body.alert_threshold_percent,
      default_model: body.default_model,
      max_batch_size: body.max_batch_size,
      allow_ai_generation: body.allow_ai_generation,
    })
    res.json({ settings: updated })
  } catch (err) {
    if (err?.code === 'VALIDATION') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[admin ai budget]', err)
    return res.status(500).json({ error: 'Failed to update AI budget settings' })
  }
}

module.exports = {
  getBudgetSettingsHandler,
  putBudgetSettingsHandler,
}

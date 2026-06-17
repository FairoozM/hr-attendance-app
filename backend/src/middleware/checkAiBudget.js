const {
  getBudgetSettings,
  assertBudgetAllowsRequest,
  BudgetBlockedError,
  AiGenerationDisabledError,
} = require('../services/aiBudgetService')
const { logBlockedAttempt, parseUserIdInt } = require('../services/aiRequestService')

/**
 * Pre-flight budget + kill-switch before expensive OpenAI calls.
 * Sets req.aiBudgetVerified = true and req.aiBudgetSettings when allowed.
 */
async function checkAiBudget(req, res, next) {
  const meta = req.aiRouteMeta || { moduleName: 'ai', actionName: 'request' }
  const userIdInt = parseUserIdInt(req.user)

  try {
    const settings = await getBudgetSettings()
    if (!settings) {
      return res.status(500).json({ success: false, message: 'AI budget settings unavailable' })
    }

    req.aiBudgetSettings = settings

    if (!settings.allow_ai_generation) {
      await logBlockedAttempt({
        userIdInt,
        moduleName: meta.moduleName,
        actionName: meta.actionName,
        model: settings.default_model,
        status: 'blocked_disabled',
        message: 'AI generation disabled in settings',
      })
      return res.status(403).json({
        success: false,
        message: 'AI generation is disabled by an administrator.',
      })
    }

    try {
      await assertBudgetAllowsRequest(settings)
    } catch (e) {
      if (e instanceof BudgetBlockedError) {
        await logBlockedAttempt({
          userIdInt,
          moduleName: meta.moduleName,
          actionName: meta.actionName,
          model: settings.default_model,
          status: 'blocked_budget',
          message: e.message,
        })
        const msg =
          e.details?.scope === 'monthly'
            ? 'Monthly AI budget exceeded'
            : e.details?.scope === 'daily'
              ? 'Daily AI budget exceeded'
              : e.message
        return res.status(403).json({ success: false, message: msg })
      }
      throw e
    }

    req.aiBudgetVerified = true
    next()
  } catch (err) {
    if (err instanceof AiGenerationDisabledError) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

module.exports = { checkAiBudget }

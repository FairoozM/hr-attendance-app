const {
  getBudgetSettings,
  assertBudgetAllowsRequest,
  BudgetBlockedError,
  AiGenerationDisabledError,
} = require('./aiBudgetService')
const { insertUsageLog } = require('./aiUsageService')
const { estimateCostUsd } = require('../utils/aiCostCalculator')
const { completeChatJson, getApiKey } = require('./openaiService')

function parseUserIdInt(reqUser) {
  const raw = reqUser?.userId
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function logBlockedAttempt({
  userIdInt,
  moduleName,
  actionName,
  model,
  status,
  message,
}) {
  await insertUsageLog({
    user_id: userIdInt,
    module_name: moduleName,
    action_name: actionName,
    model: model || 'n/a',
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    request_status: status,
    error_message: message ? String(message).slice(0, 2000) : null,
    request_duration_ms: null,
  })
}

/**
 * Tracked OpenAI JSON chat: budget enforcement, usage logging, duration.
 *
 * @param {object} opts
 * @param {object|null} opts.reqUser
 * @param {string} opts.moduleName
 * @param {string} opts.actionName
 * @param {string} [opts.model]
 * @param {import('openai').OpenAI.Chat.ChatCompletionMessageParam[]} opts.messages
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.budgetPrechecked] — when middleware already verified budget + allow flag
 * @param {object} [opts.cachedSettings] — optional settings row when budgetPrechecked
 */
async function runOpenAiJsonChat(opts) {
  const settings = opts.cachedSettings || (await getBudgetSettings())
  if (!settings) throw new Error('AI settings unavailable')

  const userIdInt = opts.reqUser ? parseUserIdInt(opts.reqUser) : null
  const moduleName = String(opts.moduleName || 'unknown')
  const actionName = String(opts.actionName || 'unknown')
  const model = String(opts.model || settings.default_model || 'gpt-4.1-mini').trim()

  if (!opts.budgetPrechecked) {
    if (!settings.allow_ai_generation) {
      await logBlockedAttempt({
        userIdInt,
        moduleName,
        actionName,
        model,
        status: 'blocked_disabled',
        message: 'AI generation disabled in settings',
      })
      throw new AiGenerationDisabledError()
    }

    try {
      await assertBudgetAllowsRequest(settings)
    } catch (e) {
      if (e instanceof BudgetBlockedError) {
        await logBlockedAttempt({
          userIdInt,
          moduleName,
          actionName,
          model,
          status: 'blocked_budget',
          message: e.message,
        })
      }
      throw e
    }
  }

  const reqLabel = `[ai] module=${moduleName} action=${actionName} model=${model} user=${userIdInt ?? '?'}`

  let completion
  try {
    console.log(`${reqLabel} → OpenAI request starting`)
    completion = await completeChatJson({
      model,
      messages: opts.messages,
      temperature: opts.temperature != null ? opts.temperature : 0.25,
      timeoutMs: opts.timeoutMs != null ? opts.timeoutMs : 90_000,
      maxRetries: opts.maxRetries != null ? opts.maxRetries : 2,
    })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`${reqLabel} OpenAI error:`, msg)
    await insertUsageLog({
      user_id: userIdInt,
      module_name: moduleName,
      action_name: actionName,
      model,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      request_status: 'error',
      error_message: msg.slice(0, 2000),
      request_duration_ms: err.durationMs != null ? err.durationMs : null,
    })
    const wrapped = new Error(`OpenAI request failed: ${msg}`)
    wrapped.code = err.code || 'OPENAI_ERROR'
    wrapped.cause = err
    throw wrapped
  }

  const choice = completion.rawText
  const inputTokens = Number(completion.usage.prompt_tokens) || 0
  const outputTokens = Number(completion.usage.completion_tokens) || 0
  const totalTokens =
    Number(completion.usage.total_tokens) || inputTokens + outputTokens
  const cost = estimateCostUsd(model, inputTokens, outputTokens)
  const durationMs = completion.durationMs

  let parsed
  try {
    parsed = JSON.parse(choice || '{}')
  } catch {
    await insertUsageLog({
      user_id: userIdInt,
      module_name: moduleName,
      action_name: actionName,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: cost,
      request_status: 'error',
      error_message: 'Model returned non-JSON text',
      request_duration_ms: durationMs,
    })
    const wrapped = new Error('AI returned invalid JSON')
    wrapped.code = 'INVALID_AI_JSON'
    throw wrapped
  }

  const logRow = await insertUsageLog({
    user_id: userIdInt,
    module_name: moduleName,
    action_name: actionName,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: cost,
    request_status: 'success',
    error_message: null,
    request_duration_ms: durationMs,
  })

  console.log(
    `${reqLabel} ← success tokens=${totalTokens} cost_usd≈${cost} log_id=${logRow.id} duration_ms=${durationMs}`
  )

  return {
    data: parsed,
    usageLogId: logRow.id,
    model,
    usage: { inputTokens, outputTokens, totalTokens },
    estimatedCostUsd: cost,
    durationMs,
  }
}

module.exports = {
  runOpenAiJsonChat,
  getApiKey,
  BudgetBlockedError,
  AiGenerationDisabledError,
  parseUserIdInt,
  logBlockedAttempt,
}

const OpenAI = require('openai')

function getApiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key || !String(key).trim()) return null
  return String(key).trim()
}

let _client
function getOpenAiClient() {
  const key = getApiKey()
  if (!key) {
    const err = new Error('OPENAI_API_KEY is not configured on the server')
    err.code = 'MISSING_API_KEY'
    throw err
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey: key,
      maxRetries: 0,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || 120000),
    })
  }
  return _client
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Chat completion with JSON response format, timeout, and limited retries (429 / 5xx).
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {import('openai').OpenAI.Chat.ChatCompletionMessageParam[]} opts.messages
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 */
async function completeChatJson(opts) {
  const model = String(opts.model || '').trim()
  const messages = opts.messages
  const temperature = opts.temperature != null ? opts.temperature : 0.25
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 90_000
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 2

  const started = Date.now()
  let lastErr

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = getOpenAiClient()
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature,
      })
      const durationMs = Date.now() - started
      const choice = completion?.choices?.[0]?.message?.content
      const usage = completion?.usage || {}
      return {
        rawText: choice || '',
        usage: {
          prompt_tokens: Number(usage.prompt_tokens) || 0,
          completion_tokens: Number(usage.completion_tokens) || 0,
          total_tokens: Number(usage.total_tokens) || 0,
        },
        durationMs,
      }
    } catch (err) {
      lastErr = err
      const status = err?.status || err?.response?.status
      const retriable =
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err?.name === 'AbortError'
      if (attempt < maxRetries && retriable) {
        const backoff = Math.min(8000, 400 * 2 ** attempt)
        console.warn(`[openaiService] retry ${attempt + 1}/${maxRetries} after error:`, err?.message || err)
        await sleep(backoff)
        continue
      }
      const durationMs = Date.now() - started
      const wrapped = new Error(err?.name === 'AbortError' ? `OpenAI request timed out after ${timeoutMs}ms` : err?.message || String(err))
      wrapped.code = err?.name === 'AbortError' ? 'OPENAI_TIMEOUT' : 'OPENAI_ERROR'
      wrapped.status = status
      wrapped.durationMs = durationMs
      wrapped.cause = err
      throw wrapped
    }
  }
  const durationMs = Date.now() - started
  const wrapped = new Error(lastErr?.message || 'OpenAI request failed')
  wrapped.code = 'OPENAI_ERROR'
  wrapped.durationMs = durationMs
  wrapped.cause = lastErr
  throw wrapped
}

module.exports = {
  getApiKey,
  getOpenAiClient,
  completeChatJson,
}

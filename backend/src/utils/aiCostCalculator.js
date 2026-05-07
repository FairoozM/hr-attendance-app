/**
 * OpenAI list pricing (USD per 1M tokens). Update when OpenAI changes rates.
 * @see https://platform.openai.com/docs/pricing
 */
const PER_MILLION = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
}

const FALLBACK = PER_MILLION['gpt-4.1-mini']

function resolvePricing(model) {
  const m = String(model || '').toLowerCase().trim()
  if (PER_MILLION[m]) return PER_MILLION[m]
  const key = Object.keys(PER_MILLION).find((k) => m.includes(k))
  return key ? PER_MILLION[key] : FALLBACK
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  const rates = resolvePricing(model)
  const inn = Number(inputTokens) || 0
  const out = Number(outputTokens) || 0
  const cost = (inn * rates.input + out * rates.output) / 1e6
  return Math.round(cost * 1e8) / 1e8
}

module.exports = {
  estimateCostUsd,
  resolvePricing,
  PER_MILLION,
}

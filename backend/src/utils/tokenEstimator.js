/**
 * Rough token estimate before calling the API (~4 chars/token for Latin script).
 * For budgeting hints only — actual billing uses provider usage.* counts.
 */
function estimateTokensFromText(text) {
  const s = String(text ?? '')
  if (!s) return 0
  return Math.max(1, Math.ceil(s.length / 4))
}

function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0
  let n = 0
  for (const m of messages) {
    const c = m?.content
    if (typeof c === 'string') n += estimateTokensFromText(c)
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part?.type === 'text' && part.text) n += estimateTokensFromText(part.text)
      }
    }
  }
  return n + messages.length * 4
}

module.exports = {
  estimateTokensFromText,
  estimateMessagesTokens,
}

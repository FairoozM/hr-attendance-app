'use strict'

/**
 * Strip query/hash from URLs so signed S3 credentials are never persisted or logged.
 * @param {unknown} url
 * @returns {string}
 */
function sanitizeUrl(url) {
  const raw = String(url == null ? '' : url).trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    const q = raw.indexOf('?')
    const h = raw.indexOf('#')
    let end = raw.length
    if (q >= 0) end = Math.min(end, q)
    if (h >= 0) end = Math.min(end, h)
    return raw.slice(0, end)
  }
}

/**
 * Redact signed link resources inside a Product Type Definition payload.
 * @param {unknown} definition
 * @returns {unknown}
 */
function redactDefinitionLinks(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return definition
  const out = { ...definition }
  for (const key of ['schema', 'metaSchema']) {
    const block = out[key]
    if (!block || typeof block !== 'object') continue
    const link = block.link
    if (!link || typeof link !== 'object') continue
    out[key] = {
      ...block,
      link: {
        ...link,
        resource: sanitizeUrl(link.resource),
      },
    }
  }
  return out
}

module.exports = {
  sanitizeUrl,
  redactDefinitionLinks,
}

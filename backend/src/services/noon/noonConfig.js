const fs = require('fs')
const path = require('path')

function parseBooleanFlag(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue
  return /^(1|true|yes|on)$/i.test(String(value).trim())
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function getBackendRoot() {
  return path.resolve(__dirname, '../../..')
}

function resolveNoonJsonPath(rawPath) {
  const input = String(rawPath || '').trim()
  if (!input) return ''
  if (input.startsWith('./')) {
    return path.resolve(getBackendRoot(), input.slice(2))
  }
  return path.resolve(getBackendRoot(), input)
}

function readNoonConfig() {
  const enabled = parseBooleanFlag(process.env.NOON_API_ENABLED, false)
  const baseUrl = trimSlash(process.env.NOON_API_BASE_URL || '')
  const userAgent = String(process.env.NOON_API_USER_AGENT || '').trim()
  const jsonPath = resolveNoonJsonPath(
    process.env.NOON_SERVICE_ACCOUNT_JSON_PATH || './secrets/noon-service-account.json'
  )
  const projectCode = String(process.env.NOON_PROJECT_CODE || '').trim()
  const apiMode = String(process.env.NOON_API_MODE || 'production').trim() || 'production'
  const jsonPathExists = Boolean(jsonPath) && fs.existsSync(jsonPath)

  const missing = []
  const errors = []

  if (enabled) {
    if (!baseUrl) missing.push('NOON_API_BASE_URL')
    if (!userAgent) missing.push('NOON_API_USER_AGENT')
    if (!jsonPath) {
      missing.push('NOON_SERVICE_ACCOUNT_JSON_PATH')
    } else if (!jsonPathExists) {
      missing.push('NOON_SERVICE_ACCOUNT_JSON_PATH')
      errors.push(`Noon service account JSON file not found at ${jsonPath}`)
    }
  }

  const configured = enabled && missing.length === 0
  const code = !enabled ? 'disabled' : configured ? 'ok' : 'invalid'

  return {
    code,
    enabled,
    configured,
    baseUrl,
    userAgent,
    jsonPath,
    jsonPathExists,
    projectCode,
    projectCodeConfigured: Boolean(projectCode),
    apiMode,
    missing,
    errors,
  }
}

module.exports = {
  readNoonConfig,
  resolveNoonJsonPath,
}

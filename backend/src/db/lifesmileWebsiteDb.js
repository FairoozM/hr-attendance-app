'use strict'

/**
 * Read-only connection to the Life Smile website catalog database.
 *
 * Deliberately separate from `backend/src/db/index.js`. The HR pool is never reused,
 * this database is never treated as an application database, and nothing here creates,
 * migrates or alters anything. It is not registered with `testConnection()`.
 *
 * Read-only is enforced at three independent layers, so a bug in any one of them is
 * not sufficient to write:
 *
 *   1. the `amazon_catalog_reader` role is granted CONNECT, schema USAGE and SELECT only
 *   2. every session starts with `default_transaction_read_only=on`, so PostgreSQL
 *      itself rejects a write
 *   3. `readQuery` refuses any statement that is not a single SELECT or WITH
 *
 * The connection string is read from the environment, never logged, never returned by
 * an API and never sent to the browser. Driver errors are sanitised before they leave
 * this module.
 */

const { Pool } = require('pg')
const { buildPoolConfig, sanitizeDbError } = require('./dbConnectionConfig')

const ENV_VAR = 'LIFESMILE_WEBSITE_DATABASE_URL'
const APPLICATION_NAME = 'hr-bi-amazon-draft-readonly'
const STATEMENT_TIMEOUT_MS = 15000

/** Leading comments and whitespace, so the real first keyword can be identified. */
const LEADING_NOISE = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/

/**
 * Statement forms that must never reach the server. `default_transaction_read_only`
 * already blocks the data-modifying ones; this list also blocks session and
 * transaction manipulation that could try to turn read-only off.
 */
const FORBIDDEN_CONSTRUCTS = [
  /\binsert\s+into\b/i,
  /\bupdate\s+[\w".]+\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\b(?:alter|drop|create)\s+(?:table|schema|role|user|database|index|view|function|sequence|extension|materialized|type|trigger|policy|publication|subscription)\b/i,
  /\b(?:grant|revoke)\b/i,
  /\bcopy\b\s+[\w".]+\s+(?:from|to)\b/i,
  /\bselect\b[\s\S]*\binto\s+(?!strict\b)[\w".]+/i,
  /\b(?:vacuum|reindex|cluster|analyze)\b/i,
  /\block\s+table\b/i,
  /\bset\s+(?:session|role|local|transaction)\b/i,
  /\breset\b/i,
  /\bdo\s+\$\$/i,
  /\b(?:call|merge)\b/i,
  /\bnotify\b/i,
  /\bpg_(?:sleep|read_file|read_binary_file|ls_dir|terminate_backend|cancel_backend)\b/i,
]

let pool = null

function isConfigured() {
  return Boolean(process.env[ENV_VAR] && String(process.env[ENV_VAR]).trim())
}

function notConfiguredError() {
  const error = new Error(
    `The website catalog database is not configured. Set ${ENV_VAR} to the amazon_catalog_reader connection string.`
  )
  error.code = 'CATALOG_DB_NOT_CONFIGURED'
  return error
}

function buildConfig() {
  const { poolConfig, describe } = buildPoolConfig(String(process.env[ENV_VAR]).trim())

  return {
    poolConfig: {
      ...poolConfig,
      // Forced here rather than taken from the URL so the connection string cannot
      // weaken either the read-only session default or the identifying name.
      application_name: APPLICATION_NAME,
      options: '-c default_transaction_read_only=on',
      statement_timeout: STATEMENT_TIMEOUT_MS,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    },
    describe,
  }
}

function getPool() {
  if (!isConfigured()) throw notConfiguredError()
  if (!pool) {
    const { poolConfig } = buildConfig()
    pool = new Pool(poolConfig)
    pool.on('error', (err) => {
      // An idle client failing must not take the backend down, and must not leak a DSN.
      console.error('[amazon-draft-catalog] idle client error:', sanitizeDbError(err).message)
    })
  }
  return pool
}

/** Credential-free description, safe to log and to return from the health endpoint. */
function describeConnection() {
  if (!isConfigured()) return { configured: false }
  const { describe } = buildConfig()
  return {
    configured: true,
    host: describe.host,
    port: describe.port,
    database: describe.database,
    tls: describe.tls,
    applicationName: APPLICATION_NAME,
    readOnlySession: true,
  }
}

function assertReadOnlyStatement(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    const error = new Error('A SQL statement is required.')
    error.code = 'CATALOG_QUERY_REJECTED'
    throw error
  }

  const stripped = sql.replace(LEADING_NOISE, '')
  if (!/^(?:select|with)\b/i.test(stripped)) {
    const error = new Error('Only SELECT and WITH statements may be run against the website catalog.')
    error.code = 'CATALOG_QUERY_REJECTED'
    throw error
  }

  // Reject batched statements: anything after a semicolon other than trailing noise.
  const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""')
  const semicolon = withoutStrings.indexOf(';')
  if (semicolon !== -1 && withoutStrings.slice(semicolon + 1).replace(LEADING_NOISE, '').trim() !== '') {
    const error = new Error('Multiple SQL statements are not allowed.')
    error.code = 'CATALOG_QUERY_REJECTED'
    throw error
  }

  for (const construct of FORBIDDEN_CONSTRUCTS) {
    if (construct.test(withoutStrings)) {
      const error = new Error('The statement contains a construct that is not permitted on the website catalog.')
      error.code = 'CATALOG_QUERY_REJECTED'
      throw error
    }
  }
}

/**
 * Runs one parameterized read. `params` is mandatory so callers cannot fall into
 * string interpolation.
 */
async function readQuery(sql, params) {
  if (!Array.isArray(params)) {
    const error = new Error('readQuery requires an array of bind parameters.')
    error.code = 'CATALOG_QUERY_REJECTED'
    throw error
  }

  assertReadOnlyStatement(sql)

  try {
    return await getPool().query({ text: sql, values: params })
  } catch (err) {
    const sanitized = sanitizeDbError(err)
    const error = new Error(sanitized.message)
    error.code = err && err.code === 'CATALOG_DB_NOT_CONFIGURED' ? err.code : 'CATALOG_QUERY_FAILED'
    error.pgCode = sanitized.code
    throw error
  }
}

/** Confirms the role can connect and really is read-only. Never reveals credentials. */
async function checkHealth() {
  if (!isConfigured()) return { configured: false, reachable: false, readOnly: null }

  try {
    const result = await readQuery(
      'SELECT current_user AS role, current_setting($1) AS read_only, current_database() AS database',
      ['transaction_read_only']
    )
    const row = result.rows[0] || {}
    return {
      configured: true,
      reachable: true,
      role: row.role || null,
      database: row.database || null,
      readOnly: row.read_only === 'on',
    }
  } catch (err) {
    return { configured: true, reachable: false, readOnly: null, error: err.message }
  }
}

async function closePool() {
  if (pool) {
    const current = pool
    pool = null
    await current.end()
  }
}

module.exports = {
  APPLICATION_NAME,
  ENV_VAR,
  FORBIDDEN_CONSTRUCTS,
  assertReadOnlyStatement,
  checkHealth,
  closePool,
  describeConnection,
  isConfigured,
  readQuery,
}

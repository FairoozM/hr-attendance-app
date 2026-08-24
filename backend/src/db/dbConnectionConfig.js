'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Builds the node-postgres pool configuration from DATABASE_URL.
 *
 * The pool is deliberately configured with discrete host/port/user/password/database
 * fields instead of `connectionString`. node-postgres resolves a connection string via
 * `Object.assign({}, config, parse(config.connectionString))`, so any `sslmode`/`sslrootcert`
 * in the URL would take precedence over an explicit `ssl` object and could silently
 * downgrade a verified TLS connection to `rejectUnauthorized: false`. Decomposing the URL
 * keeps this module the single authority on TLS.
 */

const DEFAULT_CONNECTION_STRING = 'postgres://localhost:5432/hr_attendance'

const RDS_CA_BUNDLE_PATH = path.join(__dirname, 'certs', 'eu-central-1-bundle.pem')

/** Query parameters that would otherwise influence TLS; parsed, reported, then dropped. */
const SSL_URL_PARAMS = new Set([
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslpassword',
  'sslservername',
  'sslnegotiation',
  'sslcompression',
  'sslcrl',
  'sslcrldir',
])

/** Non-TLS parameters that are safe to forward to the driver. */
const FORWARDED_URL_PARAMS = new Set(['application_name', 'options'])

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

const RDS_HOSTNAME_PATTERN = /\.rds\.amazonaws\.com$/i

let cachedCaBundle = null

/** Local development target: plaintext loopback PostgreSQL, no TLS. */
function isLocalHostname(hostname) {
  if (!hostname) return false
  const host = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '')
  return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')
}

function isRdsHostname(hostname) {
  return RDS_HOSTNAME_PATTERN.test(String(hostname || '').trim())
}

/**
 * Reads the public Amazon RDS eu-central-1 root CA bundle from disk. Cached after the
 * first successful read. Throws when the bundle is missing or contains no certificate,
 * because falling back to an unverified connection is never acceptable for RDS.
 */
function loadRdsCaBundle({ reload = false } = {}) {
  if (cachedCaBundle && !reload) return cachedCaBundle

  let pem
  try {
    pem = fs.readFileSync(RDS_CA_BUNDLE_PATH, 'utf8')
  } catch (err) {
    throw new Error(
      `Unable to read the Amazon RDS CA bundle at ${RDS_CA_BUNDLE_PATH} (${err.code || 'read error'}). ` +
        'A verified TLS connection to RDS cannot be established without it.'
    )
  }

  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      `The Amazon RDS CA bundle at ${RDS_CA_BUNDLE_PATH} contains no PEM certificate.`
    )
  }

  cachedCaBundle = pem
  return cachedCaBundle
}

function countCertificates(pem) {
  return (String(pem).match(/-----BEGIN CERTIFICATE-----/g) || []).length
}

function parseConnectionString(connectionString) {
  let url
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.')
  }

  if (!/^postgres(ql)?:$/i.test(url.protocol)) {
    throw new Error(`Unsupported DATABASE_URL protocol "${url.protocol}"; expected postgres: or postgresql:.`)
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))

  const forwarded = {}
  const ignoredSslParams = []
  const unknownParams = []
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase()
    if (SSL_URL_PARAMS.has(lower)) ignoredSslParams.push(lower)
    else if (FORWARDED_URL_PARAMS.has(lower)) forwarded[lower] = url.searchParams.get(key)
    else unknownParams.push(lower)
  }

  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : 5432,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: database || undefined,
    forwarded,
    ignoredSslParams,
    unknownParams,
  }
}

/**
 * TLS settings for the resolved host.
 * - loopback PostgreSQL: no TLS, matching local development
 * - *.rds.amazonaws.com: the pinned Amazon RDS regional root CAs, chain and hostname verified
 * - any other remote host: TLS with the system trust store, still fully verified
 */
function buildSslConfig(host) {
  if (isLocalHostname(host)) return { ssl: false, tlsMode: 'disabled-localhost' }

  const common = {
    rejectUnauthorized: true,
    servername: host,
    minVersion: 'TLSv1.2',
  }

  if (isRdsHostname(host)) {
    return { ssl: { ...common, ca: loadRdsCaBundle() }, tlsMode: 'verified-rds' }
  }

  return { ssl: { ...common }, tlsMode: 'verified-system-ca' }
}

/**
 * Full pool configuration plus a credential-free description for logging.
 * `describe` is the only shape callers should ever log.
 */
function buildPoolConfig(connectionString = process.env.DATABASE_URL || DEFAULT_CONNECTION_STRING) {
  const parsed = parseConnectionString(connectionString)
  const { ssl, tlsMode } = buildSslConfig(parsed.host)

  const poolConfig = {
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    ssl,
  }
  if (parsed.user !== undefined) poolConfig.user = parsed.user
  if (parsed.password !== undefined) poolConfig.password = parsed.password
  if (parsed.forwarded.application_name) poolConfig.application_name = parsed.forwarded.application_name
  if (parsed.forwarded.options) poolConfig.options = parsed.forwarded.options

  return {
    poolConfig,
    tlsMode,
    describe: {
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      tls: tlsMode,
      caCertificates: ssl && ssl.ca ? countCertificates(ssl.ca) : 0,
      rejectUnauthorized: ssl === false ? null : ssl.rejectUnauthorized,
      ignoredSslUrlParams: parsed.ignoredSslParams,
      unsupportedUrlParams: parsed.unknownParams,
    },
  }
}

const CONNECTION_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s'"]+/gi
const INLINE_CREDENTIALS_PATTERN = /\/\/[^/\s:@]+:[^/\s@]+@/g

/**
 * Strips connection URLs and inline credentials out of a driver error so the message can
 * be logged or surfaced. Returns a plain object; the original error is never re-emitted.
 */
function sanitizeDbError(error) {
  const raw = error && error.message ? String(error.message) : String(error || 'Unknown database error')
  const message = raw
    .replace(CONNECTION_URL_PATTERN, '[redacted-connection-url]')
    .replace(INLINE_CREDENTIALS_PATTERN, '//[redacted-credentials]@')

  return {
    message,
    code: (error && error.code) || undefined,
    severity: (error && error.severity) || undefined,
  }
}

module.exports = {
  DEFAULT_CONNECTION_STRING,
  RDS_CA_BUNDLE_PATH,
  buildPoolConfig,
  buildSslConfig,
  isLocalHostname,
  isRdsHostname,
  loadRdsCaBundle,
  parseConnectionString,
  sanitizeDbError,
}

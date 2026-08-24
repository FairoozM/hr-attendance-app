const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const { Pool } = require('pg')
const ConnectionParameters = require('pg/lib/connection-parameters')
const {
  RDS_CA_BUNDLE_PATH,
  buildPoolConfig,
  buildSslConfig,
  isLocalHostname,
  isRdsHostname,
  loadRdsCaBundle,
  parseConnectionString,
  sanitizeDbError,
} = require('../src/db/dbConnectionConfig')

const LOCAL_URL = 'postgres://hr_user:local-dev-secret@localhost:5432/hr_attendance'
const RDS_HOST = 'hr-attendance-production.abcdefghijkl.eu-central-1.rds.amazonaws.com'
const RDS_URL = `postgres://hr_app:rds-dev-secret@${RDS_HOST}:5432/hr_attendance`

// ── localhost configuration ──────────────────────────────────────────────────

test('localhost keeps TLS disabled', () => {
  const { poolConfig, tlsMode, describe } = buildPoolConfig(LOCAL_URL)
  assert.equal(poolConfig.ssl, false)
  assert.equal(tlsMode, 'disabled-localhost')
  assert.equal(poolConfig.host, 'localhost')
  assert.equal(poolConfig.port, 5432)
  assert.equal(poolConfig.database, 'hr_attendance')
  assert.equal(poolConfig.user, 'hr_user')
  assert.equal(describe.caCertificates, 0)
})

test('loopback aliases are all treated as local', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', 'LOCALHOST', 'db.localhost']) {
    assert.equal(isLocalHostname(host), true, `${host} should be local`)
  }
  for (const host of ['', null, undefined, RDS_HOST, 'db.internal']) {
    assert.equal(isLocalHostname(host), false, `${host} should not be local`)
  }
})

test('localhost pool config never carries a connectionString for pg to re-parse', () => {
  const { poolConfig } = buildPoolConfig(LOCAL_URL)
  assert.equal('connectionString' in poolConfig, false)
})

// ── verified RDS TLS configuration ───────────────────────────────────────────

test('RDS uses the pinned CA bundle with verification enabled', () => {
  const { poolConfig, tlsMode, describe } = buildPoolConfig(RDS_URL)
  assert.equal(tlsMode, 'verified-rds')
  assert.equal(poolConfig.ssl.rejectUnauthorized, true)
  assert.equal(poolConfig.ssl.servername, RDS_HOST)
  assert.equal(poolConfig.ssl.minVersion, 'TLSv1.2')
  assert.ok(poolConfig.ssl.ca.includes('-----BEGIN CERTIFICATE-----'))
  assert.equal(describe.caCertificates, 3)
})

test('RDS TLS config never disables verification or hostname checking', () => {
  const { poolConfig } = buildPoolConfig(RDS_URL)
  assert.notEqual(poolConfig.ssl.rejectUnauthorized, false)
  assert.equal(poolConfig.ssl.checkServerIdentity, undefined)
})

test('non-RDS remote hosts still verify against the system trust store', () => {
  const { ssl, tlsMode } = buildSslConfig('db.example.internal')
  assert.equal(tlsMode, 'verified-system-ca')
  assert.equal(ssl.rejectUnauthorized, true)
  assert.equal(ssl.ca, undefined)
})

test('isRdsHostname only matches the RDS domain', () => {
  assert.equal(isRdsHostname(RDS_HOST), true)
  assert.equal(isRdsHostname('rds.amazonaws.com.evil.example'), false)
  assert.equal(isRdsHostname('localhost'), false)
})

// ── connection-string SSL parameters cannot override the code config ─────────

test('sslmode in the URL cannot downgrade the RDS TLS configuration', () => {
  for (const mode of ['disable', 'no-verify', 'prefer', 'require', 'allow']) {
    const { poolConfig, describe } = buildPoolConfig(`${RDS_URL}?sslmode=${mode}`)
    assert.equal(poolConfig.ssl.rejectUnauthorized, true, `sslmode=${mode} must not weaken TLS`)
    assert.ok(poolConfig.ssl.ca, `sslmode=${mode} must keep the CA bundle`)
    assert.deepEqual(describe.ignoredSslUrlParams, ['sslmode'])
  }
})

test('sslrootcert in the URL cannot replace the pinned CA bundle', () => {
  const { poolConfig, describe } = buildPoolConfig(`${RDS_URL}?sslrootcert=/tmp/attacker.pem`)
  assert.equal(poolConfig.ssl.ca, loadRdsCaBundle())
  assert.deepEqual(describe.ignoredSslUrlParams, ['sslrootcert'])
})

test('pg resolves the pool config to verified TLS, not the URL SSL parameters', () => {
  const hostileUrl = `${RDS_URL}?sslmode=no-verify`

  // What pg would do if the URL were handed to it alongside an explicit ssl object:
  // the parsed connection string is merged *over* the config, so sslmode wins and the
  // CA is dropped. This is the downgrade the module exists to prevent.
  const overridden = new ConnectionParameters({
    connectionString: hostileUrl,
    ssl: { rejectUnauthorized: true, ca: loadRdsCaBundle() },
  })
  assert.equal(overridden.ssl.rejectUnauthorized, false)
  assert.equal(overridden.ssl.ca, undefined)

  // What the decomposed config actually produces.
  const { poolConfig } = buildPoolConfig(hostileUrl)
  const resolved = new ConnectionParameters(poolConfig)
  assert.equal(resolved.ssl.rejectUnauthorized, true)
  assert.equal(resolved.ssl.ca, loadRdsCaBundle())
  assert.equal(resolved.host, RDS_HOST)
  assert.equal(resolved.database, 'hr_attendance')

  // And the same holds once a real Pool is constructed from it.
  assert.equal(new Pool(poolConfig).options.ssl.rejectUnauthorized, true)
})

test('non-SSL parameters are forwarded and unknown ones reported', () => {
  const { poolConfig, describe } = buildPoolConfig(
    `${RDS_URL}?application_name=hr-backend&made_up_param=1`
  )
  assert.equal(poolConfig.application_name, 'hr-backend')
  assert.deepEqual(describe.unsupportedUrlParams, ['made_up_param'])
  assert.deepEqual(describe.ignoredSslUrlParams, [])
})

test('invalid and non-postgres URLs are rejected', () => {
  assert.throws(() => buildPoolConfig('not-a-url'), /not a valid PostgreSQL connection URL/)
  assert.throws(() => buildPoolConfig('mysql://localhost:3306/hr'), /Unsupported DATABASE_URL protocol/)
})

test('percent-encoded credentials are decoded for the driver', () => {
  const parsed = parseConnectionString(
    `postgres://hr%40app:p%40ss%2Fword@${RDS_HOST}:5432/hr_attendance`
  )
  assert.equal(parsed.user, 'hr@app')
  assert.equal(parsed.password, 'p@ss/word')
})

// ── CA loading ───────────────────────────────────────────────────────────────

test('the committed CA bundle is the Amazon RDS eu-central-1 trust store', () => {
  const pem = loadRdsCaBundle({ reload: true })
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----/g) || []
  assert.equal(blocks.length, 3)
  assert.ok(fs.existsSync(RDS_CA_BUNDLE_PATH))
  assert.match(RDS_CA_BUNDLE_PATH, /eu-central-1-bundle\.pem$/)
})

test('the CA bundle is cached across calls', () => {
  assert.equal(loadRdsCaBundle(), loadRdsCaBundle())
})

test('the CA bundle holds no private key material', () => {
  const pem = loadRdsCaBundle()
  assert.equal(/PRIVATE KEY/.test(pem), false)
})

// ── secret-safe error handling ───────────────────────────────────────────────

test('sanitizeDbError strips connection URLs', () => {
  const err = new Error(
    `connect ECONNREFUSED for postgres://hr_app:sup3r-s3cret@${RDS_HOST}:5432/hr_attendance`
  )
  err.code = 'ECONNREFUSED'
  const safe = sanitizeDbError(err)
  assert.equal(safe.code, 'ECONNREFUSED')
  assert.equal(safe.message.includes('sup3r-s3cret'), false)
  assert.equal(safe.message.includes('postgres://'), false)
  assert.match(safe.message, /\[redacted-connection-url\]/)
})

test('sanitizeDbError strips inline credentials from any scheme', () => {
  const safe = sanitizeDbError(new Error('auth failed for //hr_app:sup3r-s3cret@host:5432'))
  assert.equal(safe.message.includes('sup3r-s3cret'), false)
  assert.match(safe.message, /\[redacted-credentials\]/)
})

test('sanitizeDbError tolerates non-Error input', () => {
  assert.equal(sanitizeDbError(undefined).message, 'Unknown database error')
  assert.equal(sanitizeDbError('plain failure').message, 'plain failure')
})

test('the logged connection description carries no credentials', () => {
  const { describe } = buildPoolConfig(RDS_URL)
  const serialized = JSON.stringify(describe)
  assert.equal(serialized.includes('rds-dev-secret'), false)
  assert.equal(serialized.includes('hr_app'), false)
  assert.equal(describe.tls, 'verified-rds')
})

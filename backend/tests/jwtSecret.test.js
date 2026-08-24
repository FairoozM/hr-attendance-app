'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { execFileSync } = require('child_process')

const {
  DEVELOPMENT_SECRET,
  MINIMUM_LENGTH,
  assertJwtSecretConfigured,
  getJwtSecret,
  resetJwtSecretCache,
  resolveJwtSecret,
} = require('../src/config/jwtSecret')

/** The key that shipped as a fallback in src/middleware/auth.js until 2026-08-24. */
const HISTORICAL_FALLBACK = 'hr-attendance-dev-secret-change-me'

/** A stand-in for a real key: long, random-looking, not published anywhere. */
const STRONG = 'Zm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC1zZWNyZXQtYnV0LWxvbmctZW5vdWdo'

test.afterEach(() => resetJwtSecretCache())

test('production refuses to start without JWT_SECRET', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production' }),
    (err) => err.code === 'JWT_SECRET_INVALID' && /JWT_SECRET is not set/.test(err.message)
  )
})

test('production refuses a blank or whitespace-only JWT_SECRET', () => {
  for (const value of ['', '   ', '\t\n']) {
    assert.throws(
      () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: value }),
      (err) => err.code === 'JWT_SECRET_INVALID',
      `expected a blank secret (${JSON.stringify(value)}) to be refused`
    )
  }
})

test('production uses the secret it is given', () => {
  const resolved = resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: STRONG })
  assert.equal(resolved.secret, STRONG)
  assert.equal(resolved.source, 'JWT_SECRET')
  assert.equal(resolved.environment, 'production')
})

test('surrounding whitespace in the configured value is ignored', () => {
  const resolved = resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: `  ${STRONG}\n` })
  assert.equal(resolved.secret, STRONG)
})

test('the historical fallback secret is rejected, in production and out of it', () => {
  for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
    assert.throws(
      () => resolveJwtSecret({ NODE_ENV, JWT_SECRET: HISTORICAL_FALLBACK }),
      (err) => err.code === 'JWT_SECRET_INVALID' && /published in this repository/.test(err.message),
      `expected the historical fallback to be refused with NODE_ENV=${NODE_ENV}`
    )
  }
})

test('the development key cannot be promoted to production by setting it explicitly', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: DEVELOPMENT_SECRET }),
    (err) => err.code === 'JWT_SECRET_INVALID' && /published in this repository/.test(err.message)
  )
})

test('a short secret is refused rather than silently accepted', () => {
  const short = 'a'.repeat(MINIMUM_LENGTH - 1)
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: short }),
    (err) => err.code === 'JWT_SECRET_INVALID' && /at least/.test(err.message)
  )
  assert.equal(
    resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(MINIMUM_LENGTH) }).secret,
    'a'.repeat(MINIMUM_LENGTH)
  )
})

test('no error message or stack repeats the secret back', () => {
  const secrets = [HISTORICAL_FALLBACK, 'b'.repeat(MINIMUM_LENGTH - 1)]
  for (const value of secrets) {
    try {
      resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: value })
      assert.fail('expected a rejection')
    } catch (err) {
      assert.ok(!err.message.includes(value), 'the message must not contain the secret')
      assert.ok(!String(err.stack).includes(value), 'the stack must not contain the secret')
      assert.ok(!JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(value))
    }
  }
})

test('development falls back to an obviously scoped key, and says so', () => {
  const resolved = resolveJwtSecret({ NODE_ENV: 'development' })
  assert.equal(resolved.secret, DEVELOPMENT_SECRET)
  assert.equal(resolved.source, 'development-default')
  assert.notEqual(resolved.secret, HISTORICAL_FALLBACK)
  assert.match(resolved.secret, /not-a-real-secret/)
})

test('tests and development may supply their own scoped secret', () => {
  const resolved = resolveJwtSecret({ NODE_ENV: 'test', JWT_SECRET: STRONG })
  assert.equal(resolved.secret, STRONG)
  assert.equal(resolved.source, 'JWT_SECRET')
})

test('getJwtSecret memoizes, so signing and verification cannot use different keys', () => {
  const original = process.env.JWT_SECRET
  try {
    process.env.JWT_SECRET = STRONG
    resetJwtSecretCache()
    const first = getJwtSecret()

    // A later mutation of the environment must not split the two halves of the process.
    process.env.JWT_SECRET = `${STRONG}-changed-underneath`
    assert.equal(getJwtSecret(), first)
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
    resetJwtSecretCache()
  }
})

test('assertJwtSecretConfigured reports the source without revealing the value', () => {
  const original = process.env.JWT_SECRET
  try {
    process.env.JWT_SECRET = STRONG
    resetJwtSecretCache()
    const described = assertJwtSecretConfigured()
    assert.deepEqual(described, { source: 'JWT_SECRET', environment: 'development' })
    assert.ok(!JSON.stringify(described).includes(STRONG))
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
    resetJwtSecretCache()
  }
})

test('the server exits non-zero, with an explanation, when production has no JWT_SECRET', () => {
  const serverPath = path.join(__dirname, '..', 'src', 'server.js')
  let result
  try {
    execFileSync(process.execPath, [serverPath], {
      env: {
        // JWT_SECRET is present but empty, which also stops dotenv from filling it in from a
        // developer's local .env and masking what this test is checking.
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: '',
        PORT: '5399',
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    })
    result = { status: 0, stderr: '' }
  } catch (err) {
    result = { status: err.status, stderr: `${err.stderr || ''}${err.stdout || ''}` }
  }

  assert.notEqual(result.status, 0, 'the process must not start')
  assert.match(result.stderr, /JWT_SECRET is not set/)
  assert.match(result.stderr, /hr-bi\/production\/jwt-secret/)
  assert.ok(
    !result.stderr.includes(HISTORICAL_FALLBACK),
    'the refusal must not print the published key it is refusing to use'
  )
})

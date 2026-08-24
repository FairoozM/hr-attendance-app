'use strict'

/**
 * What a token can and cannot buy, exercised through the real middleware.
 *
 * These tests run against a stubbed users table so they assert on authentication and
 * authorization alone, not on database state.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')

const HISTORICAL_FALLBACK = 'hr-attendance-dev-secret-change-me'
const TEST_SECRET = 'dGVzdHMtb25seS1sb25nLXJhbmRvbS1sb29raW5nLWtleS1ub3QtaW4tdXNlLWFueXdoZXJl'

let originalSecret
let originalNodeEnv
let auth
let getJwtSecret
let resetJwtSecretCache
let dbPath

/** Rows the middleware would have read from the users table. */
const USERS = {
  '1': { permissions: { leave: { manage: true } }, linear_workspace_role: null },
  '2': { permissions: {}, linear_workspace_role: null },
}

before(() => {
  originalSecret = process.env.JWT_SECRET
  originalNodeEnv = process.env.NODE_ENV
  process.env.JWT_SECRET = TEST_SECRET
  process.env.NODE_ENV = 'test'

  // Stubbed before the middleware is loaded, so the real pool is never constructed.
  dbPath = require.resolve('../src/db')
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (_sql, params) => ({ rows: USERS[String(params[0])] ? [USERS[String(params[0])]] : [] }),
    },
  }

  ;({ getJwtSecret, resetJwtSecretCache } = require('../src/config/jwtSecret'))
  resetJwtSecretCache()
  auth = require('../src/middleware/auth')
})

after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  delete require.cache[dbPath]
  resetJwtSecretCache()
})

/** Runs attachAuth over a bearer token and reports what the request ended up as. */
async function authenticate(token) {
  const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } }
  let forwardedError = null
  await auth.attachAuth(req, {}, (err) => {
    if (err) forwardedError = err
  })
  return { user: req.user, forwardedError }
}

/** Runs a guard and reports the status it would have sent, or 'next' if it allowed the call. */
function guard(middleware, user) {
  let status = null
  let body = null
  const res = {
    status(code) {
      status = code
      return { json: (payload) => { body = payload } }
    },
  }
  let passed = false
  middleware({ user }, res, () => { passed = true })
  return { status, body, passed }
}

describe('a token signed with the configured secret', () => {
  it('authenticates, and carries the role from the token with permissions from the database', async () => {
    const token = jwt.sign({ sub: '1', role: 'admin' }, getJwtSecret(), { expiresIn: '5m' })
    const { user, forwardedError } = await authenticate(token)

    assert.equal(forwardedError, null)
    assert.equal(user.userId, '1')
    assert.equal(user.role, 'admin')
    assert.deepEqual(user.permissions, { leave: { manage: true } })
  })

  it('is what login produces, so signing and verification agree', async () => {
    // authController signs with getJwtSecret(); the middleware verifies with getJwtSecret().
    // Signing here through the same accessor is the assertion that they are one key.
    const asLoginWouldSign = jwt.sign(
      { sub: '1', role: 'admin', employeeId: null, permissions: {} },
      getJwtSecret(),
      { expiresIn: '7d' }
    )
    const { user } = await authenticate(asLoginWouldSign)
    assert.equal(user.role, 'admin')
    assert.equal(guard(auth.requireAdmin, user).passed, true)
  })

  it('lets a real admin through requireAdmin and stops a non-admin with 403', async () => {
    const adminToken = jwt.sign({ sub: '1', role: 'admin' }, getJwtSecret(), { expiresIn: '5m' })
    const staffToken = jwt.sign({ sub: '2', role: 'warehouse' }, getJwtSecret(), { expiresIn: '5m' })

    const admin = await authenticate(adminToken)
    const staff = await authenticate(staffToken)

    assert.equal(guard(auth.requireAdmin, admin.user).passed, true)

    const blocked = guard(auth.requireAdmin, staff.user)
    assert.equal(blocked.passed, false)
    assert.equal(blocked.status, 403)
    assert.deepEqual(blocked.body, { error: 'Forbidden' })
  })
})

describe('a token that was not signed with the configured secret', () => {
  it('is rejected when it was signed with the historical fallback secret', async () => {
    const forged = jwt.sign({ sub: '1', role: 'admin' }, HISTORICAL_FALLBACK, { expiresIn: '5m' })
    const { user, forwardedError } = await authenticate(forged)

    assert.equal(user, null, 'a token signed with the published key must not authenticate')
    assert.equal(forwardedError, null, 'it is an unauthenticated request, not a server fault')

    const blocked = guard(auth.requireAuth, user)
    assert.equal(blocked.status, 401)
    assert.deepEqual(blocked.body, { error: 'Unauthorized' })
  })

  it('is rejected when an attacker claims to be an admin', async () => {
    const forged = jwt.sign(
      { sub: '1', role: 'admin', permissions: { everything: true } },
      'some-other-key-an-attacker-picked-at-random',
      { expiresIn: '5m' }
    )
    const { user } = await authenticate(forged)

    assert.equal(user, null)
    assert.equal(guard(auth.requireAdmin, user).status, 403)
    assert.equal(guard(auth.requireAuth, user).status, 401)
  })

  it('is rejected when a validly signed token has had its payload edited', async () => {
    const honest = jwt.sign({ sub: '2', role: 'warehouse' }, getJwtSecret(), { expiresIn: '5m' })
    const [header, , signature] = honest.split('.')
    const tampered = [
      header,
      Buffer.from(JSON.stringify({ sub: '2', role: 'admin' })).toString('base64url'),
      signature,
    ].join('.')

    const { user } = await authenticate(tampered)
    assert.equal(user, null, 'editing the role must invalidate the signature')
  })
})

describe('a token that cannot be trusted for other reasons', () => {
  it('fails safely when it has expired', async () => {
    const expired = jwt.sign({ sub: '1', role: 'admin' }, getJwtSecret(), { expiresIn: '-1s' })
    const { user, forwardedError } = await authenticate(expired)

    assert.equal(user, null)
    assert.equal(forwardedError, null)
    assert.equal(guard(auth.requireAuth, user).status, 401)
  })

  it('fails safely when it is malformed rather than throwing', async () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c', '...', 'eyJhbGciOiJub25lIn0..']) {
      const { user, forwardedError } = await authenticate(bad)
      assert.equal(user, null, `expected ${JSON.stringify(bad)} to be refused`)
      assert.equal(forwardedError, null)
    }
  })

  it('is rejected when it is unsigned, even if the claims look right', async () => {
    // alg:none is the classic downgrade: a token with a real-looking body and no signature.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: '1', role: 'admin' })).toString('base64url')
    const { user } = await authenticate(`${header}.${body}.`)
    assert.equal(user, null)
  })

  it('treats a request with no token as anonymous, not as an error', async () => {
    const { user, forwardedError } = await authenticate(null)
    assert.equal(user, null)
    assert.equal(forwardedError, null)
    assert.equal(guard(auth.requireAuth, user).status, 401)
  })
})

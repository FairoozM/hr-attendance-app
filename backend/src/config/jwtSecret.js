'use strict'

/**
 * The one place the session signing key is resolved.
 *
 * Login signs tokens and the auth middleware verifies them. If those two ever read the key
 * from different places they can drift apart, so both call `getJwtSecret()` here and the
 * answer is memoized: within a process, the key that signs a token is by construction the
 * key that verifies it.
 *
 * In production the key must come from the environment. There is deliberately no fallback,
 * because a default that ships in the repository is not a secret — anyone holding a copy of
 * the source can mint an administrator session with it. Refusing to start is the safe
 * failure; starting with a public key is not.
 */

/**
 * Keys that are published in source control, here or in this file's history. None may ever
 * sign a session, in any environment, even if someone sets JWT_SECRET to one of them.
 */
const PUBLISHED_SECRETS = new Set([
  // Shipped as the fallback in src/middleware/auth.js until 2026-08-24. Any token bearing it
  // must be treated as forged.
  'hr-attendance-dev-secret-change-me',
  // The development key below. Named here so it cannot be promoted to production by accident.
  'hr-attendance-local-development-only-not-a-real-secret',
])

/** Used only when NODE_ENV is not production and nothing was configured. */
const DEVELOPMENT_SECRET = 'hr-attendance-local-development-only-not-a-real-secret'

/**
 * A 64-byte random key is 88 base64 characters. This floor rejects the short,
 * human-chosen strings that tend to appear when someone fills the variable in by hand.
 */
const MINIMUM_LENGTH = 32

class JwtSecretError extends Error {
  constructor(message) {
    super(message)
    this.name = 'JwtSecretError'
    this.code = 'JWT_SECRET_INVALID'
  }
}

/**
 * Resolve the signing key from an environment without touching module state.
 *
 * Returns `{ secret, source, environment }`. Throws `JwtSecretError` when production is
 * misconfigured. No message, property or stack here contains the key itself: a startup log
 * or a crash report is exactly the sort of place a key must not turn up.
 */
function resolveJwtSecret(env = process.env) {
  const isProduction = env.NODE_ENV === 'production'
  const configured = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : ''

  if (configured) {
    if (PUBLISHED_SECRETS.has(configured)) {
      throw new JwtSecretError(
        'JWT_SECRET is set to a key that is published in this repository, so it cannot ' +
          'protect anything. Generate a new random key (openssl rand -base64 64) and set ' +
          'JWT_SECRET to it.'
      )
    }
    if (configured.length < MINIMUM_LENGTH) {
      throw new JwtSecretError(
        `JWT_SECRET is too short: it must be at least ${MINIMUM_LENGTH} characters. ` +
          'Generate one with: openssl rand -base64 64'
      )
    }
    return { secret: configured, source: 'JWT_SECRET', environment: isProduction ? 'production' : 'development' }
  }

  if (isProduction) {
    throw new JwtSecretError(
      'JWT_SECRET is not set. Refusing to start in production rather than fall back to a ' +
        'key that is published in this repository, which would let anyone holding the ' +
        'source mint an administrator session. Set JWT_SECRET from the secret ' +
        'hr-bi/production/jwt-secret.'
    )
  }

  return { secret: DEVELOPMENT_SECRET, source: 'development-default', environment: 'development' }
}

let cached = null

/**
 * The signing key for this process. Memoized so signing and verification cannot diverge,
 * and so a misconfiguration is reported identically however it is reached.
 */
function getJwtSecret() {
  if (cached === null) cached = resolveJwtSecret(process.env)
  return cached.secret
}

/**
 * Called at startup to turn a misconfiguration into an immediate, explained exit instead of
 * a stream of failed logins later. Returns a description safe to log.
 */
function assertJwtSecretConfigured() {
  const resolved = resolveJwtSecret(process.env)
  cached = resolved
  return { source: resolved.source, environment: resolved.environment }
}

/** Test seam: forget the memoized key so a test can resolve against a different env. */
function resetJwtSecretCache() {
  cached = null
}

module.exports = {
  DEVELOPMENT_SECRET,
  JwtSecretError,
  MINIMUM_LENGTH,
  PUBLISHED_SECRETS,
  assertJwtSecretConfigured,
  getJwtSecret,
  resetJwtSecretCache,
  resolveJwtSecret,
}

/**
 * Test helpers shared by every backend test file.
 *
 * The harness is intentionally tiny — it relies only on Node's built-in
 * `node:test` runner and `node:assert/strict`, so the project does not need
 * any new test dependencies.
 *
 * Two patterns are supported here:
 *
 * 1. `mockModule(modulePath, fakeExports)` — install a fake module into
 *    Node's `require.cache` BEFORE the code-under-test loads it. Use this for
 *    layers we don't want to actually hit (the real DB, external services).
 *
 * 2. `makeReqRes()` — build a tiny Express-shaped req/res pair for unit
 *    testing controllers without spinning up the HTTP stack.
 */

const path = require('path')
const Module = require('module')

/** Resolve a module id relative to this helpers file. */
function resolveFromHere(relativeOrAbsolute) {
  return require.resolve(relativeOrAbsolute, { paths: [__dirname] })
}

/**
 * Force `require(modulePath)` to return `fakeExports` from now on.
 * The real module is never loaded. Returns a `restore()` function.
 *
 * Example:
 *   const restore = mockModule('../src/db', { query: async () => ({ rows: [] }) })
 *   ...
 *   restore()
 */
function mockModule(modulePath, fakeExports) {
  // Resolve relative to the *caller-style* path. Tests pass paths like
  // '../src/db' and we resolve them from this file's directory.
  let resolved
  try {
    resolved = require.resolve(modulePath, { paths: [__dirname] })
  } catch {
    resolved = path.resolve(__dirname, modulePath)
  }

  const previous = require.cache[resolved]
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: fakeExports,
    children: [],
    paths: [],
  }
  return function restore() {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

/** Force-reload a module after its dependencies have been mocked. */
function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath, { paths: [__dirname] })
  delete require.cache[resolved]
  return require(resolved)
}

/** Build a fake Express req/res pair. */
function makeReqRes({ params = {}, query = {}, body = {}, user = null } = {}) {
  const res = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; this.headersSent = true; return this },
    send(payload) { this.body = payload; this.headersSent = true; return this },
  }
  const req = { params, query, body, user }
  return { req, res }
}

/** Capture all `console.error|warn|info|log` writes during a callback. */
async function captureConsole(fn) {
  const captured = { error: [], warn: [], info: [], log: [] }
  const orig = {
    error: console.error,
    warn:  console.warn,
    info:  console.info,
    log:   console.log,
  }
  console.error = (...a) => captured.error.push(a)
  console.warn  = (...a) => captured.warn.push(a)
  console.info  = (...a) => captured.info.push(a)
  console.log   = (...a) => captured.log.push(a)
  try {
    await fn()
  } finally {
    console.error = orig.error
    console.warn  = orig.warn
    console.info  = orig.info
    console.log   = orig.log
  }
  return captured
}

/**
 * Temporarily replace `global.fetch` for tests. Returns a `restore()` function.
 */
function mockFetch(impl) {
  const prev = global.fetch
  global.fetch = impl
  return function restore() {
    global.fetch = prev
  }
}

module.exports = {
  resolveFromHere,
  mockModule,
  freshRequire,
  makeReqRes,
  captureConsole,
  mockFetch,
  Module,
}

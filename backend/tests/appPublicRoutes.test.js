/**
 * GET /api and GET /api/health must be public (no auth) and return JSON 200.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const app = require('../src/app')

function request(getPath) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(app)
    s.listen(0, () => {
      const p = s.address().port
      http
        .get({ hostname: '127.0.0.1', port: p, path: getPath }, (r) => {
          let b = ''
          r.setEncoding('utf8')
          r.on('data', (d) => (b += d))
          r.on('end', () => {
            s.close(() => resolve({ status: r.statusCode, body: b, contentType: r.headers['content-type'] }))
          })
        })
        .on('error', (e) => {
          s.close(() => reject(e))
        })
    })
  })
}

test('GET /api/health is 200 JSON without auth', async () => {
  const { status, body, contentType } = await request('/api/health')
  assert.equal(status, 200)
  assert.match(contentType || '', /json/)
  assert.equal(JSON.parse(body).status, 'ok')
})

test('GET /api is 200 JSON', async () => {
  const { status, body } = await request('/api')
  assert.equal(status, 200)
  const j = JSON.parse(body)
  assert.equal(j.status, 'ok')
  assert.equal(j.service, 'hr-api')
})

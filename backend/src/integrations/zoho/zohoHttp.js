const https = require('https')
const { URL } = require('url')

/**
 * @param {string} url
 * @param {object} opts
 * @param {Record<string, string>=} opts.headers
 * @param {string} [opts.method]
 * @param {string|Buffer} [opts.body]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ status: number, body: string }>}
 */
function httpsRequestJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    const body = opts.body
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'hr-attendance-backend/weekly-reports',
      ...opts.headers,
    }
    if (body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const lib = u.protocol === 'https:' ? https : null
    if (!lib) {
      const err = new Error('Only HTTPS is supported for Zoho')
      err.code = 'ZOHO_API_ERROR'
      reject(err)
      return
    }
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
        timeout: opts.timeoutMs || 20000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode || 0, body: raw, headers: res.headers })
        })
      }
    )
    req.on('error', (err) => {
      const e = new Error(err.message || 'Zoho API request failed')
      e.code = 'ZOHO_API_NETWORK_ERROR'
      e.cause = err
      reject(e)
    })
    const timeoutMs = opts.timeoutMs || 20000
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      const e = new Error(`Zoho API request timed out after ${timeoutMs}ms`)
      e.code = 'ZOHO_API_TIMEOUT'
      reject(e)
    })
    if (body) req.write(body)
    req.end()
  })
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

module.exports = { httpsRequestJson, formEncode }

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
    const timeoutMs = opts.timeoutMs || 20000
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

    // Wall-clock timeout: fires unconditionally after timeoutMs even when Zoho
    // trickle-streams data (a socket-idle timeout would never fire in that case
    // because the socket is technically "active").
    let settled = false
    const wallClock = setTimeout(() => {
      if (settled) return
      settled = true
      req.destroy()
      const e = new Error(`Zoho API request timed out after ${timeoutMs}ms`)
      e.code = 'ZOHO_API_TIMEOUT'
      reject(e)
    }, timeoutMs)

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(wallClock)
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode || 0, body: raw, headers: res.headers })
        })
        res.on('error', (resErr) => {
          if (settled) return
          settled = true
          clearTimeout(wallClock)
          const e = new Error(resErr.message || 'Zoho response stream error')
          e.code = 'ZOHO_API_NETWORK_ERROR'
          e.cause = resErr
          reject(e)
        })
      }
    )
    req.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(wallClock)
      const e = new Error(err.message || 'Zoho API request failed')
      e.code = 'ZOHO_API_NETWORK_ERROR'
      e.cause = err
      reject(e)
    })
    if (body) req.write(body)
    req.end()
  })
}

/**
 * Like httpsRequestJson but returns raw bytes (for Zoho item images, etc.).
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{ status: number, body: Buffer, headers: import('http').IncomingHttpHeaders }>}
 */
function httpsRequestBuffer(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    const body = opts.body
    const timeoutMs = opts.timeoutMs || 20000
    const headers = {
      Accept: '*/*',
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

    let settled = false
    const wallClock = setTimeout(() => {
      if (settled) return
      settled = true
      req.destroy()
      const e = new Error(`Zoho API request timed out after ${timeoutMs}ms`)
      e.code = 'ZOHO_API_TIMEOUT'
      reject(e)
    }, timeoutMs)

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(wallClock)
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers })
        })
        res.on('error', (resErr) => {
          if (settled) return
          settled = true
          clearTimeout(wallClock)
          const e = new Error(resErr.message || 'Zoho response stream error')
          e.code = 'ZOHO_API_NETWORK_ERROR'
          e.cause = resErr
          reject(e)
        })
      }
    )
    req.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(wallClock)
      const e = new Error(err.message || 'Zoho API request failed')
      e.code = 'ZOHO_API_NETWORK_ERROR'
      e.cause = err
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

module.exports = { httpsRequestJson, httpsRequestBuffer, formEncode }

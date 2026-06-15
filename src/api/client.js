import { getApiBaseUrl } from './config.js'

const AUTH_STORAGE_KEY = 'hr-auth'

/** Login and all API calls use paths under `/api/...` (e.g. `POST /api/auth/login`). */
export function resolveApiUrl(path) {
  if (typeof path !== 'string' || path.startsWith('http')) return path
  return `${getApiBaseUrl()}${path}`
}

const BODY_PREVIEW_LEN = 300

function previewBody(text, max = BODY_PREVIEW_LEN) {
  const raw = String(text ?? '')
  return raw.length > max ? `${raw.slice(0, max)}…` : raw
}

function contentTypeLooksJson(ct) {
  const s = (ct || '').toLowerCase()
  return s.includes('application/json') || s.includes('+json')
}

function bodyLooksLikeHtml(text) {
  const t = String(text || '').trimStart()
  return t.startsWith('<!') || t.toLowerCase().startsWith('<html')
}

/** Session uses httpOnly cookie `hr_access`; do not send Bearer from localStorage. */
function getAuthHeaders() {
  return {}
}

/** Remove legacy token blob from older builds (cookie is canonical now). */
export function clearLegacyHrAuthStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch (_) {}
}

const defaultFetchOpts = { credentials: 'include', cache: 'no-store' }

/** Default for most API calls; long jobs pass a higher timeoutMs or use purchase-planning path default. */
export const API_REQUEST_TIMEOUT_MS = 25_000

/** Purchase planning runs Zoho enrichment + Vigil matching synchronously — needs a longer client window. */
export const PURCHASE_PLANNING_TIMEOUT_MS = 120_000

function timeoutMsForPath(path, explicitMs) {
  if (Number(explicitMs) > 0) return Number(explicitMs)
  const normalized = normalizeApiPath(typeof path === 'string' ? path : '')
  if (normalized.includes('/purchase-planning')) return PURCHASE_PLANNING_TIMEOUT_MS
  if (normalized.includes('/prices/ksa/zoho-dimensions')) return 120_000
  if (normalized.includes('/out-of-stock-clearance')) return 480_000
  if (normalized.includes('/payment-clearing')) return 480_000
  if (normalized.includes('/sku-coverage')) return 120_000
  return API_REQUEST_TIMEOUT_MS
}

export function isAbortError(err) {
  if (!err) return false
  if (err.code === 'REQUEST_TIMEOUT') return true
  const name = String(err.name || '')
  if (name === 'AbortError' || name === 'TimeoutError') return true
  if (err.code === 20 || err.code === 'ABORT_ERR') return true
  const msg = String(err.message || '')
  return /signal.*aborted|aborted without reason|request timed out/i.test(msg)
}

function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const { signal: callerSignal, ...rest } = options
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return fetch(url, { ...rest, signal: controller.signal })
    .catch((err) => {
      if (timedOut && isAbortError(err)) throw timeoutError(timeoutMs)
      throw err
    })
    .finally(() => clearTimeout(timer))
}

function timeoutError(timeoutMs) {
  const seconds = Math.round(timeoutMs / 1000)
  const err = new Error(
    `Request timed out after ${seconds}s. The server may still be working — wait and refresh, or try again.`
  )
  err.name = 'AbortError'
  err.code = 'REQUEST_TIMEOUT'
  return err
}

/** Legacy upload URL sometimes still cached in old bundles; canonical route always hits Express. */
function normalizeApiPath(path) {
  if (typeof path !== 'string' || path.startsWith('http')) return path
  return path.replaceAll('/api/sick-leave-document', '/api/attendance/sick-leave-document')
}

/**
 * Expects JSON bodies for API routes. If CloudFront/S3 returns SPA HTML (HTTP 200, text/html), fails with a clear message.
 */
async function handleResponse(res, requestUrl) {
  const url = requestUrl || res.url || ''
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()

  if (res.status === 204) {
    if (!res.ok) {
      const err = new Error(res.statusText || 'Request failed')
      err.status = res.status
      err.url = url
      throw err
    }
    return null
  }
  if (!text) {
    if (!res.ok) {
      const err = new Error(res.statusText || 'Request failed')
      err.status = res.status
      err.url = url
      throw err
    }
    return null
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    const isHtmlResponse =
      bodyLooksLikeHtml(text) || contentType.toLowerCase().includes('text/html')

    console.warn('[api] Non-JSON response', {
      requestUrl: url,
      status: res.status,
      contentType: contentType || '(missing)',
      bodyPreview: previewBody(text),
    })

    const base = getApiBaseUrl()
    const gateway =
      res.status === 502 || res.status === 503 || res.status === 504
        ? ` HTTP ${res.status} often means CloudFront’s /api/* origin timed out or is wrong — ` +
          `set HR_PUBLIC_API_URL to your Express public URL and redeploy the frontend (see .env.deploy.example), ` +
          `or fix the API origin on the distribution.`
        : ''
    const htmlMessage =
      `Server returned non-JSON response from ${url} (HTTP ${res.status}). ` +
      `Got HTML instead of JSON — the page is not reaching your Express API.${gateway} ` +
      `Fix: set your backend URL on the login screen (held in memory for this tab until reload), or add a CloudFront /api/* behavior to your API origin, or set HR_PUBLIC_API_URL / VITE_API_BASE_URL / api-runtime-config.js.`
    const fallbackMessage =
      base === ''
        ? `${htmlMessage} (No API base URL is set.)`
        : `Expected JSON from ${url} (HTTP ${res.status}) but parsing failed. content-type: ${contentType || '(none)'}; API base=${base || '(empty)'}`

    let message
    if (isHtmlResponse) {
      message = htmlMessage
    } else if (!res.ok) {
      message = text.slice(0, 200) || res.statusText || 'Request failed'
    } else {
      message = fallbackMessage
    }

    const err = new Error(message)
    err.status = res.status
    err.url = url
    err.body = { raw: text.slice(0, 400), contentType }
    throw err
  }

  if (!res.ok) {
    let msg = data?.error || res.statusText || 'Request failed'
    if (data?.detail && typeof data.detail === 'string') {
      msg = `${msg}: ${data.detail}`
    }
    if (data?.hint && typeof data.hint === 'string') {
      msg = `${msg} ${data.hint}`
    }
    const err = new Error(msg)
    err.status = res.status
    err.url = url
    err.body = data
    throw err
  }

  if (!contentTypeLooksJson(contentType) && res.ok) {
    console.warn('[api] JSON parsed but Content-Type is not application/json', {
      requestUrl: url,
      status: res.status,
      contentType: contentType || '(missing)',
      bodyPreview: previewBody(text),
    })
  }

  return data
}

function parseFilenameFromContentDisposition(header) {
  if (!header || typeof header !== 'string') return null
  const m =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/i.exec(header)
  if (m) {
    const raw = m[1] || m[2] || m[3]
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

/**
 * GET a binary response (e.g. .xlsx) with the same auth as other API calls.
 * On error, attempts to parse JSON error bodies from the API.
 * Always uses `cache: 'no-store'` so responses are not served from the HTTP cache.
 * @param {string} path
 */
export async function fetchBinary(path) {
  const p = normalizeApiPath(path)
  const url = p.startsWith('http') ? p : resolveApiUrl(p)
  const res = await fetchWithTimeout(url, {
    ...defaultFetchOpts,
    method: 'GET',
    headers: {
      Accept: '*/*',
      ...getAuthHeaders(),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = res.statusText || 'Request failed'
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('json')) {
      try {
        const j = JSON.parse(text)
        if (j && typeof j.error === 'string') msg = j.error
        if (j && j.code) msg = `${msg}${msg.includes(j.code) ? '' : ` (${j.code})`}`
      } catch {
        if (text) msg = text.slice(0, 200)
      }
    } else if (text) {
      msg = text.slice(0, 200) || msg
    }
    const err = new Error(msg)
    err.status = res.status
    err.url = url
    err.body = text
    try {
      err.parsed = JSON.parse(text)
    } catch {
      err.parsed = null
    }
    throw err
  }
  const blob = await res.blob()
  const filename = parseFilenameFromContentDisposition(
    res.headers.get('content-disposition')
  )
  return { blob, filename, contentType: res.headers.get('content-type') }
}

/** POST JSON and receive a binary response (CSV, ZIP, XLSX, etc.) with auth. */
export async function postBinary(path, body = null, opts = {}) {
  const p = normalizeApiPath(path)
  const url = p.startsWith('http') ? p : resolveApiUrl(p)
  const timeoutMs = timeoutMsForPath(p, opts.timeoutMs)
  const res = await fetchWithTimeout(url, {
    ...defaultFetchOpts,
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: body == null ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }, timeoutMs)
  if (!res.ok) {
    const text = await res.text()
    let msg = res.statusText || 'Request failed'
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('json')) {
      try {
        const j = JSON.parse(text)
        if (j && typeof j.error === 'string') msg = j.error
        if (j && j.code) msg = `${msg}${msg.includes(j.code) ? '' : ` (${j.code})`}`
      } catch {
        if (text) msg = text.slice(0, 200)
      }
    } else if (text) {
      msg = text.slice(0, 200) || msg
    }
    const err = new Error(msg)
    err.status = res.status
    err.url = url
    err.body = text
    throw err
  }
  const blob = await res.blob()
  const filename = parseFilenameFromContentDisposition(
    res.headers.get('content-disposition')
  )
  return { blob, filename, contentType: res.headers.get('content-type') }
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = filename || 'download'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(u)
}

async function request(method, path, body = null, opts = {}) {
  path = normalizeApiPath(path)
  const url = path.startsWith('http') ? path : resolveApiUrl(path)
  const timeoutMs = timeoutMsForPath(path, opts.timeoutMs)
  const fetchOpts = { ...opts }
  delete fetchOpts.timeoutMs
  const options = {
    ...defaultFetchOpts,
    ...fetchOpts,
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(fetchOpts.headers || {}),
    },
  }
  if (body != null) options.body = JSON.stringify(body)
  const res = await fetchWithTimeout(url, options, timeoutMs)
  return handleResponse(res, url)
}

async function postForm(path, formData, opts = {}) {
  path = normalizeApiPath(path)
  const url = path.startsWith('http') ? path : resolveApiUrl(path)
  const timeoutMs = timeoutMsForPath(path, opts.timeoutMs)
  const fetchOpts = { ...opts }
  delete fetchOpts.timeoutMs
  const res = await fetchWithTimeout(
    url,
    {
      ...defaultFetchOpts,
      ...fetchOpts,
      method: 'POST',
      body: formData,
      headers: {
        ...getAuthHeaders(),
        ...(fetchOpts.headers || {}),
      },
    },
    timeoutMs
  )
  return handleResponse(res, url)
}

export const api = {
  get: (path, opts) => request('GET', path, null, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  postForm: (path, formData, opts) => postForm(path, formData, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, opts) => request('DELETE', path, null, opts),
}

/**
 * Temporary routing check: GET /api/health with same base URL as other API calls.
 * Use on login with ?apiDebug=1 to verify CloudFront routes /api/* to the backend.
 */
export async function probeApiHealth() {
  const url = resolveApiUrl('/api/health')
  const res = await fetch(url, {
    ...defaultFetchOpts,
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  let isJson = false
  try {
    JSON.parse(text)
    isJson = true
  } catch {
    isJson = false
  }
  return {
    requestUrl: url,
    status: res.status,
    contentType: contentType || '(missing)',
    isJson,
    bodyPreview: previewBody(text, 500),
  }
}

export { getApiBaseUrl, getApiBaseUrl as BASE_URL, AUTH_STORAGE_KEY }

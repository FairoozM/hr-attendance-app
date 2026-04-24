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

function getAuthHeaders() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return {}
    const { token } = JSON.parse(raw)
    if (token) return { Authorization: `Bearer ${token}` }
  } catch (_) {}
  return {}
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
      `Fix: set your backend URL on the login screen (saved in this browser), or add a CloudFront /api/* behavior to your API origin, or set HR_PUBLIC_API_URL / VITE_API_BASE_URL / api-runtime-config.js.`
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
 */
export async function fetchBinary(path) {
  const p = normalizeApiPath(path)
  const url = p.startsWith('http') ? p : resolveApiUrl(p)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      ...getAuthHeaders(),
    },
    cache: 'no-store',
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
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  }
  if (body != null) options.body = JSON.stringify(body)
  if (opts && opts.signal) options.signal = opts.signal
  const res = await fetch(url, options)
  return handleResponse(res, url)
}

async function postForm(path, formData) {
  path = normalizeApiPath(path)
  const url = path.startsWith('http') ? path : resolveApiUrl(path)
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    cache: 'no-store',
    headers: {
      ...getAuthHeaders(),
    },
  })
  return handleResponse(res, url)
}

export const api = {
  get: (path, opts) => request('GET', path, null, opts),
  post: (path, body) => request('POST', path, body),
  postForm: (path, formData) => postForm(path, formData),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
}

/**
 * Temporary routing check: GET /api/health with same base URL as other API calls.
 * Use on login with ?apiDebug=1 to verify CloudFront routes /api/* to the backend.
 */
export async function probeApiHealth() {
  const url = resolveApiUrl('/api/health')
  const res = await fetch(url, {
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

import { API_BASE_URL } from './config.js'

const AUTH_STORAGE_KEY = 'hr-auth'

/** Login and all API calls use paths under `/api/...` (e.g. `POST /api/auth/login`). */
function resolveApiUrl(path) {
  if (typeof path !== 'string' || path.startsWith('http')) return path
  return `${API_BASE_URL}${path}`
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

  const preview = text.slice(0, 280).replace(/\s+/g, ' ')
  const previewSuffix = text.length > 280 ? '…' : ''

  let data
  try {
    data = JSON.parse(text)
  } catch {
    const isHtmlResponse =
      bodyLooksLikeHtml(text) || contentType.toLowerCase().includes('text/html')

    console.warn('[api] Non-JSON response', {
      url,
      status: res.status,
      contentType: contentType || '(missing)',
      preview: preview + previewSuffix,
    })

    const htmlMessage = 'API returned HTML instead of JSON. Check CloudFront /api routing.'
    const fallbackMessage =
      API_BASE_URL === ''
        ? `${htmlMessage} Or set VITE_API_BASE_URL to your API origin and rebuild.`
        : `Expected JSON from ${url} (HTTP ${res.status}) but parsing failed. content-type: ${contentType || '(none)'}; VITE_API_BASE_URL=${API_BASE_URL || '(empty)'}`

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
    const err = new Error(data?.error || res.statusText || 'Request failed')
    err.status = res.status
    err.url = url
    err.body = data
    throw err
  }

  if (!contentTypeLooksJson(contentType) && res.ok) {
    console.warn('[api] JSON parsed but Content-Type is not application/json', {
      url,
      contentType: contentType || '(missing)',
    })
  }

  return data
}

async function request(method, path, body = null) {
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
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  postForm: (path, formData) => postForm(path, formData),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
}

export { API_BASE_URL as BASE_URL, AUTH_STORAGE_KEY }

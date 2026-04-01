const BASE_URL = ''

/** Legacy upload URL sometimes still cached in old bundles; canonical route always hits Express. */
function normalizeApiPath(path) {
  if (typeof path !== 'string' || path.startsWith('http')) return path
  return path.replaceAll('/api/attendance/sick-leave-document', '/api/sick-leave-document')
}

/**
 * Reads fetch response: always JSON for API, or clear error if HTML/non-JSON (e.g. CloudFront/S3).
 */
async function handleResponse(res, requestUrl) {
  const url = requestUrl || res.url || ''
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
    const hint =
      `Server returned non-JSON response from ${url} (HTTP ${res.status}). Check CloudFront behavior/origin for this path.`
    const err = new Error(!res.ok ? text.slice(0, 200) || res.statusText : hint)
    err.status = res.status
    err.url = url
    err.body = { raw: text.slice(0, 400) }
    throw err
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed')
    err.status = res.status
    err.url = url
    err.body = data
    throw err
  }
  return data
}

async function request(method, path, body = null) {
  path = normalizeApiPath(path)
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body != null) options.body = JSON.stringify(body)
  const res = await fetch(url, options)
  return handleResponse(res, url)
}

async function postForm(path, formData) {
  path = normalizeApiPath(path)
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    cache: 'no-store',
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

export { BASE_URL }

const BASE_URL = ''

/**
 * Reads fetch response: always JSON for API, or clear error if HTML/non-JSON (e.g. CloudFront/S3).
 */
async function handleResponse(res) {
  const text = await res.text()
  if (res.status === 204) {
    if (!res.ok) {
      const err = new Error(res.statusText || 'Request failed')
      err.status = res.status
      throw err
    }
    return null
  }
  if (!text) {
    if (!res.ok) {
      const err = new Error(res.statusText || 'Request failed')
      err.status = res.status
      throw err
    }
    return null
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    const hint =
      'Server returned a web page instead of JSON. Check CloudFront: /api/* must go to your API (not S3).'
    const err = new Error(!res.ok ? text.slice(0, 200) || res.statusText : hint)
    err.status = res.status
    err.body = { raw: text.slice(0, 400) }
    throw err
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed')
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

async function request(method, path, body = null) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body != null) options.body = JSON.stringify(body)
  const res = await fetch(url, options)
  return handleResponse(res)
}

async function postForm(path, formData) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  return handleResponse(res)
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  postForm: (path, formData) => postForm(path, formData),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
}

export { BASE_URL }

const BASE_URL = 'http://localhost:5001'


async function request(method, path, body = null) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body != null) options.body = JSON.stringify(body)
  const res = await fetch(url, options)
  if (!res.ok) {
    const err = new Error(res.statusText || 'Request failed')
    err.status = res.status
    try {
      err.body = await res.json()
    } catch (_) {
      err.body = null
    }
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
}

export { BASE_URL }

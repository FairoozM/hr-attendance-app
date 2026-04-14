const trimSlash = (value: string) => value.replace(/\/+$/, "")

declare global {
  interface Window {
    API_RUNTIME_CONFIG?: {
      API_BASE_URL?: string
    }
  }
}

function getAuthHeaders() {
  try {
    const raw = localStorage.getItem("hr-auth")
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed?.token) return { Authorization: `Bearer ${parsed.token}` }
  } catch (_) {}
  return {}
}

export function getApiBaseUrl(): string {
  const runtime = window.API_RUNTIME_CONFIG?.API_BASE_URL?.trim()
  const saved = localStorage.getItem("backendUrl")?.trim()
  const env = import.meta.env.VITE_API_BASE_URL?.trim()

  const base = runtime || saved || env || ""
  return base ? trimSlash(base) : ""
}

export function preloadApiBaseUrl(): string {
  return getApiBaseUrl()
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const base = getApiBaseUrl()
  return `${base}${normalizedPath}`
}

export async function apiFetch(path: string, init?: RequestInit) {
  const url = buildApiUrl(path)
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
    ...init,
  })

  const contentType = response.headers.get("content-type") || ""
  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} | URL: ${url} | Body: ${text.slice(0, 300)}`
    )
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON but got "${contentType || "unknown"}" from ${url}. This usually means the frontend is hitting CloudFront/S3 instead of the Express API. Body preview: ${text.slice(0, 300)}`
    )
  }

  return text ? JSON.parse(text) : null
}

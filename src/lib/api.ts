const trimSlash = (value: string) => value.replace(/\/+$/, "")

declare global {
  interface Window {
    API_RUNTIME_CONFIG?: {
      API_BASE_URL?: string
    }
  }
}

/** In-tab override only (lost on full reload). Production should set HR_PUBLIC_API_URL / api-runtime-config.js. */
let apiBaseUrlMemory = ""

export function setApiBaseUrlMemory(url: string) {
  apiBaseUrlMemory = trimSlash(String(url || "").trim())
}

export function getApiBaseUrlMemory(): string {
  return apiBaseUrlMemory
}

function migrateLegacyBackendUrlOnce() {
  if (typeof localStorage === "undefined") return
  try {
    if (apiBaseUrlMemory) return
    const legacy = localStorage.getItem("backendUrl")?.trim()
    if (legacy) {
      apiBaseUrlMemory = trimSlash(legacy)
      localStorage.removeItem("backendUrl")
    }
  } catch {
    /* ignore */
  }
}

function getAuthHeaders(): Record<string, string> {
  return {}
}

function isLocalDevApiHost(url: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url.startsWith("http") ? url : `http://${url}`).hostname
    return host === "localhost" || host === "127.0.0.1"
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url)
  }
}

export function getApiBaseUrl(): string {
  migrateLegacyBackendUrlOnce()
  const env = import.meta.env.VITE_API_BASE_URL?.trim()

  if (import.meta.env.DEV) {
    const mem = apiBaseUrlMemory.trim()
    if (mem && isLocalDevApiHost(mem)) return trimSlash(mem)
    if (env && isLocalDevApiHost(env)) return trimSlash(env)
    // Always use Vite /api proxy in dev — ignore CloudFront/production URLs in memory or runtime config
    return ""
  }

  const runtime = window.API_RUNTIME_CONFIG?.API_BASE_URL?.trim()
  const base = runtime || apiBaseUrlMemory || env || ""
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

export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = buildApiUrl(path)
  const method = (init?.method || "GET").toUpperCase()
  const hasBody = init?.body != null

  const contentTypeHeader =
    hasBody || method === "POST" || method === "PUT" || method === "PATCH"
      ? { "Content-Type": "application/json" }
      : {}

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...contentTypeHeader,
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
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

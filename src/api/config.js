/**
 * API origin (no trailing slash). Use **getApiBaseUrl()** — it resolves on each call:
 *
 * 1. `window.__HR_API_BASE_URL__` (from `public/api-runtime-config.js`, or overwritten at deploy via `HR_PUBLIC_API_URL`)
 * 2. `localStorage` key `hr_api_base_url` (set from login page in production)
 * 3. `VITE_API_BASE_URL` (build-time)
 * 4. `''` — local dev: Vite proxies `/api` to the backend
 *
 * CloudFront often serves HTML for `/api/*`; setting the backend URL here sends API calls to Express.
 */
export const API_BASE_STORAGE_KEY = 'hr_api_base_url'

function trimBase(s) {
  return String(s || '').trim().replace(/\/$/, '')
}

function readRuntimeApiBase() {
  if (typeof window === 'undefined') return ''
  const v = window.__HR_API_BASE_URL__
  if (v == null || String(v).trim() === '') return ''
  const t = trimBase(v)
  if (!t) return ''
  // Old deploys set this to the SPA CloudFront origin; /api there is S3 → 403 HTML. Treat as
  // unset so localStorage (login “API server”) or VITE_API_BASE_URL can supply the real Express host.
  try {
    if (typeof window.location?.origin === 'string' && trimBase(window.location.origin) === t) {
      return ''
    }
  } catch (_) {}
  return t
}

function readFromStorage() {
  if (typeof window === 'undefined') return ''
  try {
    const ls = localStorage.getItem(API_BASE_STORAGE_KEY)
    if (ls && String(ls).trim()) return trimBase(ls)
  } catch (_) {}
  return ''
}

const fromEnv = trimBase(import.meta.env.VITE_API_BASE_URL || '')

export function getApiBaseUrl() {
  const runtime = readRuntimeApiBase()
  if (runtime) return runtime
  const stored = readFromStorage()
  if (stored) return stored
  return fromEnv
}

/** Persist backend origin for production (same-origin SPA → cross-origin API). */
export function setApiBaseUrlInStorage(url) {
  const t = trimBase(url)
  if (typeof window === 'undefined') return
  try {
    if (!t) localStorage.removeItem(API_BASE_STORAGE_KEY)
    else localStorage.setItem(API_BASE_STORAGE_KEY, t)
  } catch (_) {}
}

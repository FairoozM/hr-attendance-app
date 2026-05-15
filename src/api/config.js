import {
  getApiBaseUrl as resolveApiBaseUrl,
  setApiBaseUrlMemory,
} from '../lib/api'

export const API_BASE_STORAGE_KEY = 'backendUrl'

function trimBase(s) {
  return String(s || '').trim().replace(/\/$/, '')
}

export function getApiBaseUrl() {
  return resolveApiBaseUrl()
}

export function setApiBaseUrlInStorage(url) {
  const t = trimBase(url)
  if (typeof window === 'undefined') return
  setApiBaseUrlMemory(t)
}

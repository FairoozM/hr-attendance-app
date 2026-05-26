/**
 * linearReleaseStorage.js
 *
 * Centralised, safe localStorage helpers for release/deployment tracking data.
 * All reads are guarded against corrupted JSON and missing keys.
 */

const KEYS = {
  MOBILE_RELEASES:    'lifesmile.linear.mobileReleases.v1',
  WEB_DEPLOYMENTS:    'lifesmile.linear.webDeployments.v1',
  RELEASE_APPROVAL:   'lifesmile.linear.releaseApproval.v1',
}

const storageCache = new Map()

function safeLoad(key, defaultVal = null) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      storageCache.delete(key)
      return defaultVal
    }
    const cached = storageCache.get(key)
    if (cached && cached.raw === raw) return cached.value
    const parsed = JSON.parse(raw) ?? defaultVal
    storageCache.set(key, { raw, value: parsed })
    return parsed
  } catch { return defaultVal }
}

export function loadMobileReleases() {
  const data = safeLoad(KEYS.MOBILE_RELEASES, {})
  return Array.isArray(data?.releases) ? data.releases : []
}

export function loadWebDeployments() {
  const data = safeLoad(KEYS.WEB_DEPLOYMENTS, {})
  return Array.isArray(data?.deployments) ? data.deployments : []
}

export function loadReleaseApprovalDraft() {
  return safeLoad(KEYS.RELEASE_APPROVAL, null)
}

export { KEYS }

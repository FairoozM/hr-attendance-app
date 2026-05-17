/**
 * In-memory cache + debounced save hookup for user preferences.
 * Synchronous readers (pricing utils, etc.) use getUserPrefKey / setUserPrefKeyLocal.
 */

let _cache = {}

/** @param {Record<string, unknown>} prefs */
export function hydratePrefCache(prefs) {
  _cache = { ..._cache, ...(prefs && typeof prefs === 'object' ? prefs : {}) }
}

export function clearPrefCache() {
  _cache = {}
}

export function getUserPrefKey(key, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(_cache, key)) {
    const v = _cache[key]
    return v === undefined ? defaultValue : v
  }
  return defaultValue
}

export function setUserPrefKeyLocal(key, value) {
  if (value === undefined) {
    delete _cache[key]
    return
  }
  _cache[key] = value
}

/** @type {null | ((key: string, value: unknown) => void)} */
let _saver = null

export function registerUserPrefSaver(fn) {
  _saver = typeof fn === 'function' ? fn : null
}

/** Update local cache and queue server save (debounced inside provider). */
export function requestUserPrefSave(key, value) {
  setUserPrefKeyLocal(key, value)
  if (_saver) _saver(key, value)
}

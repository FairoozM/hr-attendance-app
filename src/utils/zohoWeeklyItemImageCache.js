/**
 * Client-side cache for Zoho item thumbnails in the weekly report.
 * Complements server + HTTP cache so repeated loads / remounts avoid refetching.
 *
 * Set to `true` to re-enable 2h in-memory cache for thumbs (and use `cache: 'default'`
 * in `fetchBinary` from `ZohoItemThumb`).
 */
export const ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED = false

const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const MAX_ENTRIES = 800

/** @type {Map<string, { blob: Blob, exp: number }>} */
const store = new Map()

function evict() {
  if (store.size < MAX_ENTRIES) return
  const drop = Math.ceil(MAX_ENTRIES * 0.2)
  let n = 0
  for (const k of store.keys()) {
    store.delete(k)
    n += 1
    if (n >= drop) break
  }
}

/**
 * @param {string|number|undefined} itemId
 * @returns {Blob | null}
 */
export function getCachedZohoItemBlob(itemId) {
  if (!ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED) return null
  const k = String(itemId ?? '').trim()
  if (!k) return null
  const e = store.get(k)
  if (!e) return null
  if (Date.now() > e.exp) {
    store.delete(k)
    return null
  }
  return e.blob
}

/**
 * @param {string|number|undefined} itemId
 * @param {Blob} blob
 */
export function setCachedZohoItemBlob(itemId, blob) {
  if (!ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED) return
  const k = String(itemId ?? '').trim()
  if (!k) return
  evict()
  store.set(k, { blob, exp: Date.now() + TTL_MS })
}

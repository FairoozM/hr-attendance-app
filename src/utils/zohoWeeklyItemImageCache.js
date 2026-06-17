/**
 * Client-side cache for Zoho item thumbnails in the weekly report.
 * Keyed by `version:itemId` to align with backend `zohoRepresentativeItem` selection.
 */
import { ZOHO_REP_IMAGE_QUERY_VERSION } from '../config/zohoRepImageVersion'

export const ZOHO_WEEKLY_THUMB_CLIENT_CACHE_ENABLED = true

const TTL_MS = 3 * 60 * 60 * 1000 // 3 hours
const MAX_ENTRIES = 800

function vKey(itemId) {
  return `v${ZOHO_REP_IMAGE_QUERY_VERSION}:${String(itemId ?? '').trim()}`
}

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
  const k = vKey(itemId)
  if (k.length < 4) return null
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
  const k = vKey(itemId)
  if (k.length < 4) return
  evict()
  store.set(k, { blob, exp: Date.now() + TTL_MS })
}

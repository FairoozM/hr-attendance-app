/**
 * In-memory cache for Zoho Inventory item images (weekly report thumbnails).
 * Key includes representative-selection version (see `zohoRepresentativeItem.js`) so rules
 * can be bumped without serving stale image proxy rows across versions.
 */
const { REPRESENTATIVE_IMAGE_CACHE_VERSION } = require('./zohoRepresentativeItem')
const IMAGE_CACHE_ENABLED = true

const TTL_MS = 3 * 60 * 60 * 1000 // 3 hours
const MAX_ENTRIES = 1500

/** @type {Map<string, { buffer: Buffer, contentType: string, storedAt: number }>} */
const store = new Map()

function keyFor(itemId) {
  return `r${String(REPRESENTATIVE_IMAGE_CACHE_VERSION || 0)}:${String(itemId || '').trim()}`
}

function evictIfNeeded() {
  if (store.size < MAX_ENTRIES) return
  const n = Math.ceil(MAX_ENTRIES * 0.15)
  let i = 0
  for (const key of store.keys()) {
    store.delete(key)
    i += 1
    if (i >= n) break
  }
}

/**
 * @param {string} itemId
 * @returns {{ buffer: Buffer, contentType: string } | null}
 */
function get(itemId) {
  if (!IMAGE_CACHE_ENABLED) return null
  if (!String(itemId || '').trim()) return null
  const k = keyFor(itemId)
  const e = store.get(k)
  if (!e) return null
  if (Date.now() - e.storedAt > TTL_MS) {
    store.delete(k)
    return null
  }
  return { buffer: e.buffer, contentType: e.contentType }
}

/**
 * @param {string} itemId
 * @param {{ buffer: Buffer, contentType: string }} payload
 */
function set(itemId, payload) {
  if (!IMAGE_CACHE_ENABLED) return
  if (!String(itemId || '').trim() || !payload || !payload.buffer) return
  const k = keyFor(itemId)
  evictIfNeeded()
  store.set(k, {
    buffer: payload.buffer,
    contentType: payload.contentType || 'image/jpeg',
    storedAt: Date.now(),
  })
}

function clear() {
  store.clear()
}

const MAX_AGE_SEC = Math.floor(TTL_MS / 1000)

module.exports = {
  get,
  set,
  clear,
  TTL_MS,
  MAX_AGE_SEC,
  IMAGE_CACHE_ENABLED,
}

/**
 * In-memory cache for Zoho Inventory item images (weekly report thumbnails).
 * Avoids hitting Zoho on every browser refresh; TTL matches HTTP Cache-Control.
 */

const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const MAX_ENTRIES = 1500

/** @type {Map<string, { buffer: Buffer, contentType: string, storedAt: number }>} */
const store = new Map()

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
  const k = String(itemId || '').trim()
  if (!k) return null
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
  const k = String(itemId || '').trim()
  if (!k || !payload || !payload.buffer) return
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
}

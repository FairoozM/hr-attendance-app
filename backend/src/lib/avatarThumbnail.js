/**
 * Small avatar thumbnails for list UIs (32–40px) — avoid streaming multi‑MB originals from S3.
 */
const sharp = require('sharp')

const MAX_EDGE = 128
const JPEG_QUALITY = 82
const CACHE_TTL_MS = 3 * 60 * 60 * 1000
const MAX_ENTRIES = 800

/** @type {Map<string, { buffer: Buffer, contentType: string, storedAt: number }>} */
const store = new Map()

function cacheGet(key) {
  const e = store.get(key)
  if (!e) return null
  if (Date.now() - e.storedAt > CACHE_TTL_MS) {
    store.delete(key)
    return null
  }
  return e
}

function cacheSet(key, payload) {
  if (store.size >= MAX_ENTRIES) {
    const drop = Math.ceil(MAX_ENTRIES * 0.15)
    let i = 0
    for (const k of store.keys()) {
      store.delete(k)
      i += 1
      if (i >= drop) break
    }
  }
  store.set(key, { ...payload, storedAt: Date.now() })
}

async function resizeToAvatarJpeg(sourceBuffer) {
  return sharp(sourceBuffer, { failOn: 'none' })
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'cover', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

/**
 * @param {string} cacheKey - e.g. S3 object key
 * @param {() => Promise<Buffer|null|undefined>} loadRaw - fetch full object from S3
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
async function getAvatarThumbnail(cacheKey, loadRaw) {
  const key = `avatar:${MAX_EDGE}:${cacheKey}`
  const hit = cacheGet(key)
  if (hit) return { buffer: hit.buffer, contentType: hit.contentType }

  const raw = await loadRaw()
  if (!raw || !raw.length) return null

  let buffer
  try {
    buffer = await resizeToAvatarJpeg(raw)
  } catch (err) {
    console.warn('[avatarThumbnail] resize failed', { cacheKey, message: err?.message })
    return null
  }

  const payload = { buffer, contentType: 'image/jpeg' }
  cacheSet(key, payload)
  return payload
}

module.exports = {
  MAX_EDGE,
  getAvatarThumbnail,
  /** @internal tests */
  _internals: { resizeToAvatarJpeg, cacheGet, cacheSet },
}

/**
 * Persists inventory health base payload to disk so server restarts / deploys
 * do not force a full Zoho refetch on every page load.
 */

const fs = require('fs')
const path = require('path')

const CACHE_DIR = path.join(__dirname, '../data')
const CACHE_FILE = path.join(CACHE_DIR, 'inventory-health-base-cache.json')

function readAllEntries() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {}
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    return parsed && typeof parsed.entries === 'object' ? parsed.entries : {}
  } catch (err) {
    console.warn('[inventory-health] disk cache read failed:', err?.message || err)
    return {}
  }
}

/**
 * @param {string} key
 * @param {{ allowStale?: boolean }} [opts]
 * @returns {{ expiresAt: number, value: object, error: null, stale: boolean } | null}
 */
function readDiskCacheEntry(key, opts = {}) {
  const allowStale = opts.allowStale === true
  const entry = readAllEntries()[key]
  if (!entry || !entry.value || !entry.expiresAt) return null
  const expiresAt = Number(entry.expiresAt)
  const stale = Date.now() > expiresAt
  if (stale && !allowStale) return null
  return {
    expiresAt,
    value: entry.value,
    error: null,
    stale,
  }
}

function writeDiskCacheEntry(key, expiresAt, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const entries = readAllEntries()
    entries[key] = {
      expiresAt: Number(expiresAt),
      savedAt: Date.now(),
      value,
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: 1, entries }))
  } catch (err) {
    console.warn('[inventory-health] disk cache write failed:', err?.message || err)
  }
}

function clearDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE)
  } catch (err) {
    console.warn('[inventory-health] disk cache clear failed:', err?.message || err)
  }
}

module.exports = {
  readDiskCacheEntry,
  writeDiskCacheEntry,
  clearDiskCache,
}

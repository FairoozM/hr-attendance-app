/**
 * Persists inventory health base payload to disk so server restarts / deploys
 * do not force a full Zoho refetch on every page load.
 */

const fs = require('fs')
const path = require('path')

const DEFAULT_CACHE_DIR = path.join(__dirname, '../data')
const CACHE_FILE_NAME = 'inventory-health-base-cache.json'

/** Resolved per call so tests can point INVENTORY_HEALTH_DISK_CACHE_DIR at a temp dir. */
function cacheDir() {
  const override = String(process.env.INVENTORY_HEALTH_DISK_CACHE_DIR || '').trim()
  return override || DEFAULT_CACHE_DIR
}

function cacheFile() {
  return path.join(cacheDir(), CACHE_FILE_NAME)
}

function readAllEntries() {
  try {
    if (!fs.existsSync(cacheFile())) return {}
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
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
    fs.mkdirSync(cacheDir(), { recursive: true })
    const entries = readAllEntries()
    entries[key] = {
      expiresAt: Number(expiresAt),
      savedAt: Date.now(),
      value,
    }
    fs.writeFileSync(cacheFile(), JSON.stringify({ version: 1, entries }))
  } catch (err) {
    console.warn('[inventory-health] disk cache write failed:', err?.message || err)
  }
}

function deleteDiskCacheEntry(key) {
  try {
    if (!fs.existsSync(cacheFile())) return
    const entries = readAllEntries()
    if (!entries[key]) return
    delete entries[key]
    if (Object.keys(entries).length === 0) {
      fs.unlinkSync(cacheFile())
      return
    }
    fs.writeFileSync(cacheFile(), JSON.stringify({ version: 1, entries }))
  } catch (err) {
    console.warn('[inventory-health] disk cache delete failed:', err?.message || err)
  }
}

function clearDiskCache() {
  try {
    if (fs.existsSync(cacheFile())) fs.unlinkSync(cacheFile())
  } catch (err) {
    console.warn('[inventory-health] disk cache clear failed:', err?.message || err)
  }
}

module.exports = {
  readDiskCacheEntry,
  writeDiskCacheEntry,
  deleteDiskCacheEntry,
  clearDiskCache,
}

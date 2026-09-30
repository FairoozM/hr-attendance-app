const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REAL_CACHE_FILE = path.join(__dirname, '../../src/data/inventory-health-base-cache.json')

function snapshot(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

/**
 * Point the inventory health disk cache at a temp dir for this test file and fail
 * if the real backend/src/data cache changes. Call before requiring the service.
 * @param {typeof import('node:test')} test
 */
function isolateInventoryHealthDiskCache(test) {
  const realBefore = snapshot(REAL_CACHE_FILE)
  const previous = process.env.INVENTORY_HEALTH_DISK_CACHE_DIR
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-disk-cache-'))
  process.env.INVENTORY_HEALTH_DISK_CACHE_DIR = dir

  test.after(() => {
    if (previous === undefined) delete process.env.INVENTORY_HEALTH_DISK_CACHE_DIR
    else process.env.INVENTORY_HEALTH_DISK_CACHE_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
    assert.equal(snapshot(REAL_CACHE_FILE), realBefore, 'tests must not modify the real inventory health disk cache')
  })
  return dir
}

module.exports = { isolateInventoryHealthDiskCache }

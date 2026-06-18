/**
 * Permanent on-disk storage for inventory item product images (inventory health dashboard).
 * Images are downloaded once during admin sync and served as static files — never via Zoho proxy URLs.
 */

const fs = require('fs')
const path = require('path')

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/inventory-item-images')
const PUBLIC_PREFIX = '/uploads/inventory-item-images'
const LEGACY_ZOHO_PROXY_PREFIX = '/api/zoho/items/images/'

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
}

function sanitizeItemId(itemId) {
  return String(itemId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
}

function extensionFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  return 'jpg'
}

function localFilePath(itemId, ext) {
  return path.join(UPLOAD_ROOT, `${sanitizeItemId(itemId)}.${ext}`)
}

function publicUrl(itemId, ext) {
  return `${PUBLIC_PREFIX}/${sanitizeItemId(itemId)}.${ext}`
}

function isPermanentCachedImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim()
  return u.startsWith(`${PUBLIC_PREFIX}/`)
}

function isLegacyZohoProxyUrl(url) {
  return typeof url === 'string' && url.includes(LEGACY_ZOHO_PROXY_PREFIX)
}

function fileExistsForPublicUrl(url) {
  if (!isPermanentCachedImageUrl(url)) return false
  const rel = url.slice(PUBLIC_PREFIX.length + 1)
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return false
  const full = path.join(UPLOAD_ROOT, rel)
  try {
    return fs.existsSync(full) && fs.statSync(full).isFile()
  } catch {
    return false
  }
}

/**
 * @returns {Promise<{ imageUrl: string, contentType: string, fileSize: number }>}
 */
async function saveInventoryItemImage(itemId, buffer, contentType) {
  if (!itemId || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Invalid image buffer')
    err.code = 'INVALID_IMAGE_BUFFER'
    throw err
  }

  ensureUploadDir()
  const ext = extensionFromContentType(contentType)
  const filePath = localFilePath(itemId, ext)
  await fs.promises.writeFile(filePath, buffer)
  const normalizedType = contentType || (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
  return {
    imageUrl: publicUrl(itemId, ext),
    contentType: normalizedType,
    fileSize: buffer.length,
  }
}

async function deleteInventoryItemImageFiles(itemId) {
  ensureUploadDir()
  const id = sanitizeItemId(itemId)
  if (!id) return
  let files = []
  try {
    files = await fs.promises.readdir(UPLOAD_ROOT)
  } catch {
    return
  }
  await Promise.all(
    files
      .filter((name) => name.startsWith(`${id}.`))
      .map((name) => fs.promises.unlink(path.join(UPLOAD_ROOT, name)).catch(() => {})),
  )
}

module.exports = {
  UPLOAD_ROOT,
  PUBLIC_PREFIX,
  ensureUploadDir,
  saveInventoryItemImage,
  deleteInventoryItemImageFiles,
  isPermanentCachedImageUrl,
  isLegacyZohoProxyUrl,
  fileExistsForPublicUrl,
  extensionFromContentType,
  sanitizeItemId,
  publicUrl,
  _internals: {
    localFilePath,
  },
}

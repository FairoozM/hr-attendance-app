const crypto = require('crypto')
const path = require('path')
const s3Service = require('../s3Service')
const {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  DOCUMENT_TYPES,
} = require('./isoQmsConstants')

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function extOf(filename) {
  return path.extname(String(filename || '')).toLowerCase()
}

function validateFileType({ fileName, contentType }) {
  const ext = extOf(fileName)
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    const err = new Error(`Unsupported file type: ${ext || '(none)'}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    err.status = 400
    throw err
  }
  if (contentType && !ALLOWED_MIME_TYPES.includes(contentType) && contentType !== 'application/octet-stream') {
    // Allow octet-stream from browsers when extension is valid
    const err = new Error(`Unsupported content type: ${contentType}`)
    err.status = 400
    throw err
  }
  return { extension: ext, contentType: contentType || guessMime(ext) }
}

function validateFileSize(fileSize) {
  const size = Number(fileSize)
  if (!Number.isFinite(size) || size < 0) {
    const err = new Error('Invalid file size')
    err.status = 400
    throw err
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    const err = new Error(`File too large. Maximum ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`)
    err.status = 400
    throw err
  }
  return size
}

function guessMime(ext) {
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  return map[ext] || 'application/octet-stream'
}

/**
 * Parse Life Smile QMS filename patterns into metadata suggestions.
 * Suggestions only — caller must confirm.
 */
function parseFilenameSuggestions(filename) {
  const base = path.basename(String(filename || ''), path.extname(String(filename || '')))
  const upper = base.toUpperCase().replace(/\s+/g, ' ').trim()
  const suggestions = {
    documentCode: null,
    documentType: null,
    revision: null,
    titleHint: base,
    tags: [],
  }

  // LIF-QMS-M-ANX-01A .. 01E
  let m = upper.match(/\bLIF-QMS-M-ANX-0?1([A-E])\b/)
  if (m) {
    suggestions.documentCode = `LIF-QMS-M-ANX-01${m[1]}`
    suggestions.documentType = 'Annexure'
    suggestions.tags.push('quality-manual-annex')
    return suggestions
  }

  // LIF-QMS-M-01
  m = upper.match(/\bLIF-QMS-M-0?1\b/)
  if (m) {
    suggestions.documentCode = 'LIF-QMS-M-01'
    suggestions.documentType = 'Quality Manual'
    return suggestions
  }

  // LIF-QMS-PR-01 .. PR-13
  m = upper.match(/\bLIF-QMS-PR-(\d{1,2})\b/)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 13) {
      suggestions.documentCode = `LIF-QMS-PR-${String(n).padStart(2, '0')}`
      suggestions.documentType = 'Procedure'
      return suggestions
    }
  }

  // LIF-QMS-FO-*
  m = upper.match(/\bLIF-QMS-FO-([0-9A-Z]+)\b/)
  if (m) {
    suggestions.documentCode = `LIF-QMS-FO-${m[1]}`
    suggestions.documentType = 'Form Template'
    return suggestions
  }

  // CA-89 .. CA-103
  m = upper.match(/\bCA-(8[9]|9[0-9]|10[0-3])\b/)
  if (m) {
    suggestions.documentCode = `CA-${m[1]}`
    suggestions.documentType = 'Corrective Action'
    suggestions.tags.push('corrective-action')
    return suggestions
  }

  // MRM like 02-2024 / 02-2025
  m = upper.match(/\b(?:MRM[-_\s]?)?(\d{2})-?(20\d{2})\b/)
  if (m && /MRM|MANAGEMENT\s*REVIEW/i.test(base)) {
    suggestions.documentCode = `MRM-${m[1]}-${m[2]}`
    suggestions.documentType = 'Management Review Record'
    suggestions.tags.push('management-review')
    return suggestions
  }
  m = upper.match(/\bMRM[-_\s]?(\d{2})[-_]?(\d{4})\b/)
  if (m) {
    suggestions.documentCode = `MRM-${m[1]}-${m[2]}`
    suggestions.documentType = 'Management Review Record'
    return suggestions
  }

  // Audit schedules 01-2024 / 01-2025
  m = upper.match(/\b(?:AUDIT[-_\s]?)?(\d{2})-?(20\d{2})\b/)
  if (m && /AUDIT/i.test(base)) {
    suggestions.documentCode = `AUDIT-${m[1]}-${m[2]}`
    suggestions.documentType = 'Audit Record'
    suggestions.tags.push('audit')
    return suggestions
  }

  // Revision hint Rev-01 / R01 / _Rev00
  const rev = upper.match(/\bREV(?:ISION)?[-_.\s]?(\d{1,3})\b/) || upper.match(/\bR[-_]?(\d{1,3})\b/)
  if (rev) suggestions.revision = rev[1].padStart(2, '0')

  if (DOCUMENT_TYPES.includes(suggestions.documentType) === false && suggestions.documentType) {
    // keep as suggested even if not in list — validation elsewhere
  }

  return suggestions
}

function createIsoQmsDocKey(documentId, revisionLabel, fileName) {
  return s3Service.createIsoQmsDocKey(documentId, revisionLabel, fileName)
}

/**
 * Presign flow: client receives uploadUrl + storageKey, PUTs file, then confirms.
 */
async function preparePresignUpload({
  documentId = 'new',
  revisionLabel = 'draft',
  fileName,
  contentType,
  fileSize,
}) {
  validateFileType({ fileName, contentType })
  validateFileSize(fileSize)
  const key = createIsoQmsDocKey(documentId, revisionLabel, fileName)
  const mime = contentType || guessMime(extOf(fileName))
  const uploadUrl = await s3Service.getUploadUrl({ key, contentType: mime })
  return {
    uploadUrl,
    storageKey: key,
    contentType: mime,
    suggestions: parseFilenameSuggestions(fileName),
  }
}

/**
 * After client PUT — returns normalized file meta for document service.
 * Checksum may be provided by client or computed server-side later.
 */
function confirmUploadAfterPresign({
  storageKey,
  fileName,
  contentType,
  fileSize,
  checksumSha256 = null,
}) {
  if (!storageKey || !String(storageKey).startsWith('iso-qms/')) {
    const err = new Error('Invalid ISO QMS storage key')
    err.status = 403
    throw err
  }
  validateFileType({ fileName, contentType })
  validateFileSize(fileSize)
  return {
    storageKey: String(storageKey),
    originalFilename: String(fileName),
    fileType: contentType || guessMime(extOf(fileName)),
    fileSize: Number(fileSize),
    checksumSha256: checksumSha256 ? String(checksumSha256).toLowerCase() : null,
    suggestions: parseFilenameSuggestions(fileName),
  }
}

/**
 * Server-side multipart path: put buffer to S3 with a unique key.
 */
async function uploadBufferToS3({
  documentId = 'new',
  revisionLabel = 'draft',
  fileName,
  contentType,
  buffer,
}) {
  validateFileType({ fileName, contentType })
  validateFileSize(buffer.length)
  const key = createIsoQmsDocKey(documentId, revisionLabel, fileName)
  const mime = contentType || guessMime(extOf(fileName))
  await s3Service.putObjectBuffer({ key, body: buffer, contentType: mime })
  return {
    storageKey: key,
    originalFilename: String(fileName),
    fileType: mime,
    fileSize: buffer.length,
    checksumSha256: computeSha256(buffer),
    suggestions: parseFilenameSuggestions(fileName),
  }
}

module.exports = {
  computeSha256,
  validateFileType,
  validateFileSize,
  parseFilenameSuggestions,
  createIsoQmsDocKey,
  preparePresignUpload,
  confirmUploadAfterPresign,
  uploadBufferToS3,
  guessMime,
  MAX_FILE_SIZE_BYTES,
}

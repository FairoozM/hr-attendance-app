const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/sick-leave')

function ensureDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
}

ensureDir()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir()
    cb(null, UPLOAD_ROOT)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const safe =
      ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : ''
    cb(null, `${crypto.randomUUID()}${safe}`)
  },
})

function fileFilter(_req, file, cb) {
  const ok =
    file.mimetype === 'application/pdf' ||
    file.mimetype.startsWith('image/')
  cb(null, ok)
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
})

module.exports = { upload, UPLOAD_ROOT }

const { query } = require('../../db')
const s3Service = require('../s3Service')

function tryRequire(name) {
  try {
    return require(name)
  } catch {
    return null
  }
}

async function updateExtraction(versionId, { status, text = null, error = null }) {
  const id = Number(versionId)
  if (text != null) {
    await query(
      `UPDATE iso_document_versions
       SET extraction_status = $1,
           extracted_text = $2,
           extraction_error = $3,
           search_vector = to_tsvector('english', coalesce($2, '')),
           updated_at = NOW()
       WHERE id = $4`,
      [status, text, error, id]
    )
  } else {
    await query(
      `UPDATE iso_document_versions
       SET extraction_status = $1,
           extraction_error = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [status, error, id]
    )
  }
}

async function extractFromBuffer(fileType, originalFilename, buffer) {
  const name = String(originalFilename || '').toLowerCase()
  const mime = String(fileType || '').toLowerCase()

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    const pdfParse = tryRequire('pdf-parse')
    if (!pdfParse) {
      return {
        status: 'Completed with warning',
        text: null,
        error: 'pdf-parse not installed; PDF text extraction skipped',
      }
    }
    const result = await pdfParse(buffer)
    return { status: 'Completed', text: String(result?.text || '').slice(0, 500000), error: null }
  }

  if (
    mime.includes('wordprocessingml') ||
    name.endsWith('.docx') ||
    mime === 'application/msword' ||
    name.endsWith('.doc')
  ) {
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      return {
        status: 'Completed with warning',
        text: null,
        error: 'Legacy .doc extraction not available; download original file',
      }
    }
    const mammoth = tryRequire('mammoth')
    if (!mammoth) {
      return {
        status: 'Completed with warning',
        text: null,
        error: 'mammoth not installed; DOCX text extraction skipped',
      }
    }
    const result = await mammoth.extractRawText({ buffer })
    return { status: 'Completed', text: String(result?.value || '').slice(0, 500000), error: null }
  }

  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls')
  ) {
    const XLSX = tryRequire('xlsx')
    if (!XLSX) {
      return {
        status: 'Completed with warning',
        text: null,
        error: 'xlsx not available',
      }
    }
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const parts = []
    for (const sheetName of workbook.SheetNames || []) {
      parts.push(`# ${sheetName}`)
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      if (csv) parts.push(csv)
    }
    return { status: 'Completed', text: parts.join('\n').slice(0, 500000), error: null }
  }

  if (mime.startsWith('text/') || name.endsWith('.csv') || name.endsWith('.txt')) {
    return { status: 'Completed', text: buffer.toString('utf8').slice(0, 500000), error: null }
  }

  if (mime.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)) {
    return {
      status: 'Completed with warning',
      text: null,
      error: 'OCR not configured; image marked pending OCR / completed with warning',
    }
  }

  return {
    status: 'Completed with warning',
    text: null,
    error: `No extractor for type ${mime || name}`,
  }
}

async function runExtraction(versionId) {
  const id = Number(versionId)
  const result = await query(`SELECT * FROM iso_document_versions WHERE id = $1`, [id])
  const row = result.rows[0]
  if (!row) return

  await updateExtraction(id, { status: 'Processing' })
  try {
    const buffer = await s3Service.getObjectBuffer({ key: row.storage_key })
    if (!buffer) {
      await updateExtraction(id, { status: 'Failed', error: 'Empty or missing S3 object' })
      return
    }
    const extracted = await extractFromBuffer(row.file_type, row.original_filename, buffer)
    await updateExtraction(id, {
      status: extracted.status,
      text: extracted.text,
      error: extracted.error,
    })
  } catch (err) {
    await updateExtraction(id, {
      status: 'Failed',
      error: String(err.message || err).slice(0, 2000),
    })
  }
}

function queueExtraction(versionId) {
  const id = Number(versionId)
  if (!Number.isFinite(id)) return
  setImmediate(() => {
    runExtraction(id).catch((err) => {
      console.error('[iso-qms] extraction failed for version', id, err.message || err)
    })
  })
}

async function retryExtraction(versionId) {
  const id = Number(versionId)
  await updateExtraction(id, { status: 'Pending', error: null })
  await runExtraction(id)
  const result = await query(
    `SELECT id, extraction_status, extraction_error FROM iso_document_versions WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

module.exports = {
  queueExtraction,
  retryExtraction,
  runExtraction,
  extractFromBuffer,
  updateExtraction,
}

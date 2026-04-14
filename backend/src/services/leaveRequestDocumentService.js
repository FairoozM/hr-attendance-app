/**
 * Annual leave request letter (PDF). Template + renderer live under `src/documents/`.
 * For Word output later, add a parallel renderer (e.g. `docx` package) using the same context from
 * `leaveRequestVacationContext.js`.
 */
const annualLeaveService = require('./annualLeaveService')
const s3Service = require('./s3Service')
const {
  buildLeaveRequestVacationContext,
  validateLeaveRequestVacationContext,
} = require('../documents/leaveRequestVacationContext')
const { renderLeaveRequestVacationPdf } = require('../documents/leaveRequestVacationLetterPdf')

function hasS3Bucket() {
  return Boolean(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET)
}

async function buildPdfBufferFromRow(row) {
  const ctx = buildLeaveRequestVacationContext(row)
  const { ok, errors } = validateLeaveRequestVacationContext(ctx)
  if (!ok) {
    const err = new Error(errors.join('; '))
    err.code = 'LETTER_VALIDATION'
    throw err
  }
  let signatureImageBuffer = null
  if (row.signature_doc_key && hasS3Bucket()) {
    try {
      signatureImageBuffer = await s3Service.getObjectBuffer({ key: row.signature_doc_key })
    } catch (e) {
      console.warn('[leave-letter] Signature image load failed, continuing without signature:', e.message)
    }
  }
  return renderLeaveRequestVacationPdf(ctx, { signatureImageBuffer })
}

/**
 * PDF bytes for preview/download: prefer stored S3 object; otherwise render from DB.
 */
async function getPdfBufferForLeave(leaveId) {
  const row = await annualLeaveService.findByIdWithEmployee(leaveId)
  if (!row) {
    const err = new Error('Leave request not found')
    err.code = 'NOT_FOUND'
    throw err
  }
  if (hasS3Bucket() && row.leave_request_pdf_key && !row.signature_doc_key) {
    try {
      const buf = await s3Service.getObjectBuffer({ key: row.leave_request_pdf_key })
      if (buf && buf.length > 0) return buf
    } catch (e) {
      console.warn('[leave-letter] Stored PDF read failed, rendering from data:', e.message)
    }
  }
  return buildPdfBufferFromRow(row)
}

/**
 * Generates PDF, uploads to S3 when configured, updates annual_leave row.
 * Deletes previous S3 object after successful upload.
 */
async function generateAndStoreLeaveLetter(leaveId) {
  const row = await annualLeaveService.findByIdWithEmployee(leaveId)
  if (!row) {
    const err = new Error('Leave request not found')
    err.code = 'NOT_FOUND'
    throw err
  }
  const pdfBuffer = await buildPdfBufferFromRow(row)
  const generatedAt = new Date()
  const oldKey = row.leave_request_pdf_key || null

  if (!hasS3Bucket()) {
    return { stored: false, message: 'S3 not configured; PDF is generated on demand only.' }
  }

  const newKey = s3Service.createAnnualLeaveLetterKey(leaveId)
  await s3Service.putObjectBuffer({ key: newKey, body: pdfBuffer, contentType: 'application/pdf' })
  await annualLeaveService.updateLeaveRequestPdf(leaveId, {
    pdfKey: newKey,
    generatedAt,
  })
  if (oldKey && oldKey !== newKey) {
    try {
      await s3Service.deleteObjectIfExists(oldKey)
    } catch (e) {
      console.warn('[leave-letter] Failed to delete previous PDF object:', e.message)
    }
  }
  return { stored: true, pdfKey: newKey, generatedAt: generatedAt.toISOString() }
}

module.exports = {
  getPdfBufferForLeave,
  generateAndStoreLeaveLetter,
  buildPdfBufferFromRow,
  hasS3Bucket,
}

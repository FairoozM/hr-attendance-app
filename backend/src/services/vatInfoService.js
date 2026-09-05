const { query } = require('../db')
const s3Service = require('./s3Service')

const BASE_FIELDS = `
  id,
  company_name,
  vat_number,
  country,
  date_first_registered,
  vat_pct,
  vat_filings,
  agent,
  charges_of_filing,
  created_at,
  updated_at
`

const CERT_FIELDS = `
  id,
  vat_info_id,
  file_name,
  s3_key,
  file_type,
  file_size,
  uploaded_by,
  uploaded_at
`

const ALLOWED_CERT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/gif',
])

const ALLOWED_CERT_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.gif'])
const MAX_CERT_BYTES = 10 * 1024 * 1024

function mapCertificate(row) {
  if (!row) return null
  return {
    id: row.id,
    vat_info_id: row.vat_info_id,
    file_name: row.file_name,
    file_type: row.file_type,
    file_size: row.file_size,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
  }
}

function isAllowedCertificate({ fileName, contentType }) {
  const type = String(contentType || '').toLowerCase().trim()
  if (type && ALLOWED_CERT_TYPES.has(type)) return true
  const name = String(fileName || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return ALLOWED_CERT_EXTS.has(name.slice(dot))
}

async function listCertificatesForVatIds(vatInfoIds) {
  if (!vatInfoIds.length) return new Map()
  const result = await query(
    `SELECT ${CERT_FIELDS}
     FROM vat_info_certificates
     WHERE vat_info_id = ANY($1::int[])
     ORDER BY uploaded_at ASC, id ASC`,
    [vatInfoIds]
  )
  const byVatId = new Map()
  for (const row of result.rows) {
    const key = String(row.vat_info_id)
    if (!byVatId.has(key)) byVatId.set(key, [])
    byVatId.get(key).push(mapCertificate(row))
  }
  return byVatId
}

async function findAll() {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM vat_info
     ORDER BY country ASC, company_name ASC, id ASC`
  )
  const rows = result.rows
  const certMap = await listCertificatesForVatIds(rows.map((r) => r.id))
  return rows.map((row) => ({
    ...row,
    certificates: certMap.get(String(row.id)) || [],
  }))
}

async function findById(id) {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM vat_info
     WHERE id = $1`,
    [id]
  )
  const row = result.rows[0] || null
  if (!row) return null
  const certMap = await listCertificatesForVatIds([row.id])
  return {
    ...row,
    certificates: certMap.get(String(row.id)) || [],
  }
}

async function create(payload) {
  const result = await query(
    `INSERT INTO vat_info (
      company_name, vat_number, country, date_first_registered,
      vat_pct, vat_filings, agent, charges_of_filing
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING ${BASE_FIELDS}`,
    [
      payload.company_name,
      payload.vat_number,
      payload.country,
      payload.date_first_registered,
      payload.vat_pct,
      payload.vat_filings,
      payload.agent,
      payload.charges_of_filing,
    ]
  )
  return { ...result.rows[0], certificates: [] }
}

async function update(id, payload) {
  const result = await query(
    `UPDATE vat_info
     SET company_name = $2,
         vat_number = $3,
         country = $4,
         date_first_registered = $5,
         vat_pct = $6,
         vat_filings = $7,
         agent = $8,
         charges_of_filing = $9,
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${BASE_FIELDS}`,
    [
      id,
      payload.company_name,
      payload.vat_number,
      payload.country,
      payload.date_first_registered,
      payload.vat_pct,
      payload.vat_filings,
      payload.agent,
      payload.charges_of_filing,
    ]
  )
  const row = result.rows[0] || null
  if (!row) return null
  const certMap = await listCertificatesForVatIds([row.id])
  return {
    ...row,
    certificates: certMap.get(String(row.id)) || [],
  }
}

async function remove(id) {
  const existing = await findById(id)
  if (!existing) return false

  const keys = await query(
    `SELECT s3_key FROM vat_info_certificates WHERE vat_info_id = $1`,
    [id]
  )
  for (const row of keys.rows) {
    await s3Service.deleteObjectIfExists(row.s3_key).catch(() => {})
  }

  const result = await query('DELETE FROM vat_info WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

async function listCertificates(vatInfoId) {
  const result = await query(
    `SELECT ${CERT_FIELDS}
     FROM vat_info_certificates
     WHERE vat_info_id = $1
     ORDER BY uploaded_at ASC, id ASC`,
    [vatInfoId]
  )
  return result.rows.map(mapCertificate)
}

async function getCertificateUploadUrl(vatInfoId, { fileName, contentType, fileSize }) {
  if (!isAllowedCertificate({ fileName, contentType })) {
    const err = new Error('Only PDF, JPEG, and GIF certificates are allowed')
    err.status = 400
    throw err
  }
  const size = Number(fileSize)
  if (Number.isFinite(size) && size > MAX_CERT_BYTES) {
    const err = new Error('Certificate file must be 10 MB or smaller')
    err.status = 400
    throw err
  }
  const s3Key = s3Service.createVatCertificateKey(vatInfoId, fileName)
  const uploadUrl = await s3Service.getUploadUrl({ key: s3Key, contentType })
  return { uploadUrl, s3Key }
}

async function saveCertificate(vatInfoId, { s3Key, fileName, fileType, fileSize, uploadedBy }) {
  if (!isAllowedCertificate({ fileName, contentType: fileType })) {
    const err = new Error('Only PDF, JPEG, and GIF certificates are allowed')
    err.status = 400
    throw err
  }
  const size = Number(fileSize)
  if (Number.isFinite(size) && size > MAX_CERT_BYTES) {
    const err = new Error('Certificate file must be 10 MB or smaller')
    err.status = 400
    throw err
  }
  if (!s3Key || !String(s3Key).startsWith(`vat-certificates/${vatInfoId}/`)) {
    const err = new Error('Invalid certificate upload key')
    err.status = 400
    throw err
  }

  const result = await query(
    `INSERT INTO vat_info_certificates (
      vat_info_id, file_name, s3_key, file_type, file_size, uploaded_by
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING ${CERT_FIELDS}`,
    [
      vatInfoId,
      fileName,
      s3Key,
      fileType || null,
      Number.isFinite(size) ? size : null,
      uploadedBy || null,
    ]
  )
  return mapCertificate(result.rows[0])
}

async function findCertificate(vatInfoId, certificateId) {
  const result = await query(
    `SELECT ${CERT_FIELDS}
     FROM vat_info_certificates
     WHERE id = $1 AND vat_info_id = $2`,
    [certificateId, vatInfoId]
  )
  return result.rows[0] || null
}

async function getCertificateDownloadUrl(vatInfoId, certificateId) {
  const row = await findCertificate(vatInfoId, certificateId)
  if (!row) return null
  const downloadUrl = await s3Service.getDownloadUrl({ key: row.s3_key })
  return { ...mapCertificate(row), downloadUrl }
}

async function deleteCertificate(vatInfoId, certificateId) {
  const row = await findCertificate(vatInfoId, certificateId)
  if (!row) return false
  await s3Service.deleteObjectIfExists(row.s3_key).catch(() => {})
  const result = await query(
    `DELETE FROM vat_info_certificates WHERE id = $1 AND vat_info_id = $2 RETURNING id`,
    [certificateId, vatInfoId]
  )
  return result.rowCount > 0
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
  listCertificates,
  getCertificateUploadUrl,
  saveCertificate,
  getCertificateDownloadUrl,
  deleteCertificate,
  ALLOWED_CERT_TYPES,
  MAX_CERT_BYTES,
}

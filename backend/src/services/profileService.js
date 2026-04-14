const { query } = require('../db')
const s3Service = require('./s3Service')

const PROFILE_COLS = `
  e.id, e.employee_code, e.full_name, e.department, e.is_active, e.created_at,
  e.joining_date, e.photo_url, e.photo_doc_key, e.phone, e.nationality,
  e.date_of_birth, e.gender, e.marital_status,
  e.personal_email, e.work_email, e.current_address, e.city, e.country,
  e.designation, e.work_location, e.manager_name, e.employment_status,
  e.emergency_contact_name, e.emergency_contact_relationship,
  e.emergency_contact_phone, e.emergency_contact_alt_phone,
  e.bank_name, e.account_holder_name, e.iban,
  e.passport_number, e.passport_issue_date, e.passport_expiry_date, e.passport_doc_key,
  e.visa_number, e.visa_issue_date, e.visa_expiry_date, e.visa_doc_key,
  e.emirates_id, e.emirates_id_issue_date, e.emirates_id_expiry_date, e.emirates_id_doc_key,
  e.signature_doc_key,
  e.alternate_employee_id,
  alt.full_name AS alternate_employee_name
`

async function getFullProfile(employeeId) {
  const result = await query(
    `SELECT ${PROFILE_COLS}
     FROM employees e
     LEFT JOIN employees alt ON alt.id = e.alternate_employee_id
     WHERE e.id = $1`,
    [employeeId]
  )
  return result.rows[0] || null
}

async function attachDocUrls(profile) {
  if (!profile) return profile
  const p = { ...profile }
  const docFields = [
    ['passport_doc_key', 'passport_doc_url'],
    ['visa_doc_key', 'visa_doc_url'],
    ['emirates_id_doc_key', 'emirates_id_doc_url'],
    ['photo_doc_key', 'photo_doc_url_signed'],
    ['signature_doc_key', 'signature_doc_url'],
  ]
  for (const [keyField, urlField] of docFields) {
    if (p[keyField]) {
      try {
        p[urlField] = await s3Service.getDownloadUrl({ key: p[keyField], expiresIn: 3600 })
      } catch {
        p[urlField] = null
      }
    } else {
      p[urlField] = null
    }
  }
  return p
}

function parseDate(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function parseTrim(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function parseNullableInt(v) {
  if (v == null || v === '') return null
  const n = parseInt(String(v), 10)
  if (Number.isNaN(n) || n < 1) return null
  return n
}

const UPDATABLE_FIELDS = [
  ['full_name', parseTrim],
  ['joining_date', parseDate],
  ['phone', parseTrim],
  ['nationality', parseTrim],
  ['date_of_birth', parseDate],
  ['gender', parseTrim],
  ['marital_status', parseTrim],
  ['personal_email', parseTrim],
  ['work_email', parseTrim],
  ['current_address', parseTrim],
  ['city', parseTrim],
  ['country', parseTrim],
  ['designation', parseTrim],
  ['work_location', parseTrim],
  ['manager_name', parseTrim],
  ['employment_status', parseTrim],
  ['emergency_contact_name', parseTrim],
  ['emergency_contact_relationship', parseTrim],
  ['emergency_contact_phone', parseTrim],
  ['emergency_contact_alt_phone', parseTrim],
  ['bank_name', parseTrim],
  ['account_holder_name', parseTrim],
  ['iban', parseTrim],
  ['passport_number', parseTrim],
  ['passport_issue_date', parseDate],
  ['passport_expiry_date', parseDate],
  ['visa_number', parseTrim],
  ['visa_issue_date', parseDate],
  ['visa_expiry_date', parseDate],
  ['emirates_id', parseTrim],
  ['emirates_id_issue_date', parseDate],
  ['emirates_id_expiry_date', parseDate],
  ['photo_url', parseTrim],
  ['alternate_employee_id', parseNullableInt],
]

async function updateProfile(employeeId, data) {
  const setClauses = []
  const values = [employeeId]
  let idx = 2

  for (const [field, parser] of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      setClauses.push(`${field} = $${idx}`)
      values.push(parser(data[field]))
      idx++
    }
  }

  if (setClauses.length === 0) return getFullProfile(employeeId)

  const result = await query(
    `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id`,
    values
  )
  if (!result.rowCount) return null
  return getFullProfile(employeeId)
}

const DOC_KEY_FIELD_MAP = {
  passport: 'passport_doc_key',
  visa: 'visa_doc_key',
  'emirates-id': 'emirates_id_doc_key',
  photo: 'photo_doc_key',
  signature: 'signature_doc_key',
}

async function updateDocKey(employeeId, docType, key) {
  const field = DOC_KEY_FIELD_MAP[docType]
  if (!field) throw new Error(`Unknown document type: ${docType}`)

  const existing = await getFullProfile(employeeId)
  if (existing && existing[field]) {
    try {
      await s3Service.deleteObjectIfExists(existing[field])
    } catch (e) {
      console.warn('[profileService] S3 delete old doc failed:', e.message)
    }
  }

  await query(`UPDATE employees SET ${field} = $2 WHERE id = $1`, [employeeId, key])
  return s3Service.getDownloadUrl({ key, expiresIn: 3600 })
}

async function deleteDocKey(employeeId, docType) {
  const field = DOC_KEY_FIELD_MAP[docType]
  if (!field) throw new Error(`Unknown document type: ${docType}`)

  const existing = await getFullProfile(employeeId)
  if (existing && existing[field]) {
    try {
      await s3Service.deleteObjectIfExists(existing[field])
    } catch (e) {
      console.warn('[profileService] S3 delete failed:', e.message)
    }
  }

  await query(`UPDATE employees SET ${field} = NULL WHERE id = $1`, [employeeId])
}

module.exports = { getFullProfile, attachDocUrls, updateProfile, updateDocKey, deleteDocKey }

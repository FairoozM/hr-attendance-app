const { query } = require('../db')
const s3Service = require('./s3Service')

const PROFILE_COLS = `
  id, employee_code, full_name, department, is_active, created_at,
  joining_date, photo_url, photo_doc_key, phone, nationality,
  date_of_birth, gender, marital_status,
  personal_email, work_email, current_address, city, country,
  designation, work_location, manager_name, employment_status,
  emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, emergency_contact_alt_phone,
  bank_name, account_holder_name, iban,
  passport_number, passport_issue_date, passport_expiry_date, passport_doc_key,
  visa_number, visa_issue_date, visa_expiry_date, visa_doc_key,
  emirates_id, emirates_id_issue_date, emirates_id_expiry_date, emirates_id_doc_key
`

async function getFullProfile(employeeId) {
  const result = await query(
    `SELECT ${PROFILE_COLS} FROM employees WHERE id = $1`,
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

const UPDATABLE_FIELDS = [
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

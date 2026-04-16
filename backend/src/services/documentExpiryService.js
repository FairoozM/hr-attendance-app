const { query } = require('../db')

const BASE_FIELDS = `
  id,
  name,
  document_type,
  company,
  expiry_date,
  reminder_days,
  renewal_frequency,
  period_covered,
  notes,
  workflow_status,
  created_at,
  updated_at
`

async function findAll() {
  const result = await query(
    `SELECT ${BASE_FIELDS} FROM document_expiry ORDER BY expiry_date ASC NULLS LAST, id ASC`
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT ${BASE_FIELDS} FROM document_expiry WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function create(payload) {
  const result = await query(
    `INSERT INTO document_expiry (
      name, document_type, company, expiry_date, reminder_days,
      renewal_frequency, period_covered, notes, workflow_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING ${BASE_FIELDS}`,
    [
      payload.name,
      payload.document_type,
      payload.company,
      payload.expiry_date || null,
      payload.reminder_days,
      payload.renewal_frequency,
      payload.period_covered,
      payload.notes,
      payload.workflow_status,
    ]
  )
  return result.rows[0]
}

async function update(id, payload) {
  const result = await query(
    `UPDATE document_expiry
     SET name             = $2,
         document_type    = $3,
         company          = $4,
         expiry_date      = $5,
         reminder_days    = $6,
         renewal_frequency= $7,
         period_covered   = $8,
         notes            = $9,
         workflow_status  = $10,
         updated_at       = NOW()
     WHERE id = $1
     RETURNING ${BASE_FIELDS}`,
    [
      id,
      payload.name,
      payload.document_type,
      payload.company,
      payload.expiry_date || null,
      payload.reminder_days,
      payload.renewal_frequency,
      payload.period_covered,
      payload.notes,
      payload.workflow_status,
    ]
  )
  return result.rows[0] || null
}

async function remove(id) {
  const result = await query('DELETE FROM document_expiry WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

module.exports = { findAll, findById, create, update, remove }

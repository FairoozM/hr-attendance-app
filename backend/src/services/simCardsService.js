const { query } = require('../db')

const BASE_FIELDS = `
  id,
  number,
  remarks,
  person,
  imei_number,
  mobile_number,
  monthly_charges_aed,
  usage,
  type,
  issued,
  created_at,
  updated_at
`

async function findAll() {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM sim_cards
     ORDER BY id ASC`
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM sim_cards
     WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function create(payload) {
  const result = await query(
    `INSERT INTO sim_cards (
      number, remarks, person, imei_number, mobile_number,
      monthly_charges_aed, usage, type, issued
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING ${BASE_FIELDS}`,
    [
      payload.number,
      payload.remarks,
      payload.person,
      payload.imei_number,
      payload.mobile_number,
      payload.monthly_charges_aed,
      payload.usage,
      payload.type,
      payload.issued,
    ]
  )
  return result.rows[0]
}

async function update(id, payload) {
  const result = await query(
    `UPDATE sim_cards
     SET number = $2,
         remarks = $3,
         person = $4,
         imei_number = $5,
         mobile_number = $6,
         monthly_charges_aed = $7,
         usage = $8,
         type = $9,
         issued = $10,
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${BASE_FIELDS}`,
    [
      id,
      payload.number,
      payload.remarks,
      payload.person,
      payload.imei_number,
      payload.mobile_number,
      payload.monthly_charges_aed,
      payload.usage,
      payload.type,
      payload.issued,
    ]
  )
  return result.rows[0] || null
}

async function remove(id) {
  const result = await query('DELETE FROM sim_cards WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
}

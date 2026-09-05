const { query } = require('../db')

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

async function findAll() {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM vat_info
     ORDER BY country ASC, company_name ASC, id ASC`
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT ${BASE_FIELDS}
     FROM vat_info
     WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
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
  return result.rows[0]
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
  return result.rows[0] || null
}

async function remove(id) {
  const result = await query('DELETE FROM vat_info WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
}

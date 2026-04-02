const { query } = require('../db')

const EMPLOYEE_ROW = `id, employee_code, full_name, department, is_active, created_at,
  joining_date, photo_url, phone, emirates_id, passport_number, nationality`

async function findAll() {
  const result = await query(
    `SELECT ${EMPLOYEE_ROW} FROM employees ORDER BY id`
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT ${EMPLOYEE_ROW} FROM employees WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function findByEmployeeCode(employeeCode, excludeId = null) {
  const sql =
    excludeId == null
      ? 'SELECT id FROM employees WHERE LOWER(employee_code) = LOWER($1)'
      : 'SELECT id FROM employees WHERE LOWER(employee_code) = LOWER($1) AND id != $2'
  const params = excludeId == null ? [employeeCode] : [employeeCode, excludeId]
  const result = await query(sql, params)
  return result.rows[0] || null
}

async function create({
  employee_code,
  full_name,
  department,
  is_active = true,
  joining_date = null,
  photo_url = null,
  phone = null,
  emirates_id = null,
  passport_number = null,
  nationality = null,
}) {
  const result = await query(
    `INSERT INTO employees (
       employee_code, full_name, department, is_active,
       joining_date, photo_url, phone, emirates_id, passport_number, nationality
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${EMPLOYEE_ROW}`,
    [
      employee_code,
      full_name,
      department,
      is_active,
      joining_date,
      photo_url,
      phone,
      emirates_id,
      passport_number,
      nationality,
    ]
  )
  return result.rows[0]
}

async function update(
  id,
  {
    employee_code,
    full_name,
    department,
    is_active,
    joining_date,
    photo_url,
    phone,
    emirates_id,
    passport_number,
    nationality,
  }
) {
  const result = await query(
    `UPDATE employees
     SET employee_code = COALESCE($2, employee_code),
         full_name = COALESCE($3, full_name),
         department = COALESCE($4, department),
         is_active = COALESCE($5, is_active),
         joining_date = $6,
         photo_url = $7,
         phone = $8,
         emirates_id = $9,
         passport_number = $10,
         nationality = $11
     WHERE id = $1
     RETURNING ${EMPLOYEE_ROW}`,
    [
      id,
      employee_code,
      full_name,
      department,
      is_active,
      joining_date,
      photo_url,
      phone,
      emirates_id,
      passport_number,
      nationality,
    ]
  )
  return result.rows[0] || null
}

async function remove(id) {
  const result = await query('DELETE FROM employees WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

module.exports = {
  findAll,
  findById,
  findByEmployeeCode,
  create,
  update,
  remove,
}

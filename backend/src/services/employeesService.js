const { query } = require('../db')

async function findAll() {
  const result = await query(
    'SELECT id, employee_code, full_name, department, is_active, created_at FROM employees ORDER BY id'
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    'SELECT id, employee_code, full_name, department, is_active, created_at FROM employees WHERE id = $1',
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

async function create({ employee_code, full_name, department, is_active = true }) {
  const result = await query(
    `INSERT INTO employees (employee_code, full_name, department, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, employee_code, full_name, department, is_active, created_at`,
    [employee_code, full_name, department, is_active]
  )
  return result.rows[0]
}

async function update(id, { employee_code, full_name, department, is_active }) {
  const result = await query(
    `UPDATE employees
     SET employee_code = COALESCE($2, employee_code),
         full_name = COALESCE($3, full_name),
         department = COALESCE($4, department),
         is_active = COALESCE($5, is_active)
     WHERE id = $1
     RETURNING id, employee_code, full_name, department, is_active, created_at`,
    [id, employee_code, full_name, department, is_active]
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

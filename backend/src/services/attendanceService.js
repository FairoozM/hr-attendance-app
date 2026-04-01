const { query } = require('../db')

/**
 * Get all attendance records for a given month and year.
 * @param {number} month - 1-12
 * @param {number} year - e.g. 2026
 */
async function findByMonthYear(month, year) {
  const result = await query(
    `SELECT id, employee_id, attendance_date, status, created_at
     FROM attendance
     WHERE EXTRACT(MONTH FROM attendance_date) = $1
       AND EXTRACT(YEAR FROM attendance_date) = $2
     ORDER BY attendance_date, employee_id`,
    [month, year]
  )
  return result.rows
}

/**
 * Insert or update a single attendance record.
 * Unique on (employee_id, attendance_date).
 */
async function upsert(employee_id, attendance_date, status) {
  const result = await query(
    `INSERT INTO attendance (employee_id, attendance_date, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status
     RETURNING id, employee_id, attendance_date, status, created_at`,
    [employee_id, attendance_date, status]
  )
  return result.rows[0]
}

async function remove(employee_id, attendance_date) {
  const result = await query(
    'DELETE FROM attendance WHERE employee_id = $1 AND attendance_date = $2 RETURNING id',
    [employee_id, attendance_date]
  )
  return result.rowCount > 0
}

module.exports = { findByMonthYear, upsert, remove }

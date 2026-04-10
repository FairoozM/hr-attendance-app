const { query } = require('../db')

/**
 * Get all attendance records for a given month and year.
 * @param {number} month - 1-12
 * @param {number} year - e.g. 2026
 */
async function findByMonthYear(month, year) {
  const result = await query(
    `SELECT id, employee_id, attendance_date, status, sick_leave_document_url, created_at
     FROM attendance
     WHERE EXTRACT(MONTH FROM attendance_date) = $1
       AND EXTRACT(YEAR FROM attendance_date) = $2
     ORDER BY attendance_date, employee_id`,
    [month, year]
  )
  return result.rows
}

/**
 * Get attendance records for a given month/year filtered to a specific department.
 */
async function findByMonthYearDepartment(month, year, department) {
  const result = await query(
    `SELECT a.id, a.employee_id, a.attendance_date, a.status,
            a.sick_leave_document_url, a.created_at
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE EXTRACT(MONTH FROM a.attendance_date) = $1
       AND EXTRACT(YEAR FROM a.attendance_date) = $2
       AND e.department = $3
     ORDER BY a.attendance_date, a.employee_id`,
    [month, year, department]
  )
  return result.rows
}

async function findOne(employee_id, attendance_date) {
  const result = await query(
    `SELECT id, employee_id, attendance_date, status, sick_leave_document_url, created_at
     FROM attendance WHERE employee_id = $1 AND attendance_date = $2::date`,
    [employee_id, attendance_date]
  )
  return result.rows[0] || null
}

/**
 * Insert or update a single attendance record.
 * Unique on (employee_id, attendance_date).
 * Clears sick_leave_document_url when status is not SL.
 */
async function upsert(employee_id, attendance_date, status) {
  const result = await query(
    `INSERT INTO attendance (employee_id, attendance_date, status, sick_leave_document_url)
     VALUES ($1, $2::date, $3, NULL)
     ON CONFLICT (employee_id, attendance_date)
     DO UPDATE SET
       status = EXCLUDED.status,
       sick_leave_document_url = CASE
         WHEN EXCLUDED.status = 'SL' THEN attendance.sick_leave_document_url
         ELSE NULL
       END,
       annual_leave_id = CASE
         WHEN EXCLUDED.status = 'AL' THEN attendance.annual_leave_id
         ELSE NULL
       END
     RETURNING id, employee_id, attendance_date, status, sick_leave_document_url, created_at`,
    [employee_id, attendance_date, status]
  )
  return result.rows[0]
}

async function setSickLeaveDocumentUrl(employee_id, attendance_date, url) {
  const result = await query(
    `UPDATE attendance
     SET sick_leave_document_url = $3
     WHERE employee_id = $1 AND attendance_date = $2::date AND status = 'SL'
     RETURNING id, employee_id, attendance_date, status, sick_leave_document_url, created_at`,
    [employee_id, attendance_date, url]
  )
  return result.rows[0] || null
}

async function clearSickLeaveDocumentUrl(employee_id, attendance_date) {
  const result = await query(
    `UPDATE attendance
     SET sick_leave_document_url = NULL
     WHERE employee_id = $1 AND attendance_date = $2::date AND status = 'SL'
     RETURNING sick_leave_document_url`,
    [employee_id, attendance_date]
  )
  return result.rows[0] || null
}

async function remove(employee_id, attendance_date) {
  const result = await query(
    'DELETE FROM attendance WHERE employee_id = $1 AND attendance_date = $2::date RETURNING id',
    [employee_id, attendance_date]
  )
  return result.rowCount > 0
}

module.exports = {
  findByMonthYear,
  findByMonthYearDepartment,
  findOne,
  upsert,
  setSickLeaveDocumentUrl,
  clearSickLeaveDocumentUrl,
  remove,
}

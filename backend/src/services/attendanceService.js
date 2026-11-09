const { query } = require('../db')

/**
 * `attendance_date` is returned as a plain `YYYY-MM-DD` string. node-pg would otherwise
 * build a Date at server-local midnight, which serializes to the previous UTC day when
 * the server runs east of UTC (e.g. Asia/Dubai) and shifts every record by one day.
 */
const RECORD_COLUMNS = `id, employee_id, to_char(attendance_date, 'YYYY-MM-DD') AS attendance_date, status,
  sick_leave_document_url, annual_leave_id, created_at`

const MONTH_RANGE = `attendance_date >= make_date($2, $1, 1)
  AND attendance_date < (make_date($2, $1, 1) + INTERVAL '1 month')`

/**
 * Get all attendance records for a given month and year.
 * @param {number} month - 1-12
 * @param {number} year - e.g. 2026
 */
async function findByMonthYear(month, year) {
  const result = await query(
    `SELECT ${RECORD_COLUMNS}
     FROM attendance
     WHERE ${MONTH_RANGE}
     ORDER BY attendance_date, employee_id`,
    [month, year]
  )
  return result.rows
}

/**
 * Get attendance records for a given month/year filtered to a specific list of employee IDs.
 */
async function findByMonthYearEmployeeIds(month, year, employeeIds) {
  if (!employeeIds || employeeIds.length === 0) return []
  const placeholders = employeeIds.map((_, i) => `$${i + 3}`).join(', ')
  const result = await query(
    `SELECT ${RECORD_COLUMNS}
     FROM attendance
     WHERE ${MONTH_RANGE}
       AND employee_id IN (${placeholders})
     ORDER BY attendance_date, employee_id`,
    [month, year, ...employeeIds]
  )
  return result.rows
}

async function findOne(employee_id, attendance_date) {
  const result = await query(
    `SELECT ${RECORD_COLUMNS}
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
     RETURNING ${RECORD_COLUMNS}`,
    [employee_id, attendance_date, status]
  )
  return result.rows[0]
}

async function setSickLeaveDocumentUrl(employee_id, attendance_date, url) {
  const result = await query(
    `UPDATE attendance
     SET sick_leave_document_url = $3
     WHERE employee_id = $1 AND attendance_date = $2::date AND status = 'SL'
     RETURNING ${RECORD_COLUMNS}`,
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
  findByMonthYearEmployeeIds,
  findOne,
  upsert,
  setSickLeaveDocumentUrl,
  clearSickLeaveDocumentUrl,
  remove,
}

const { query } = require('../db')

const STATUSES = ['Pending', 'Approved', 'Rejected']

function isValidStatus(s) {
  return STATUSES.includes(s)
}

function dateStr(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function eachDateInclusive(fromStr, toStr, fn) {
  const a = dateStr(fromStr)
  const b = dateStr(toStr)
  const start = new Date(`${a}T12:00:00.000Z`)
  const end = new Date(`${b}T12:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    fn(d.toISOString().slice(0, 10))
  }
}

/**
 * Remove attendance rows tied to this annual leave request.
 */
async function clearAttendanceForLeave(leaveId) {
  await query('DELETE FROM attendance WHERE annual_leave_id = $1', [leaveId])
}

/**
 * Mark each day in range as Annual Leave (AL), linked to annual_leave_id.
 */
async function applyApprovedAttendance(leaveId, employeeId, fromDate, toDate) {
  await clearAttendanceForLeave(leaveId)
  const inserts = []
  eachDateInclusive(fromDate, toDate, (dateStr) => {
    inserts.push(
      query(
        `INSERT INTO attendance (employee_id, attendance_date, status, sick_leave_document_url, annual_leave_id)
         VALUES ($1, $2::date, 'AL', NULL, $3)
         ON CONFLICT (employee_id, attendance_date)
         DO UPDATE SET
           status = 'AL',
           sick_leave_document_url = CASE
             WHEN attendance.status = 'SL' THEN attendance.sick_leave_document_url
             ELSE NULL
           END,
           annual_leave_id = EXCLUDED.annual_leave_id
         RETURNING id`,
        [employeeId, dateStr, leaveId]
      )
    )
  })
  await Promise.all(inserts)
}

async function syncAttendanceForRow(row) {
  if (!row) return
  if (row.status === 'Approved') {
    await applyApprovedAttendance(
      row.id,
      row.employee_id,
      dateStr(row.from_date),
      dateStr(row.to_date)
    )
  } else {
    await clearAttendanceForLeave(row.id)
  }
}

async function listWithEmployees() {
  const result = await query(
    `SELECT
       al.id,
       al.employee_id,
       al.from_date,
       al.to_date,
       al.reason,
       al.status,
       al.created_at,
       al.updated_at,
       e.employee_code,
       e.full_name,
       e.department
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     ORDER BY al.created_at DESC`
  )
  return result.rows
}

async function listWithEmployeesForEmployee(employeeId) {
  const result = await query(
    `SELECT
       al.id,
       al.employee_id,
       al.from_date,
       al.to_date,
       al.reason,
       al.status,
       al.created_at,
       al.updated_at,
       e.employee_code,
       e.full_name,
       e.department
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     WHERE al.employee_id = $1
     ORDER BY al.created_at DESC`,
    [employeeId]
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT id, employee_id, from_date, to_date, reason, status, created_at, updated_at
     FROM annual_leave WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function findByIdWithEmployee(id) {
  const result = await query(
    `SELECT
       al.id,
       al.employee_id,
       al.from_date,
       al.to_date,
       al.reason,
       al.status,
       al.created_at,
       al.updated_at,
       e.employee_code,
       e.full_name,
       e.department
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     WHERE al.id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function create({ employee_id, from_date, to_date, reason, status }) {
  const result = await query(
    `INSERT INTO annual_leave (employee_id, from_date, to_date, reason, status, updated_at)
     VALUES ($1, $2::date, $3::date, $4, $5, NOW())
     RETURNING id, employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [employee_id, from_date, to_date, reason ?? null, status]
  )
  const row = result.rows[0]
  await syncAttendanceForRow(row)
  return row
}

async function update(id, { employee_id, from_date, to_date, reason, status }) {
  const existing = await findById(id)
  if (!existing) return null
  const result = await query(
    `UPDATE annual_leave SET
       employee_id = $2,
       from_date = $3::date,
       to_date = $4::date,
       reason = $5,
       status = $6,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [id, employee_id, from_date, to_date, reason, status]
  )
  const row = result.rows[0]
  if (row) await syncAttendanceForRow(row)
  return row
}

async function remove(id) {
  await clearAttendanceForLeave(id)
  const result = await query('DELETE FROM annual_leave WHERE id = $1 RETURNING id', [id])
  return result.rowCount > 0
}

module.exports = {
  STATUSES,
  isValidStatus,
  listWithEmployees,
  listWithEmployeesForEmployee,
  findById,
  findByIdWithEmployee,
  create,
  update,
  remove,
  syncAttendanceForRow,
}

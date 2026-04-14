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
  const end   = new Date(`${b}T12:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    fn(d.toISOString().slice(0, 10))
  }
}

async function clearAttendanceForLeave(leaveId) {
  await query('DELETE FROM attendance WHERE annual_leave_id = $1', [leaveId])
}

async function applyApprovedAttendance(leaveId, employeeId, fromDate, toDate) {
  await clearAttendanceForLeave(leaveId)
  const inserts = []
  eachDateInclusive(fromDate, toDate, (ds) => {
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
        [employeeId, ds, leaveId]
      )
    )
  })
  await Promise.all(inserts)
}

async function syncAttendanceForRow(row) {
  if (!row) return
  if (row.status === 'Approved') {
    await applyApprovedAttendance(
      row.id, row.employee_id,
      dateStr(row.from_date), dateStr(row.to_date)
    )
  } else {
    await clearAttendanceForLeave(row.id)
  }
}

// ── SQL fragment that computes effective_status and other derived fields ──
const RICH_SELECT = `
  al.id,
  al.employee_id,
  al.alternate_employee_id,
  al.from_date,
  al.to_date,
  al.reason,
  al.status,
  al.actual_return_date,
  al.return_confirmed_by,
  al.return_confirmed_at,
  al.admin_remarks,
  al.grace_period_days,
  al.created_at,
  al.updated_at,
  al.leave_request_pdf_key,
  al.leave_request_pdf_generated_at,
  e.employee_code,
  e.full_name,
  e.department,
  e.photo_url,
  e.designation,
  alt_leave.full_name AS alternate_employee_full_name,
  (al.to_date + INTERVAL '1 day')::date                                AS expected_return_date,
  (al.to_date::date - al.from_date::date + 1)                         AS leave_days,
  CASE
    WHEN al.actual_return_date IS NOT NULL                             THEN 'Completed'
    WHEN al.status IN ('Rejected','Pending')                          THEN al.status
    WHEN al.status = 'Approved' THEN
      CASE
        WHEN CURRENT_DATE < al.from_date                              THEN 'Approved'
        WHEN CURRENT_DATE BETWEEN al.from_date AND al.to_date         THEN 'Ongoing'
        WHEN EXISTS (
          SELECT 1 FROM attendance att
          WHERE att.employee_id = al.employee_id
            AND att.attendance_date > al.to_date
            AND att.status IN ('P','H','WFH')
            AND att.annual_leave_id IS NULL
        )                                                             THEN 'ReturnPending'
        WHEN CURRENT_DATE > al.to_date + al.grace_period_days        THEN 'Overstayed'
        ELSE                                                               'ReturnPending'
      END
    ELSE al.status
  END AS effective_status,
  GREATEST(0,
    CASE
      WHEN al.actual_return_date IS NOT NULL
        THEN (al.actual_return_date::date - (al.to_date + INTERVAL '1 day')::date)::int
      WHEN CURRENT_DATE > al.to_date
        THEN (CURRENT_DATE - (al.to_date + INTERVAL '1 day')::date)::int
      ELSE 0
    END
  ) AS overstay_days,
  (
    SELECT MAX(att.attendance_date)
    FROM attendance att
    WHERE att.employee_id = al.employee_id
      AND att.attendance_date > al.to_date
      AND att.status IN ('P','H','WFH')
      AND att.annual_leave_id IS NULL
  ) AS detected_return_date
`

async function listWithEmployees() {
  const result = await query(
    `SELECT ${RICH_SELECT}
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     LEFT JOIN employees alt_leave ON alt_leave.id = al.alternate_employee_id
     ORDER BY al.from_date DESC, al.created_at DESC`
  )
  return result.rows
}

async function listWithEmployeesForEmployee(employeeId) {
  const result = await query(
    `SELECT ${RICH_SELECT}
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     LEFT JOIN employees alt_leave ON alt_leave.id = al.alternate_employee_id
     WHERE al.employee_id = $1
     ORDER BY al.from_date DESC, al.created_at DESC`,
    [employeeId]
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT id, employee_id, alternate_employee_id, from_date, to_date, reason, status,
            actual_return_date, return_confirmed_by, return_confirmed_at,
            admin_remarks, grace_period_days, created_at, updated_at
     FROM annual_leave WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function findByIdWithEmployee(id) {
  const result = await query(
    `SELECT ${RICH_SELECT}
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     LEFT JOIN employees alt_leave ON alt_leave.id = al.alternate_employee_id
     WHERE al.id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function updateLeaveRequestPdf(id, { pdfKey, generatedAt }) {
  const result = await query(
    `UPDATE annual_leave
     SET leave_request_pdf_key = $2,
         leave_request_pdf_generated_at = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id, pdfKey || null, generatedAt || null]
  )
  return result.rows[0] || null
}

async function create({ employee_id, alternate_employee_id, from_date, to_date, reason, status }) {
  const result = await query(
    `INSERT INTO annual_leave (employee_id, alternate_employee_id, from_date, to_date, reason, status, updated_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, NOW())
     RETURNING id, employee_id, alternate_employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [employee_id, alternate_employee_id ?? null, from_date, to_date, reason ?? null, status]
  )
  const row = result.rows[0]
  await syncAttendanceForRow(row)
  return row
}

async function update(id, { employee_id, alternate_employee_id, from_date, to_date, reason, status }) {
  const existing = await findById(id)
  if (!existing) return null
  const result = await query(
    `UPDATE annual_leave SET
       employee_id = $2,
       alternate_employee_id = $3,
       from_date   = $4::date,
       to_date     = $5::date,
       reason      = $6,
       status      = $7,
       updated_at  = NOW()
     WHERE id = $1
     RETURNING id, employee_id, alternate_employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [id, employee_id, alternate_employee_id ?? null, from_date, to_date, reason, status]
  )
  const row = result.rows[0]
  if (row) await syncAttendanceForRow(row)
  return row
}

// ── Confirm employee return ──
async function confirmReturn(id, { actual_return_date, admin_remarks, confirmed_by }) {
  const result = await query(
    `UPDATE annual_leave SET
       actual_return_date    = $2::date,
       return_confirmed_by   = $3,
       return_confirmed_at   = NOW(),
       admin_remarks         = COALESCE($4, admin_remarks),
       updated_at            = NOW()
     WHERE id = $1
     RETURNING id`,
    [id, actual_return_date, confirmed_by || null, admin_remarks || null]
  )
  return result.rows[0] || null
}

// ── Extend leave end date ──
async function extendLeave(id, { new_to_date, admin_remarks, confirmed_by }) {
  const existing = await findById(id)
  if (!existing) return null
  const result = await query(
    `UPDATE annual_leave SET
       to_date      = $2::date,
       admin_remarks = COALESCE($3, admin_remarks),
       updated_at   = NOW()
     WHERE id = $1
     RETURNING id, employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [id, new_to_date, admin_remarks || null]
  )
  const row = result.rows[0]
  if (row) await syncAttendanceForRow({ ...existing, to_date: new_to_date, status: existing.status })
  return row
}

// ── Update remarks only ──
async function updateRemarks(id, { admin_remarks }) {
  const result = await query(
    `UPDATE annual_leave SET admin_remarks = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id, admin_remarks || null]
  )
  return result.rows[0] || null
}

// ── Dashboard stats ──
async function getDashboardStats() {
  const result = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'Pending')                                           AS pending,
      COUNT(*) FILTER (WHERE status = 'Approved' AND CURRENT_DATE < from_date)             AS upcoming,
      COUNT(*) FILTER (
        WHERE status = 'Approved'
          AND CURRENT_DATE BETWEEN from_date AND to_date
      )                                                                                    AS ongoing,
      COUNT(*) FILTER (
        WHERE status = 'Approved'
          AND CURRENT_DATE > to_date
          AND actual_return_date IS NULL
          AND EXISTS (
            SELECT 1 FROM attendance att
            WHERE att.employee_id = annual_leave.employee_id
              AND att.attendance_date > annual_leave.to_date
              AND att.status IN ('P','H','WFH')
              AND att.annual_leave_id IS NULL
          )
      )                                                                                    AS return_pending_detected,
      COUNT(*) FILTER (
        WHERE status = 'Approved'
          AND CURRENT_DATE > to_date
          AND actual_return_date IS NULL
      )                                                                                    AS return_pending_total,
      COUNT(*) FILTER (
        WHERE status = 'Approved'
          AND CURRENT_DATE > to_date + grace_period_days
          AND actual_return_date IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM attendance att
            WHERE att.employee_id = annual_leave.employee_id
              AND att.attendance_date > annual_leave.to_date
              AND att.status IN ('P','H','WFH')
              AND att.annual_leave_id IS NULL
          )
      )                                                                                    AS overstayed,
      COUNT(*) FILTER (
        WHERE actual_return_date IS NOT NULL
          AND date_trunc('month', actual_return_date) = date_trunc('month', CURRENT_DATE)
      )                                                                                    AS completed_this_month,
      COUNT(*) FILTER (
        WHERE status = 'Approved'
          AND (to_date + INTERVAL '1 day')::date = CURRENT_DATE
          AND actual_return_date IS NULL
      )                                                                                    AS returning_today
    FROM annual_leave
  `)
  return result.rows[0]
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
  updateLeaveRequestPdf,
  create,
  update,
  confirmReturn,
  extendLeave,
  updateRemarks,
  getDashboardStats,
  remove,
  syncAttendanceForRow,
}

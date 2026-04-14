const { query } = require('../db')
const annualLeaveSalaryService = require('./annualLeaveSalaryService')

const STATUSES = ['Pending', 'Approved', 'Rejected']

/** Workflow after leave is approved (does not replace leave status). */
const SHOP_VISIT_STATUSES = [
  'PendingSubmission',
  'Submitted',
  'Confirmed',
  'MoneyCalculated',
  'Completed',
  'Cancelled',
]

function isValidStatus(s) {
  return STATUSES.includes(s)
}

function isValidShopVisitStatus(s) {
  return SHOP_VISIT_STATUSES.includes(s)
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
  al.shop_visit_status,
  al.shop_visit_date,
  al.shop_visit_time,
  al.shop_visit_note,
  al.shop_visit_submitted_at,
  al.shop_visit_confirmed_by,
  al.shop_visit_confirmed_at,
  al.shop_visit_admin_note,
  al.calculated_leave_amount,
  al.calculator_snapshot,
  e.employee_code,
  e.full_name,
  e.department,
  e.photo_url,
  e.photo_doc_key,
  e.signature_doc_key,
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
            admin_remarks, grace_period_days, created_at, updated_at,
            shop_visit_status, shop_visit_date, shop_visit_time, shop_visit_note,
            shop_visit_submitted_at, shop_visit_confirmed_by, shop_visit_confirmed_at,
            shop_visit_admin_note, calculated_leave_amount, calculator_snapshot
     FROM annual_leave WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function hasPendingRequestForEmployee(employeeId, excludeLeaveId = null) {
  const sql =
    excludeLeaveId == null
      ? `SELECT id FROM annual_leave
         WHERE employee_id = $1 AND status = 'Pending'
         LIMIT 1`
      : `SELECT id FROM annual_leave
         WHERE employee_id = $1 AND status = 'Pending' AND id != $2
         LIMIT 1`
  const params = excludeLeaveId == null ? [employeeId] : [employeeId, excludeLeaveId]
  const result = await query(sql, params)
  return Boolean(result.rows[0])
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

async function syncShopVisitColumnsAfterLeaveStatusChange(id, leaveStatus) {
  if (leaveStatus === 'Approved') {
    await query(
      `UPDATE annual_leave SET
         shop_visit_status = CASE
           WHEN shop_visit_status IN ('Completed', 'Cancelled') THEN shop_visit_status
           WHEN shop_visit_status IS NULL OR TRIM(COALESCE(shop_visit_status, '')) = '' THEN 'PendingSubmission'
           ELSE shop_visit_status
         END,
         updated_at = NOW()
       WHERE id = $1`,
      [id]
    )
  } else if (leaveStatus === 'Rejected') {
    await query(
      `UPDATE annual_leave SET
         shop_visit_status = 'Cancelled',
         updated_at = NOW()
       WHERE id = $1`,
      [id]
    )
  } else if (leaveStatus === 'Pending') {
    await query(
      `UPDATE annual_leave SET
         shop_visit_status = NULL,
         shop_visit_date = NULL,
         shop_visit_time = NULL,
         shop_visit_note = NULL,
         shop_visit_submitted_at = NULL,
         shop_visit_confirmed_by = NULL,
         shop_visit_confirmed_at = NULL,
         shop_visit_admin_note = NULL,
         calculated_leave_amount = NULL,
         calculator_snapshot = NULL,
         updated_at = NOW()
       WHERE id = $1`,
      [id]
    )
  }
}

async function create({ employee_id, alternate_employee_id, from_date, to_date, reason, status }) {
  const shopInit = status === 'Approved' ? 'PendingSubmission' : null
  const result = await query(
    `INSERT INTO annual_leave (
       employee_id, alternate_employee_id, from_date, to_date, reason, status,
       shop_visit_status, updated_at
     )
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, NOW())
     RETURNING id, employee_id, alternate_employee_id, from_date, to_date, reason, status, created_at, updated_at`,
    [employee_id, alternate_employee_id ?? null, from_date, to_date, reason ?? null, status, shopInit]
  )
  const row = result.rows[0]
  await syncAttendanceForRow(row)
  await syncShopVisitColumnsAfterLeaveStatusChange(row.id, status)
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
  if (row) await syncShopVisitColumnsAfterLeaveStatusChange(id, status)
  return row
}

// ── Main shop visit (after leave approved) ──

async function submitShopVisit(id, employeeId, { shop_visit_date, shop_visit_time, shop_visit_note }) {
  const existing = await findById(id)
  if (!existing) return { error: 'not_found' }
  if (parseInt(existing.employee_id, 10) !== parseInt(employeeId, 10)) return { error: 'forbidden' }
  if (existing.status !== 'Approved') return { error: 'leave_not_approved' }
  const sv = existing.shop_visit_status
  if (sv === 'Completed' || sv === 'Cancelled') return { error: 'invalid_shop_state' }
  if (sv && !['PendingSubmission', 'Submitted'].includes(sv)) return { error: 'invalid_shop_state' }

  await query(
    `UPDATE annual_leave SET
       shop_visit_date = $2::date,
       shop_visit_time = $3,
       shop_visit_note = $4,
       shop_visit_status = 'Submitted',
       shop_visit_submitted_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [id, shop_visit_date, shop_visit_time || null, shop_visit_note || null]
  )
  return { ok: true }
}

async function confirmShopVisit(id, adminUserId, { shop_visit_admin_note } = {}) {
  const existing = await findById(id)
  if (!existing) return { error: 'not_found' }
  if (existing.status !== 'Approved') return { error: 'leave_not_approved' }
  if (existing.shop_visit_status !== 'Submitted') return { error: 'must_be_submitted' }
  if (!existing.shop_visit_date) return { error: 'missing_visit_date' }

  await query(
    `UPDATE annual_leave SET
       shop_visit_status = 'Confirmed',
       shop_visit_confirmed_by = $2::integer,
       shop_visit_confirmed_at = NOW(),
       shop_visit_admin_note = COALESCE($3, shop_visit_admin_note),
       updated_at = NOW()
     WHERE id = $1`,
    [id, parseInt(adminUserId, 10) || null, shop_visit_admin_note != null ? String(shop_visit_admin_note).trim() || null : null]
  )

  const applied = await applyLatestCalculatorSnapshot(id)
  return { ok: true, calculatorApplied: applied }
}

async function rescheduleShopVisit(id, adminUserId, { shop_visit_date, shop_visit_time, shop_visit_admin_note }) {
  const existing = await findById(id)
  if (!existing) return { error: 'not_found' }
  if (existing.status !== 'Approved') return { error: 'leave_not_approved' }
  if (!['Submitted', 'Confirmed', 'MoneyCalculated'].includes(existing.shop_visit_status || '')) {
    return { error: 'invalid_shop_state' }
  }

  await query(
    `UPDATE annual_leave SET
       shop_visit_date = $2::date,
       shop_visit_time = $3,
       shop_visit_admin_note = COALESCE($4, shop_visit_admin_note),
       shop_visit_status = CASE
         WHEN shop_visit_status = 'MoneyCalculated' THEN 'Confirmed'
         ELSE shop_visit_status
       END,
       calculated_leave_amount = CASE
         WHEN shop_visit_status = 'MoneyCalculated' THEN NULL
         ELSE calculated_leave_amount
       END,
       calculator_snapshot = CASE
         WHEN shop_visit_status = 'MoneyCalculated' THEN NULL
         ELSE calculator_snapshot
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      shop_visit_date,
      shop_visit_time || null,
      shop_visit_admin_note != null ? String(shop_visit_admin_note).trim() || null : null,
    ]
  )

  const rowAfter = await findById(id)
  if (rowAfter.shop_visit_status === 'Confirmed') {
    await applyLatestCalculatorSnapshot(id)
  }
  return { ok: true }
}

async function updateShopVisitAdminNote(id, { shop_visit_admin_note }) {
  const existing = await findById(id)
  if (!existing) return { error: 'not_found' }
  await query(
    `UPDATE annual_leave SET shop_visit_admin_note = $2, updated_at = NOW() WHERE id = $1`,
    [id, shop_visit_admin_note != null ? String(shop_visit_admin_note).trim() || null : null]
  )
  return { ok: true }
}

async function applyLatestCalculatorSnapshot(leaveId) {
  const leave = await findById(leaveId)
  if (!leave || leave.status !== 'Approved') return false
  const empId = parseInt(leave.employee_id, 10)
  const latest = await annualLeaveSalaryService.findLatestByEmployeeId(empId)
  if (!latest) return false

  const snapshot = {
    annual_leave_salary_id: latest.id,
    calculation_date: latest.calculation_date,
    grand_total: latest.grand_total,
    leave_salary_amount: latest.leave_salary_amount,
    monthly_salary: latest.monthly_salary,
    leave_days_to_pay: latest.leave_days_to_pay,
  }

  await query(
    `UPDATE annual_leave SET
       calculated_leave_amount = $2,
       calculator_snapshot = $3::jsonb,
       shop_visit_status = 'MoneyCalculated',
       updated_at = NOW()
     WHERE id = $1`,
    [leaveId, latest.grand_total, JSON.stringify(snapshot)]
  )
  return true
}

async function completeShopVisit(id) {
  const existing = await findById(id)
  if (!existing) return { error: 'not_found' }
  if (existing.status !== 'Approved') return { error: 'leave_not_approved' }
  if (!['MoneyCalculated', 'Confirmed'].includes(existing.shop_visit_status || '')) {
    return { error: 'invalid_shop_state' }
  }
  await query(
    `UPDATE annual_leave SET shop_visit_status = 'Completed', updated_at = NOW() WHERE id = $1`,
    [id]
  )
  return { ok: true }
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
  SHOP_VISIT_STATUSES,
  isValidStatus,
  isValidShopVisitStatus,
  listWithEmployees,
  listWithEmployeesForEmployee,
  findById,
  hasPendingRequestForEmployee,
  findByIdWithEmployee,
  updateLeaveRequestPdf,
  create,
  update,
  submitShopVisit,
  confirmShopVisit,
  rescheduleShopVisit,
  updateShopVisitAdminNote,
  applyLatestCalculatorSnapshot,
  completeShopVisit,
  confirmReturn,
  extendLeave,
  updateRemarks,
  getDashboardStats,
  remove,
  syncAttendanceForRow,
}

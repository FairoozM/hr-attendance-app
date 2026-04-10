const attendanceService = require('../services/attendanceService')
const assignmentService = require('../services/attendanceAssignmentService')
const s3Service = require('../services/s3Service')

/**
 * Determine which employee IDs this user may access for attendance.
 * - Admin: returns null  → full access (no filter)
 * - Non-admin with attendance permission: returns array of assigned employee IDs
 *   (empty array = no employees assigned yet → sees nothing)
 */
async function getAttendanceScope(user) {
  if (!user || user.role === 'admin') return null
  // Non-admins must have at least view or manage permission to get here
  const ids = await assignmentService.getAssignedEmployeeIds(parseInt(user.userId, 10))
  return ids // may be empty
}

/**
 * Check whether a specific employee ID is within the user's allowed scope.
 * Returns true if allowed, false if blocked.
 */
async function isInScope(employeeId, user) {
  if (!user || user.role === 'admin') return true
  const ids = await assignmentService.getAssignedEmployeeIds(parseInt(user.userId, 10))
  return ids.includes(employeeId)
}

function keyFromDocumentUrl(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const fakeBase = 'https://local.invalid'
    const parsed = new URL(url, fakeBase)
    if (!parsed.pathname.endsWith('/api/attendance/sick-leave-file')) return null
    const key = parsed.searchParams.get('key')
    if (!key) return null
    return decodeURIComponent(key)
  } catch (_) {
    return null
  }
}

/**
 * GET /api/attendance/managed-employees
 * Returns the list of employees this user is allowed to see in the attendance grid.
 * - Admin / warehouse: all active employees
 * - Employee with attendance permission: only assigned employees
 */
async function listManagedEmployees(req, res) {
  try {
    const { query } = require('../db')
    const COLS = `id, employee_code, full_name, department, is_active, joining_date,
      photo_url, phone, designation, employment_status, weekly_off_day, duty_location,
      include_in_attendance, nationality, emirates_id, passport_number`

    if (!req.user || req.user.role === 'admin' || req.user.role === 'warehouse') {
      const result = await query(
        `SELECT ${COLS} FROM employees WHERE is_active = true ORDER BY full_name`
      )
      return res.json(result.rows)
    }

    // Non-admin: return only assigned employees
    const ids = await assignmentService.getAssignedEmployeeIds(parseInt(req.user.userId, 10))
    if (ids.length === 0) return res.json([])

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    const result = await query(
      `SELECT ${COLS} FROM employees
       WHERE id IN (${placeholders}) AND is_active = true
       ORDER BY full_name`,
      ids
    )
    return res.json(result.rows)
  } catch (err) {
    console.error('listManagedEmployees error:', err)
    return res.status(500).json({ error: 'Failed to fetch managed employees' })
  }
}

/**
 * GET /api/attendance?month=3&year=2026
 */
async function list(req, res) {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    if (Number.isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid month (1-12) is required' })
    }
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Valid year is required' })
    }

    const scope = await getAttendanceScope(req.user)

    let records
    if (scope === null) {
      // Admin — full access
      records = await attendanceService.findByMonthYear(month, year)
    } else if (scope.length === 0) {
      // Non-admin with no assignments — return empty
      records = []
    } else {
      // Non-admin with specific assignments
      records = await attendanceService.findByMonthYearEmployeeIds(month, year, scope)
    }

    res.json(records)
  } catch (err) {
    console.error('Attendance list error:', err)
    res.status(500).json({ error: 'Failed to fetch attendance' })
  }
}

/**
 * PUT /api/attendance
 * Body: { employee_id, attendance_date, status }
 */
async function upsert(req, res) {
  try {
    const employeeId = parseInt(req.body.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required and must be a number' })
    }
    const rawDate = req.body.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const date = new Date(attendanceDate)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: 'attendance_date must be a valid date (e.g. YYYY-MM-DD)' })
    }
    const status = req.body.status != null ? String(req.body.status).trim() : ''
    if (!status) {
      return res.status(400).json({ error: 'status is required' })
    }
    if (!(await isInScope(employeeId, req.user))) {
      return res.status(403).json({ error: 'Access denied: this employee is not in your assigned list' })
    }
    const record = await attendanceService.upsert(employeeId, attendanceDate, status)
    res.json(record)
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Employee not found' })
    }
    console.error('Attendance upsert error:', err)
    res.status(500).json({ error: 'Failed to save attendance' })
  }
}

/**
 * DELETE /api/attendance
 * Query: employee_id, attendance_date — removes row so UI can return to default / auto WH.
 */
async function remove(req, res) {
  try {
    const employeeId = parseInt(req.query.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required and must be a number' })
    }
    const rawDate = req.query.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const date = new Date(attendanceDate)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: 'attendance_date must be a valid date (e.g. YYYY-MM-DD)' })
    }
    if (!(await isInScope(employeeId, req.user))) {
      return res.status(403).json({ error: 'Access denied: this employee is not in your assigned list' })
    }
    const existing = await attendanceService.findOne(employeeId, attendanceDate)
    const existingKey = keyFromDocumentUrl(existing?.sick_leave_document_url)
    if (existingKey) {
      await s3Service.deleteObjectIfExists(existingKey).catch(() => {})
    }
    await attendanceService.remove(employeeId, attendanceDate)
    res.status(204).send()
  } catch (err) {
    console.error('Attendance delete error:', err)
    res.status(500).json({ error: 'Failed to delete attendance' })
  }
}

/**
 * POST /api/attendance/sick-leave-upload-url
 * body: { employee_id, attendance_date, file_name, file_type }
 */
async function getSickLeaveUploadUrl(req, res) {
  try {
    const employeeId = parseInt(req.body.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required' })
    }
    const rawDate = req.body.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const fileName = String(req.body.file_name || '').trim()
    const fileType = String(req.body.file_type || '').trim()
    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'file_name and file_type are required' })
    }
    const allowed =
      fileType === 'application/pdf' || fileType.startsWith('image/')
    if (!allowed) {
      return res.status(400).json({ error: 'Only PDF or image files are allowed' })
    }
    const row = await attendanceService.findOne(employeeId, attendanceDate)
    if (!row || row.status !== 'SL') {
      return res.status(400).json({
        error: 'Save Sick Leave (SL) for this day before uploading a medical record',
      })
    }
    const key = s3Service.createSickLeaveKey(employeeId, attendanceDate, fileName)
    const uploadUrl = await s3Service.getUploadUrl({ key, contentType: fileType })
    const viewUrl = `/api/attendance/sick-leave-file?key=${encodeURIComponent(key)}`
    res.json({ uploadUrl, key, viewUrl, contentType: fileType })
  } catch (err) {
    console.error('Sick leave upload-url error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to create upload URL' })
  }
}

/**
 * POST /api/attendance/sick-leave-document
 * body: { employee_id, attendance_date, key }
 */
async function uploadSickLeaveDocument(req, res) {
  try {
    const employeeId = parseInt(req.body.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required' })
    }
    const rawDate = req.body.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const key = String(req.body.key || '').trim()
    if (!key) {
      return res.status(400).json({ error: 'key is required' })
    }
    const row = await attendanceService.findOne(employeeId, attendanceDate)
    if (!row || row.status !== 'SL') {
      return res.status(400).json({
        error: 'Save Sick Leave (SL) for this day before uploading a medical record',
      })
    }
    const existingKey = keyFromDocumentUrl(row.sick_leave_document_url)
    if (existingKey && existingKey !== key) {
      await s3Service.deleteObjectIfExists(existingKey).catch(() => {})
    }
    const publicUrl = `/api/attendance/sick-leave-file?key=${encodeURIComponent(key)}`
    const updated = await attendanceService.setSickLeaveDocumentUrl(employeeId, attendanceDate, publicUrl)
    if (!updated) {
      return res.status(400).json({ error: 'Could not attach document' })
    }
    res.json(updated)
  } catch (err) {
    console.error('Sick leave attach error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to attach document' })
  }
}

/**
 * DELETE /api/attendance/sick-leave-document?employee_id=&attendance_date=
 */
async function deleteSickLeaveDocument(req, res) {
  try {
    const employeeId = parseInt(req.query.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required' })
    }
    const rawDate = req.query.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const row = await attendanceService.findOne(employeeId, attendanceDate)
    const key = keyFromDocumentUrl(row?.sick_leave_document_url)
    if (key) {
      await s3Service.deleteObjectIfExists(key).catch(() => {})
    }
    await attendanceService.clearSickLeaveDocumentUrl(employeeId, attendanceDate)
    res.status(204).send()
  } catch (err) {
    console.error('Sick leave document delete error:', err)
    res.status(500).json({ error: 'Failed to remove document' })
  }
}

/**
 * GET /api/attendance/sick-leave-file?key=...
 */
async function serveSickLeaveFile(req, res) {
  try {
    const key = String(req.query.key || '').trim()
    if (!key || !key.startsWith('sick-leave/')) {
      return res.status(400).json({ error: 'Valid key is required' })
    }
    const signedUrl = await s3Service.getDownloadUrl({ key })
    return res.redirect(302, signedUrl)
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to open file' })
  }
}

module.exports = {
  listManagedEmployees,
  list,
  upsert,
  remove,
  getSickLeaveUploadUrl,
  uploadSickLeaveDocument,
  deleteSickLeaveDocument,
  serveSickLeaveFile,
}

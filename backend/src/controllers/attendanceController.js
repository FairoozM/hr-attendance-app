const attendanceService = require('../services/attendanceService')

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
    const records = await attendanceService.findByMonthYear(month, year)
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

module.exports = { list, upsert }

const path = require('path')
const fs = require('fs').promises
const attendanceService = require('../services/attendanceService')
const { UPLOAD_ROOT } = require('../middleware/sickLeaveUpload')

function basenameFromDocumentUrl(url) {
  if (!url || typeof url !== 'string') return null
  const seg = url.split('/').filter(Boolean)
  const name = seg[seg.length - 1]
  if (!name || name.includes('..')) return null
  return path.basename(name)
}

async function deleteStoredSickLeaveFile(url) {
  const base = basenameFromDocumentUrl(url)
  if (!base) return
  const full = path.join(UPLOAD_ROOT, base)
  try {
    await fs.unlink(full)
  } catch (_) {}
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
    const existing = await attendanceService.findOne(employeeId, attendanceDate)
    if (existing?.sick_leave_document_url) {
      await deleteStoredSickLeaveFile(existing.sick_leave_document_url)
    }
    await attendanceService.remove(employeeId, attendanceDate)
    res.status(204).send()
  } catch (err) {
    console.error('Attendance delete error:', err)
    res.status(500).json({ error: 'Failed to delete attendance' })
  }
}

/**
 * POST /api/attendance/sick-leave-document
 * multipart: file, employee_id, attendance_date
 */
async function uploadSickLeaveDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required (PDF or image)' })
    }
    const employeeId = parseInt(req.body.employee_id, 10)
    if (Number.isNaN(employeeId)) {
      await fs.unlink(req.file.path).catch(() => {})
      return res.status(400).json({ error: 'employee_id is required' })
    }
    const rawDate = req.body.attendance_date
    if (rawDate == null || String(rawDate).trim() === '') {
      await fs.unlink(req.file.path).catch(() => {})
      return res.status(400).json({ error: 'attendance_date is required' })
    }
    const attendanceDate = String(rawDate).trim()
    const row = await attendanceService.findOne(employeeId, attendanceDate)
    if (!row || row.status !== 'SL') {
      await fs.unlink(req.file.path).catch(() => {})
      return res.status(400).json({
        error: 'Save Sick Leave (SL) for this day before uploading a medical record',
      })
    }
    if (row.sick_leave_document_url) {
      await deleteStoredSickLeaveFile(row.sick_leave_document_url)
    }
    const publicUrl = `/api/attendance/files/${req.file.filename}`
    const updated = await attendanceService.setSickLeaveDocumentUrl(
      employeeId,
      attendanceDate,
      publicUrl
    )
    if (!updated) {
      await fs.unlink(req.file.path).catch(() => {})
      return res.status(400).json({ error: 'Could not attach document' })
    }
    res.json(updated)
  } catch (err) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {})
    console.error('Sick leave upload error:', err)
    res.status(500).json({ error: 'Failed to upload document' })
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
    if (row?.sick_leave_document_url) {
      await deleteStoredSickLeaveFile(row.sick_leave_document_url)
    }
    await attendanceService.clearSickLeaveDocumentUrl(employeeId, attendanceDate)
    res.status(204).send()
  } catch (err) {
    console.error('Sick leave document delete error:', err)
    res.status(500).json({ error: 'Failed to remove document' })
  }
}

/**
 * GET /api/attendance/files/:filename
 */
function serveSickLeaveFile(req, res) {
  const name = path.basename(req.params.filename || '')
  if (!name || name !== req.params.filename) {
    return res.status(400).send('Bad request')
  }
  const full = path.join(UPLOAD_ROOT, name)
  if (!full.startsWith(UPLOAD_ROOT)) {
    return res.status(400).send('Bad request')
  }
  res.sendFile(full, (err) => {
    if (err) res.status(404).send('Not found')
  })
}

module.exports = {
  list,
  upsert,
  remove,
  uploadSickLeaveDocument,
  deleteSickLeaveDocument,
  serveSickLeaveFile,
}

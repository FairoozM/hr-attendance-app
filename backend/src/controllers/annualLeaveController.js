const employeesService = require('../services/employeesService')
const annualLeaveService = require('../services/annualLeaveService')
const leaveRequestDocumentService = require('../services/leaveRequestDocumentService')
const s3Service = require('../services/s3Service')

function parseDate(s) {
  if (s == null || String(s).trim() === '') return null
  if (s instanceof Date) return s.toISOString().slice(0, 10)
  const t = String(s).trim().slice(0, 10)
  const d = new Date(`${t}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return t
}

function validateRange(fromDate, toDate) {
  if (!fromDate || !toDate) return 'from_date and to_date are required'
  if (fromDate > toDate) return 'from_date must be on or before to_date'
  return null
}

function parseAlternateEmployeeId(v) {
  if (v == null || v === '') return null
  const n = parseInt(String(v), 10)
  if (Number.isNaN(n) || n < 1) return null
  return n
}

async function attachLeavePhotoUrl(row) {
  if (!row) return row
  if (row.photo_doc_key) {
    try {
      row.photo_url = await s3Service.getDownloadUrl({ key: row.photo_doc_key, expiresIn: 3600 })
    } catch {
      /* keep existing */
    }
  }
  return row
}

async function attachLeavePhotoUrls(rows) {
  return Promise.all((rows || []).map(attachLeavePhotoUrl))
}

async function list(req, res) {
  try {
    const rows =
      req.user.role === 'employee'
        ? await annualLeaveService.listWithEmployeesForEmployee(parseInt(req.user.employeeId, 10))
        : await annualLeaveService.listWithEmployees()
    res.json(await attachLeavePhotoUrls(rows))
  } catch (err) {
    console.error('Annual leave list error:', err.message || err)
    if (err.stack) console.error(err.stack)
    const payload = {
      error: 'Failed to fetch annual leave requests',
      hint:
        'Often caused by the database schema not matching this API version. Restart the backend once so startup migrations can run, then retry.',
    }
    if (process.env.API_ERROR_DETAIL === '1') {
      payload.detail = err.message || String(err)
    }
    res.status(500).json(payload)
  }
}

async function dashboard(req, res) {
  try {
    const stats = await annualLeaveService.getDashboardStats()
    res.json(stats)
  } catch (err) {
    console.error('Annual leave dashboard error:', err.message || err)
    if (err.stack) console.error(err.stack)
    const payload = {
      error: 'Failed to fetch dashboard stats',
      hint:
        'If this persists after an upgrade, restart the backend so database migrations can complete.',
    }
    if (process.env.API_ERROR_DETAIL === '1') payload.detail = err.message || String(err)
    res.status(500).json(payload)
  }
}

async function listAlternateOptions(req, res) {
  try {
    const rows = await employeesService.findAlternateCandidates(null)
    res.json(
      rows.map((r) => ({
        id: r.id,
        employee_code: r.employee_code,
        full_name: r.full_name,
        is_active: r.is_active,
      }))
    )
  } catch (err) {
    console.error('Annual leave alternate options error:', err)
    res.status(500).json({ error: 'Failed to fetch alternate employee options' })
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await annualLeaveService.findByIdWithEmployee(id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (req.user.role === 'employee') {
      if (parseInt(row.employee_id, 10) !== parseInt(req.user.employeeId, 10))
        return res.status(403).json({ error: 'Forbidden' })
    }
    res.json(await attachLeavePhotoUrl(row))
  } catch (err) {
    console.error('Annual leave get error:', err)
    res.status(500).json({ error: 'Failed to fetch annual leave' })
  }
}

async function create(req, res) {
  try {
    let employeeId = parseInt(req.body.employee_id, 10)
    if (req.user.role === 'employee') {
      const selfId = parseInt(req.user.employeeId, 10)
      if (Number.isNaN(employeeId) || employeeId !== selfId)
        return res.status(403).json({ error: 'Forbidden' })
    } else if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: 'employee_id is required' })
    }

    const fromDate = parseDate(req.body.from_date)
    const toDate   = parseDate(req.body.to_date)
    const rangeErr = validateRange(fromDate, toDate)
    if (rangeErr) return res.status(400).json({ error: rangeErr })

    const emp = await employeesService.findById(employeeId)
    if (!emp) return res.status(404).json({ error: 'Employee not found' })
    const alreadyPending = await annualLeaveService.hasPendingRequestForEmployee(employeeId)
    if (alreadyPending) {
      return res.status(409).json({
        error:
          'You already have a pending annual leave request. Please delete it before creating a new one.',
      })
    }
    const alternateEmployeeId = parseAlternateEmployeeId(req.body.alternate_employee_id)
    if (alternateEmployeeId == null) {
      return res.status(400).json({ error: 'alternate_employee_id is required' })
    }
    if (alternateEmployeeId === employeeId) {
      return res.status(400).json({ error: 'Employee and alternate employee cannot be the same' })
    }
    const alt = await employeesService.findById(alternateEmployeeId)
    if (!alt) return res.status(404).json({ error: 'Alternate employee not found' })

    let status = req.body.status != null ? String(req.body.status).trim() : 'Pending'
    if (req.user.role === 'employee' && status !== 'Pending')
      return res.status(403).json({ error: 'Forbidden' })
    if (!annualLeaveService.isValidStatus(status))
      return res.status(400).json({ error: 'Invalid status' })

    const reason = req.body.reason?.trim() || null
    const row = await annualLeaveService.create({
      employee_id: employeeId,
      alternate_employee_id: alternateEmployeeId,
      from_date: fromDate,
      to_date: toDate,
      reason,
      status,
    })
    let enriched = await annualLeaveService.findByIdWithEmployee(row.id)
    try {
      await leaveRequestDocumentService.generateAndStoreLeaveLetter(row.id)
      enriched = (await annualLeaveService.findByIdWithEmployee(row.id)) || enriched
    } catch (e) {
      console.error('[annual-leave] Leave request letter PDF:', e.message)
    }
    res.status(201).json(await attachLeavePhotoUrl(enriched || row))
  } catch (err) {
    console.error('Annual leave create error:', err)
    res.status(500).json({ error: 'Failed to create annual leave request' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    if (req.user.role === 'employee') {
      if (parseInt(existing.employee_id, 10) !== parseInt(req.user.employeeId, 10))
        return res.status(403).json({ error: 'Forbidden' })
      if (existing.status !== 'Pending')
        return res.status(403).json({ error: 'Forbidden' })
    }

    const employeeId = parseInt(req.body.employee_id ?? existing.employee_id, 10)
    if (Number.isNaN(employeeId)) return res.status(400).json({ error: 'employee_id is required' })
    if (req.user.role === 'employee' && employeeId !== parseInt(existing.employee_id, 10))
      return res.status(403).json({ error: 'Forbidden' })

    const fromDate = parseDate(req.body.from_date ?? existing.from_date)
    const toDate   = parseDate(req.body.to_date ?? existing.to_date)
    const rangeErr = validateRange(fromDate, toDate)
    if (rangeErr) return res.status(400).json({ error: rangeErr })

    const emp = await employeesService.findById(employeeId)
    if (!emp) return res.status(404).json({ error: 'Employee not found' })
    const alternateEmployeeId = parseAlternateEmployeeId(
      req.body.alternate_employee_id ?? existing.alternate_employee_id
    )
    if (alternateEmployeeId == null) {
      return res.status(400).json({ error: 'alternate_employee_id is required' })
    }
    if (alternateEmployeeId === employeeId) {
      return res.status(400).json({ error: 'Employee and alternate employee cannot be the same' })
    }
    const alt = await employeesService.findById(alternateEmployeeId)
    if (!alt) return res.status(404).json({ error: 'Alternate employee not found' })

    let status = req.body.status != null ? String(req.body.status).trim() : existing.status
    if (req.user.role === 'employee' && status !== 'Pending')
      return res.status(403).json({ error: 'Forbidden' })
    if (!annualLeaveService.isValidStatus(status))
      return res.status(400).json({ error: 'Invalid status' })

    const reason = req.body.reason !== undefined
      ? (req.body.reason?.trim() || null)
      : existing.reason

    const row = await annualLeaveService.update(id, {
      employee_id: employeeId,
      alternate_employee_id: alternateEmployeeId,
      from_date: fromDate,
      to_date: toDate,
      reason,
      status,
    })
    if (!row) return res.status(404).json({ error: 'Not found' })
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched || row))
  } catch (err) {
    console.error('Annual leave update error:', err)
    res.status(500).json({ error: 'Failed to update annual leave request' })
  }
}

async function confirmReturn(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.status !== 'Approved')
      return res.status(400).json({ error: 'Leave must be in Approved status to confirm return' })

    const actual_return_date = parseDate(req.body.actual_return_date)
    if (!actual_return_date)
      return res.status(400).json({ error: 'actual_return_date is required' })

    await annualLeaveService.confirmReturn(id, {
      actual_return_date,
      admin_remarks: req.body.admin_remarks || null,
      confirmed_by: req.user.userId,
    })
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('Confirm return error:', err)
    res.status(500).json({ error: 'Failed to confirm return' })
  }
}

async function extendLeave(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.status !== 'Approved')
      return res.status(400).json({ error: 'Leave must be in Approved status to extend' })

    const new_to_date = parseDate(req.body.new_to_date)
    if (!new_to_date) return res.status(400).json({ error: 'new_to_date is required' })
    const currentTo = String(existing.to_date).slice(0, 10)
    if (new_to_date <= currentTo)
      return res.status(400).json({ error: 'new_to_date must be after current end date' })

    await annualLeaveService.extendLeave(id, {
      new_to_date,
      admin_remarks: req.body.admin_remarks || null,
      confirmed_by: req.user.userId,
    })
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('Extend leave error:', err)
    res.status(500).json({ error: 'Failed to extend leave' })
  }
}

async function updateRemarks(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    await annualLeaveService.updateRemarks(id, { admin_remarks: req.body.admin_remarks || null })
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('Update remarks error:', err)
    res.status(500).json({ error: 'Failed to update remarks' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    if (req.user.role === 'employee') {
      if (parseInt(existing.employee_id, 10) !== parseInt(req.user.employeeId, 10))
        return res.status(403).json({ error: 'Forbidden' })
      if (existing.status !== 'Pending')
        return res.status(403).json({ error: 'Forbidden' })
    }

    const ok = await annualLeaveService.remove(id)
    if (!ok) return res.status(404).json({ error: 'Not found' })
    res.status(204).send()
  } catch (err) {
    console.error('Annual leave delete error:', err)
    res.status(500).json({ error: 'Failed to delete annual leave request' })
  }
}

async function getLeaveRequestLetter(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await annualLeaveService.findByIdWithEmployee(id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (req.user.role === 'employee') {
      if (parseInt(row.employee_id, 10) !== parseInt(req.user.employeeId, 10)) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline'
    const buf = await leaveRequestDocumentService.getPdfBufferForLeave(id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="leave-request-${id}.pdf"`
    )
    res.send(buf)
  } catch (err) {
    if (err.code === 'LETTER_VALIDATION') {
      return res.status(422).json({ error: err.message })
    }
    console.error('Leave request letter PDF error:', err)
    res.status(500).json({ error: 'Failed to generate leave request document' })
  }
}

async function regenerateLeaveRequestLetter(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    await leaveRequestDocumentService.generateAndStoreLeaveLetter(id)
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    if (err.code === 'LETTER_VALIDATION') {
      return res.status(422).json({ error: err.message })
    }
    console.error('Regenerate leave letter error:', err)
    res.status(500).json({ error: err.message || 'Failed to regenerate document' })
  }
}

function parseShopVisitTime(s) {
  if (s == null || String(s).trim() === '') return null
  const t = String(s).trim().slice(0, 32)
  return t
}

async function getShopVisit(req, res) {
  return getOne(req, res)
}

async function submitShopVisit(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Only employees can submit a shop visit request' })
    }
    if (parseInt(existing.employee_id, 10) !== parseInt(req.user.employeeId, 10)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const confirm = req.body.confirmation === true || req.body.confirmation === 'true'
    if (!confirm) return res.status(400).json({ error: 'confirmation is required' })

    const shop_visit_date = parseDate(req.body.shop_visit_date)
    const shop_visit_time = parseShopVisitTime(req.body.shop_visit_time)
    if (!shop_visit_date) return res.status(400).json({ error: 'shop_visit_date is required' })
    if (!shop_visit_time) return res.status(400).json({ error: 'shop_visit_time is required' })

    const note = req.body.shop_visit_note != null ? String(req.body.shop_visit_note).trim() || null : null

    const employeeIdForCheck = req.user.employeeId
    const result = await annualLeaveService.submitShopVisit(id, employeeIdForCheck, {
      shop_visit_date,
      shop_visit_time,
      shop_visit_note: note,
    })
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' })
    if (result.error === 'forbidden') return res.status(403).json({ error: 'Forbidden' })
    if (result.error === 'leave_not_approved') {
      return res.status(400).json({ error: 'Leave must be approved before submitting shop visit' })
    }
    if (result.error === 'invalid_shop_state') {
      return res.status(400).json({ error: 'Shop visit cannot be submitted in the current state' })
    }

    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('submitShopVisit error:', err)
    res.status(500).json({ error: 'Failed to submit shop visit' })
  }
}

async function confirmShopVisit(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const note =
      req.body.shop_visit_admin_note != null ? String(req.body.shop_visit_admin_note).trim() || null : null
    const result = await annualLeaveService.confirmShopVisit(id, req.user.userId, {
      shop_visit_admin_note: note,
    })
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' })
    if (result.error === 'leave_not_approved') {
      return res.status(400).json({ error: 'Leave must be approved' })
    }
    if (result.error === 'must_be_submitted') {
      return res.status(400).json({ error: 'Shop visit must be submitted before confirmation' })
    }
    if (result.error === 'missing_visit_date') {
      return res.status(400).json({ error: 'Missing shop visit date' })
    }

    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('confirmShopVisit error:', err)
    res.status(500).json({ error: 'Failed to confirm shop visit' })
  }
}

async function rescheduleShopVisit(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const shop_visit_date = parseDate(req.body.shop_visit_date)
    const shop_visit_time = parseShopVisitTime(req.body.shop_visit_time)
    if (!shop_visit_date) return res.status(400).json({ error: 'shop_visit_date is required' })
    if (!shop_visit_time) return res.status(400).json({ error: 'shop_visit_time is required' })

    const note =
      req.body.shop_visit_admin_note != null ? String(req.body.shop_visit_admin_note).trim() || null : null

    const result = await annualLeaveService.rescheduleShopVisit(id, req.user.userId, {
      shop_visit_date,
      shop_visit_time,
      shop_visit_admin_note: note,
    })
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' })
    if (result.error === 'leave_not_approved') {
      return res.status(400).json({ error: 'Leave must be approved' })
    }
    if (result.error === 'invalid_shop_state') {
      return res.status(400).json({ error: 'Cannot reschedule in the current shop visit state' })
    }

    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('rescheduleShopVisit error:', err)
    res.status(500).json({ error: 'Failed to reschedule shop visit' })
  }
}

async function completeShopVisit(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const result = await annualLeaveService.completeShopVisit(id)
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' })
    if (result.error === 'leave_not_approved') {
      return res.status(400).json({ error: 'Leave must be approved' })
    }
    if (result.error === 'invalid_shop_state') {
      return res.status(400).json({
        error: 'Process can only be completed after shop visit is confirmed or money is calculated',
      })
    }

    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('completeShopVisit error:', err)
    res.status(500).json({ error: 'Failed to complete shop visit process' })
  }
}

async function applyShopVisitCalculator(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    if (existing.status !== 'Approved') return res.status(400).json({ error: 'Leave must be approved' })
    if (!['Confirmed', 'MoneyCalculated'].includes(existing.shop_visit_status || '')) {
      return res.status(400).json({ error: 'Shop visit must be confirmed first' })
    }

    const applied = await annualLeaveService.applyLatestCalculatorSnapshot(id)
    if (!applied) {
      return res.status(409).json({
        error: 'No saved annual leave salary calculation found for this employee. Save one in Leave Salary Calculator first.',
      })
    }
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('applyShopVisitCalculator error:', err)
    res.status(500).json({ error: 'Failed to apply calculator snapshot' })
  }
}

async function patchShopVisitAdminNote(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await annualLeaveService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const note =
      req.body.shop_visit_admin_note != null ? String(req.body.shop_visit_admin_note).trim() || null : null
    const result = await annualLeaveService.updateShopVisitAdminNote(id, { shop_visit_admin_note: note })
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' })

    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(await attachLeavePhotoUrl(enriched))
  } catch (err) {
    console.error('patchShopVisitAdminNote error:', err)
    res.status(500).json({ error: 'Failed to update admin note' })
  }
}

module.exports = {
  list,
  listAlternateOptions,
  dashboard,
  getOne,
  create,
  update,
  confirmReturn,
  extendLeave,
  updateRemarks,
  remove,
  getLeaveRequestLetter,
  regenerateLeaveRequestLetter,
  getShopVisit,
  submitShopVisit,
  confirmShopVisit,
  rescheduleShopVisit,
  completeShopVisit,
  applyShopVisitCalculator,
  patchShopVisitAdminNote,
}

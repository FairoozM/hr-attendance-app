const employeesService = require('../services/employeesService')
const annualLeaveService = require('../services/annualLeaveService')

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

async function list(req, res) {
  try {
    const rows =
      req.user.role === 'employee'
        ? await annualLeaveService.listWithEmployeesForEmployee(parseInt(req.user.employeeId, 10))
        : await annualLeaveService.listWithEmployees()
    res.json(rows)
  } catch (err) {
    console.error('Annual leave list error:', err)
    res.status(500).json({ error: 'Failed to fetch annual leave requests' })
  }
}

async function dashboard(req, res) {
  try {
    const stats = await annualLeaveService.getDashboardStats()
    res.json(stats)
  } catch (err) {
    console.error('Annual leave dashboard error:', err)
    res.status(500).json({ error: 'Failed to fetch dashboard stats' })
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
    res.json(row)
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

    let status = req.body.status != null ? String(req.body.status).trim() : 'Pending'
    if (req.user.role === 'employee' && status !== 'Pending')
      return res.status(403).json({ error: 'Forbidden' })
    if (!annualLeaveService.isValidStatus(status))
      return res.status(400).json({ error: 'Invalid status' })

    const reason = req.body.reason?.trim() || null
    const row = await annualLeaveService.create({ employee_id: employeeId, from_date: fromDate, to_date: toDate, reason, status })
    const enriched = await annualLeaveService.findByIdWithEmployee(row.id)
    res.status(201).json(enriched || row)
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

    let status = req.body.status != null ? String(req.body.status).trim() : existing.status
    if (req.user.role === 'employee' && status !== 'Pending')
      return res.status(403).json({ error: 'Forbidden' })
    if (!annualLeaveService.isValidStatus(status))
      return res.status(400).json({ error: 'Invalid status' })

    const reason = req.body.reason !== undefined
      ? (req.body.reason?.trim() || null)
      : existing.reason

    const row = await annualLeaveService.update(id, { employee_id: employeeId, from_date: fromDate, to_date: toDate, reason, status })
    if (!row) return res.status(404).json({ error: 'Not found' })
    const enriched = await annualLeaveService.findByIdWithEmployee(id)
    res.json(enriched || row)
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
    res.json(enriched)
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
    res.json(enriched)
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
    res.json(enriched)
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

module.exports = { list, dashboard, getOne, create, update, confirmReturn, extendLeave, updateRemarks, remove }

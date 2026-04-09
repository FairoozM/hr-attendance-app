const employeesService = require('../services/employeesService')
const usersService = require('../services/usersService')
const s3Service = require('../services/s3Service')

async function attachPhotoUrl(emp) {
  if (emp && emp.photo_doc_key && !emp.photo_url) {
    try {
      emp.photo_url = await s3Service.getDownloadUrl({ key: emp.photo_doc_key, expiresIn: 3600 })
    } catch { /* keep null */ }
  }
  return emp
}

async function attachPhotoUrls(employees) {
  return Promise.all(employees.map(attachPhotoUrl))
}

function validateBody(body) {
  const errors = []
  const fullName = body.full_name != null ? String(body.full_name).trim() : ''
  const department = body.department != null ? String(body.department).trim() : ''
  if (!fullName) errors.push('full_name is required')
  if (!department) errors.push('department is required')
  return { fullName, department, errors }
}

/** Empty string → null; YYYY-MM-DD or null */
function parseJoiningDate(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function parseOptionalTrim(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function parseOptionalUrl(v) {
  const s = parseOptionalTrim(v)
  if (!s) return null
  if (s.length > 2048) return null
  return s
}

const VALID_OFF_DAYS = new Set(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
const VALID_LOCATIONS = new Set(['office','warehouse','remote'])

function extendedFields(body) {
  const rawOff = parseOptionalTrim(body.weekly_off_day)
  const rawLoc = parseOptionalTrim(body.duty_location)
  return {
    joining_date: parseJoiningDate(body.joining_date),
    photo_url: parseOptionalUrl(body.photo_url),
    phone: parseOptionalTrim(body.phone),
    emirates_id: parseOptionalTrim(body.emirates_id),
    passport_number: parseOptionalTrim(body.passport_number),
    nationality: parseOptionalTrim(body.nationality),
    weekly_off_day: rawOff && VALID_OFF_DAYS.has(rawOff.toLowerCase()) ? rawOff.toLowerCase() : null,
    duty_location: rawLoc && VALID_LOCATIONS.has(rawLoc.toLowerCase()) ? rawLoc.toLowerCase() : null,
  }
}

/** undefined → default for create, null for update (skip); explicit false is allowed */
function parseIncludeInAttendance(body, forCreate) {
  if (body.include_in_attendance === undefined) {
    return forCreate ? true : null
  }
  return Boolean(body.include_in_attendance)
}

async function me(req, res) {
  try {
    const id = parseInt(req.user.employeeId, 10)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session' })
    }
    const employee = await employeesService.findById(id)
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    res.json(await attachPhotoUrl(employee))
  } catch (err) {
    console.error('Employee me error:', err)
    res.status(500).json({ error: 'Failed to fetch employee' })
  }
}

async function list(req, res) {
  try {
    const employees = await employeesService.findAll()
    res.json(await attachPhotoUrls(employees))
  } catch (err) {
    console.error('Employees list error:', err)
    res.status(500).json({ error: 'Failed to fetch employees' })
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee id' })
    }
    if (req.user.role === 'employee') {
      if (parseInt(req.user.employeeId, 10) !== id) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    } else if (req.user.role !== 'admin' && req.user.role !== 'warehouse') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const employee = await employeesService.findById(id)
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    res.json(await attachPhotoUrl(employee))
  } catch (err) {
    console.error('Employee get error:', err)
    res.status(500).json({ error: 'Failed to fetch employee' })
  }
}

async function create(req, res) {
  try {
    const { fullName, department, errors } = validateBody(req.body)
    if (errors.length) {
      return res.status(400).json({ error: errors.join('; ') })
    }
    const employeeCode =
      req.body.employee_code != null ? String(req.body.employee_code).trim() : ''
    if (!employeeCode) {
      return res.status(400).json({ error: 'employee_code is required' })
    }
    const existing = await employeesService.findByEmployeeCode(employeeCode)
    if (existing) {
      return res.status(409).json({ error: 'employee_code already in use' })
    }
    const isActive = req.body.is_active !== false
    const ext = extendedFields(req.body)
    const employee = await employeesService.create({
      employee_code: employeeCode,
      full_name: fullName,
      department,
      is_active: isActive,
      include_in_attendance: parseIncludeInAttendance(req.body, true),
      ...ext,
    })
    try {
      await usersService.syncEmployeePortal(employee.id, req.body, true)
    } catch (e) {
      await employeesService.remove(employee.id)
      return res.status(400).json({ error: e.message || 'Portal setup failed' })
    }
    const io = req.app.get('io')
    if (io) io.emit('employees:changed', { action: 'created', employee })
    res.status(201).json(employee)
  } catch (err) {
    console.error('Employee create error:', err)
    res.status(500).json({ error: 'Failed to create employee' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee id' })
    }
    const { fullName, department, errors } = validateBody(req.body)
    if (errors.length) {
      return res.status(400).json({ error: errors.join('; ') })
    }
    const existing = await employeesService.findById(id)
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    const employeeCode =
      req.body.employee_code != null ? String(req.body.employee_code).trim() : null
    if (employeeCode !== null) {
      const duplicate = await employeesService.findByEmployeeCode(employeeCode, id)
      if (duplicate) {
        return res.status(409).json({ error: 'employee_code already in use' })
      }
    }
    const isActive =
      req.body.is_active === undefined ? null : Boolean(req.body.is_active)
    const ext = extendedFields(req.body)
    const employee = await employeesService.update(id, {
      employee_code: employeeCode,
      full_name: fullName || undefined,
      department: department || undefined,
      is_active: isActive,
      joining_date: ext.joining_date,
      photo_url: ext.photo_url,
      phone: ext.phone,
      emirates_id: ext.emirates_id,
      passport_number: ext.passport_number,
      nationality: ext.nationality,
      include_in_attendance: parseIncludeInAttendance(req.body, false),
      weekly_off_day: ext.weekly_off_day,
      duty_location: ext.duty_location,
    })
    try {
      await usersService.syncEmployeePortal(id, req.body, false)
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Portal update failed' })
    }
    const io = req.app.get('io')
    if (io) io.emit('employees:changed', { action: 'updated', employee })
    res.json(employee)
  } catch (err) {
    console.error('Employee update error:', err)
    res.status(500).json({ error: 'Failed to update employee' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee id' })
    }
    await usersService.deleteByEmployeeId(id)
    const deleted = await employeesService.remove(id)
    if (!deleted) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    const io = req.app.get('io')
    if (io) io.emit('employees:changed', { action: 'deleted', id })
    res.status(204).send()
  } catch (err) {
    console.error('Employee delete error:', err)
    res.status(500).json({ error: 'Failed to delete employee' })
  }
}

module.exports = { me, list, getOne, create, update, remove }

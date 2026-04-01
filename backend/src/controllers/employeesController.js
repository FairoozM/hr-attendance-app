const employeesService = require('../services/employeesService')

function validateBody(body, requireAll = false) {
  const errors = []
  const fullName = body.full_name != null ? String(body.full_name).trim() : ''
  const department = body.department != null ? String(body.department).trim() : ''
  if (!fullName) errors.push('full_name is required')
  if (!department) errors.push('department is required')
  return { fullName, department, errors }
}

async function list(req, res) {
  try {
    const employees = await employeesService.findAll()
    res.json(employees)
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
    const employee = await employeesService.findById(id)
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    res.json(employee)
  } catch (err) {
    console.error('Employee get error:', err)
    res.status(500).json({ error: 'Failed to fetch employee' })
  }
}

async function create(req, res) {
  try {
    const { fullName, department, errors } = validateBody(req.body, true)
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
    const employee = await employeesService.create({
      employee_code: employeeCode,
      full_name: fullName,
      department,
      is_active: isActive,
    })
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
      const duplicate = await employeesService.findByEmployeeCode(
        employeeCode,
        id
      )
      if (duplicate) {
        return res.status(409).json({ error: 'employee_code already in use' })
      }
    }
    const isActive =
      req.body.is_active === undefined ? undefined : Boolean(req.body.is_active)
    const employee = await employeesService.update(id, {
      employee_code: employeeCode,
      full_name: fullName || undefined,
      department: department || undefined,
      is_active: isActive,
    })
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

module.exports = { list, getOne, create, update, remove }

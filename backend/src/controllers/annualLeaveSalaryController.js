const service = require('../services/annualLeaveSalaryService')

function parseNum(v, fallback = 0) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function parseDate(v) {
  if (!v) return new Date().toISOString().slice(0, 10)
  const s = String(v).trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10)
}

function buildData(body, userId) {
  const monthly_salary      = parseNum(body.monthly_salary)
  const per_day_rate        = parseNum(body.per_day_rate, monthly_salary / 30)
  const running_month_days  = parseNum(body.running_month_days)
  const running_month_amount = parseNum(body.running_month_amount, per_day_rate * running_month_days)
  const annual_leave_days_eligible = parseNum(body.annual_leave_days_eligible)
  const leave_days_to_pay   = parseNum(body.leave_days_to_pay)
  const leave_salary_amount = parseNum(body.leave_salary_amount, per_day_rate * leave_days_to_pay)
  const other_additions     = parseNum(body.other_additions)
  const other_deductions    = parseNum(body.other_deductions)
  const grand_total         = parseNum(
    body.grand_total,
    running_month_amount + leave_salary_amount + other_additions - other_deductions
  )
  return {
    calculation_date: parseDate(body.calculation_date),
    monthly_salary, per_day_rate,
    running_month_days, running_month_amount,
    annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
    other_additions, other_deductions, grand_total,
    remarks: body.remarks != null ? String(body.remarks).trim() : null,
    created_by: userId || null,
  }
}

async function list(req, res) {
  try {
    const employeeId = req.query.employee_id ? parseInt(req.query.employee_id, 10) : null
    const rows = await service.findAll(employeeId ? { employeeId } : {})
    res.json(rows)
  } catch (err) {
    console.error('[als] list error:', err)
    res.status(500).json({ error: 'Failed to fetch records' })
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await service.findById(id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) {
    console.error('[als] getOne error:', err)
    res.status(500).json({ error: 'Failed to fetch record' })
  }
}

async function create(req, res) {
  try {
    const employeeId = parseInt(req.body.employee_id, 10)
    if (Number.isNaN(employeeId)) return res.status(400).json({ error: 'employee_id is required' })
    const monthly = parseNum(req.body.monthly_salary)
    if (monthly <= 0) return res.status(400).json({ error: 'monthly_salary must be greater than 0' })
    const data = { employee_id: employeeId, ...buildData(req.body, req.user.userId) }
    const row = await service.create(data)
    res.status(201).json(row)
  } catch (err) {
    console.error('[als] create error:', err)
    res.status(500).json({ error: err.message || 'Failed to save record' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await service.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const monthly = parseNum(req.body.monthly_salary)
    if (monthly <= 0) return res.status(400).json({ error: 'monthly_salary must be greater than 0' })
    const row = await service.update(id, buildData(req.body, req.user.userId))
    res.json(row)
  } catch (err) {
    console.error('[als] update error:', err)
    res.status(500).json({ error: err.message || 'Failed to update record' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await service.findById(id)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    await service.remove(id)
    res.status(204).send()
  } catch (err) {
    console.error('[als] remove error:', err)
    res.status(500).json({ error: 'Failed to delete record' })
  }
}

module.exports = { list, getOne, create, update, remove }

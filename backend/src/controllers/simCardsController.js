const simCardsService = require('../services/simCardsService')

function cleanText(v, { required = false } = {}) {
  const s = v == null ? '' : String(v).trim()
  if (!s && required) return null
  return s
}

function parseMonthly(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function normalizeUsage(v) {
  const s = cleanText(v, { required: true })
  if (!s) return null
  const low = s.toLowerCase()
  if (low === 'yes') return 'Yes'
  if (low === 'no') return 'No'
  return null
}

function normalizePayload(body) {
  const number = cleanText(body.number, { required: true })
  const person = cleanText(body.person, { required: true })
  const usage = normalizeUsage(body.usage)
  const type = cleanText(body.type, { required: true })
  const issued = cleanText(body.issued, { required: true })
  const monthly = parseMonthly(body.monthly_charges_aed)

  const errors = []
  if (!number) errors.push('number is required')
  if (!person) errors.push('person is required')
  if (monthly == null) errors.push('monthly_charges_aed must be a valid number')
  if (!usage) errors.push('usage must be "Yes" or "No"')
  if (!type) errors.push('type is required')
  if (!issued) errors.push('issued is required')

  return {
    errors,
    value: {
      number,
      remarks: cleanText(body.remarks) || '',
      person,
      imei_number: cleanText(body.imei_number) || '',
      mobile_number: cleanText(body.mobile_number) || '',
      monthly_charges_aed: monthly,
      usage,
      type,
      issued,
    },
  }
}

async function list(req, res) {
  try {
    const rows = await simCardsService.findAll()
    res.json(rows)
  } catch (err) {
    console.error('[sim-cards] list error:', err)
    res.status(500).json({ error: 'Failed to fetch sim cards list' })
  }
}

async function create(req, res) {
  try {
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await simCardsService.create(payload.value)
    res.status(201).json(row)
  } catch (err) {
    console.error('[sim-cards] create error:', err)
    res.status(500).json({ error: 'Failed to create sim card record' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await simCardsService.findById(id)
    if (!existing) return res.status(404).json({ error: 'Sim card record not found' })
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await simCardsService.update(id, payload.value)
    res.json(row)
  } catch (err) {
    console.error('[sim-cards] update error:', err)
    res.status(500).json({ error: 'Failed to update sim card record' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const ok = await simCardsService.remove(id)
    if (!ok) return res.status(404).json({ error: 'Sim card record not found' })
    res.status(204).send()
  } catch (err) {
    console.error('[sim-cards] delete error:', err)
    res.status(500).json({ error: 'Failed to delete sim card record' })
  }
}

module.exports = {
  list,
  create,
  update,
  remove,
}

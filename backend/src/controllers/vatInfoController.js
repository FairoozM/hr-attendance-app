const vatInfoService = require('../services/vatInfoService')

const ALLOWED_COUNTRIES = new Set(['UAE', 'KSA'])

function cleanText(v, { required = false } = {}) {
  const s = v == null ? '' : String(v).trim()
  if (!s && required) return null
  return s
}

function parseNumber(v, { required = false } = {}) {
  if (v == null || v === '') {
    return required ? null : 0
  }
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10000) / 10000
}

function parseDate(v) {
  const s = cleanText(v)
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return undefined
  return s
}

function normalizeCountry(v) {
  const s = cleanText(v, { required: true })
  if (!s) return null
  const upper = s.toUpperCase()
  if (upper === 'UAE' || upper === 'AE') return 'UAE'
  if (upper === 'KSA' || upper === 'SA' || upper === 'SAUDI ARABIA') return 'KSA'
  return null
}

function normalizePayload(body) {
  const company_name = cleanText(body.company_name, { required: true })
  const vat_number = cleanText(body.vat_number, { required: true })
  const country = normalizeCountry(body.country)
  const date_first_registered = parseDate(body.date_first_registered)
  const vat_pct = parseNumber(body.vat_pct, { required: true })
  const vat_filings = cleanText(body.vat_filings) || 'Quarterly'
  const agent = cleanText(body.agent) || ''
  const charges_of_filing = parseNumber(body.charges_of_filing)

  const errors = []
  if (!company_name) errors.push('company_name is required')
  if (!vat_number) errors.push('vat_number is required')
  if (!country || !ALLOWED_COUNTRIES.has(country)) errors.push('country must be UAE or KSA')
  if (date_first_registered === undefined) errors.push('date_first_registered must be YYYY-MM-DD')
  if (vat_pct == null || vat_pct < 0) errors.push('vat_pct must be a valid non-negative number')
  if (charges_of_filing == null || charges_of_filing < 0) {
    errors.push('charges_of_filing must be a valid non-negative number')
  }

  return {
    errors,
    value: {
      company_name,
      vat_number,
      country,
      date_first_registered,
      vat_pct,
      vat_filings,
      agent,
      charges_of_filing,
    },
  }
}

function parseId(raw) {
  const id = parseInt(raw, 10)
  return Number.isNaN(id) ? null : id
}

function getUserId(req) {
  const id = req.user?.id
  const n = Number(id)
  return Number.isFinite(n) ? n : null
}

async function list(req, res) {
  try {
    const rows = await vatInfoService.findAll()
    res.json(rows)
  } catch (err) {
    console.error('[vat-info] list error:', err)
    res.status(500).json({ error: 'Failed to fetch VAT info list' })
  }
}

async function create(req, res) {
  try {
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await vatInfoService.create(payload.value)
    res.status(201).json(row)
  } catch (err) {
    console.error('[vat-info] create error:', err)
    res.status(500).json({ error: 'Failed to create VAT info record' })
  }
}

async function update(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id == null) return res.status(400).json({ error: 'Invalid id' })
    const existing = await vatInfoService.findById(id)
    if (!existing) return res.status(404).json({ error: 'VAT info record not found' })
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await vatInfoService.update(id, payload.value)
    res.json(row)
  } catch (err) {
    console.error('[vat-info] update error:', err)
    res.status(500).json({ error: 'Failed to update VAT info record' })
  }
}

async function remove(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id == null) return res.status(400).json({ error: 'Invalid id' })
    const ok = await vatInfoService.remove(id)
    if (!ok) return res.status(404).json({ error: 'VAT info record not found' })
    res.status(204).send()
  } catch (err) {
    console.error('[vat-info] delete error:', err)
    res.status(500).json({ error: 'Failed to delete VAT info record' })
  }
}

async function listCertificates(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id == null) return res.status(400).json({ error: 'Invalid id' })
    const existing = await vatInfoService.findById(id)
    if (!existing) return res.status(404).json({ error: 'VAT info record not found' })
    const rows = await vatInfoService.listCertificates(id)
    res.json(rows)
  } catch (err) {
    console.error('[vat-info] list certificates error:', err)
    res.status(500).json({ error: 'Failed to list certificates' })
  }
}

async function getCertificateUploadUrl(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id == null) return res.status(400).json({ error: 'Invalid id' })
    const existing = await vatInfoService.findById(id)
    if (!existing) return res.status(404).json({ error: 'VAT info record not found' })

    const fileName = cleanText(req.body?.fileName, { required: true })
    const contentType = cleanText(req.body?.contentType, { required: true })
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' })
    }

    const result = await vatInfoService.getCertificateUploadUrl(id, {
      fileName,
      contentType,
      fileSize: req.body?.fileSize,
    })
    res.json(result)
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    console.error('[vat-info] certificate upload-url error:', err)
    res.status(500).json({ error: 'Failed to get certificate upload URL' })
  }
}

async function saveCertificate(req, res) {
  try {
    const id = parseId(req.params.id)
    if (id == null) return res.status(400).json({ error: 'Invalid id' })
    const existing = await vatInfoService.findById(id)
    if (!existing) return res.status(404).json({ error: 'VAT info record not found' })

    const s3Key = cleanText(req.body?.s3Key, { required: true })
    const fileName = cleanText(req.body?.fileName, { required: true })
    if (!s3Key || !fileName) {
      return res.status(400).json({ error: 's3Key and fileName are required' })
    }

    const row = await vatInfoService.saveCertificate(id, {
      s3Key,
      fileName,
      fileType: cleanText(req.body?.fileType) || '',
      fileSize: req.body?.fileSize,
      uploadedBy: getUserId(req),
    })
    res.status(201).json(row)
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    console.error('[vat-info] save certificate error:', err)
    res.status(500).json({ error: 'Failed to save certificate' })
  }
}

async function getCertificateDownloadUrl(req, res) {
  try {
    const id = parseId(req.params.id)
    const certId = parseId(req.params.certId)
    if (id == null || certId == null) return res.status(400).json({ error: 'Invalid id' })
    const result = await vatInfoService.getCertificateDownloadUrl(id, certId)
    if (!result) return res.status(404).json({ error: 'Certificate not found' })
    res.json(result)
  } catch (err) {
    console.error('[vat-info] certificate download-url error:', err)
    res.status(500).json({ error: 'Failed to get certificate download URL' })
  }
}

async function deleteCertificate(req, res) {
  try {
    const id = parseId(req.params.id)
    const certId = parseId(req.params.certId)
    if (id == null || certId == null) return res.status(400).json({ error: 'Invalid id' })
    const ok = await vatInfoService.deleteCertificate(id, certId)
    if (!ok) return res.status(404).json({ error: 'Certificate not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[vat-info] delete certificate error:', err)
    res.status(500).json({ error: 'Failed to delete certificate' })
  }
}

module.exports = {
  list,
  create,
  update,
  remove,
  listCertificates,
  getCertificateUploadUrl,
  saveCertificate,
  getCertificateDownloadUrl,
  deleteCertificate,
}

const influencersService = require('../services/influencersService')

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function sanitizeInfluencerList(body) {
  if (!body || !Array.isArray(body.influencers)) {
    return { error: 'Body must be a JSON object with an "influencers" array' }
  }
  const out = []
  for (const row of body.influencers) {
    if (!isPlainObject(row)) continue
    const id = row.id != null ? String(row.id).trim() : ''
    if (!id) continue
    out.push(row)
  }
  return { list: out }
}

function sanitizeSingleInfluencer(body) {
  if (!isPlainObject(body)) {
    return { error: 'Body must be a JSON object' }
  }
  const id = body.id != null ? String(body.id).trim() : ''
  if (!id) return { error: 'Influencer id is required' }
  return { row: body, id }
}

async function listInfluencers(req, res) {
  try {
    const list = await influencersService.getInfluencers()
    const pageRaw = req.query.page
    const limitRaw = req.query.limit
    const page = pageRaw != null && pageRaw !== '' ? Number.parseInt(String(pageRaw), 10) : NaN
    const limit = limitRaw != null && limitRaw !== '' ? Number.parseInt(String(limitRaw), 10) : NaN
    const wantPaging =
      Number.isFinite(page) &&
      Number.isFinite(limit) &&
      page >= 1 &&
      limit >= 1 &&
      limit <= 200

    if (wantPaging) {
      const total = list.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const p = Math.min(Math.max(1, page), totalPages)
      const start = (p - 1) * limit
      const slice = list.slice(start, start + limit)
      return res.json({
        influencers: slice,
        total,
        page: p,
        limit,
        totalPages,
      })
    }

    res.json(list)
  } catch (err) {
    console.error('[influencers] list error:', err)
    res.status(500).json({
      error: 'Failed to load influencers',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function createInfluencer(req, res) {
  try {
    const parsed = sanitizeSingleInfluencer(req.body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const row = await influencersService.addInfluencer(parsed.row)
    res.status(201).json({ success: true, influencer: row })
  } catch (err) {
    console.error('[influencers] create error:', err)
    res.status(500).json({
      error: 'Failed to create influencer',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function putInfluencers(req, res) {
  try {
    const parsed = sanitizeInfluencerList(req.body)
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error })
    }
    const merged = await influencersService.mergeInfluencersWithSnapshot(parsed.list)
    res.json({ success: true, count: merged.length })
  } catch (err) {
    console.error('[influencers] put error:', err)
    res.status(500).json({
      error: 'Failed to save influencers',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function updateInfluencer(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const parsed = sanitizeSingleInfluencer(req.body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const row = { ...parsed.row, id }
    await influencersService.upsertInfluencerById(id, row)
    res.json({ success: true, influencer: row })
  } catch (err) {
    console.error('[influencers] update error:', err)
    res.status(500).json({
      error: 'Failed to update influencer',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function deleteInfluencer(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) {
      return res.status(400).json({ error: 'Missing influencer id' })
    }
    await influencersService.removeInfluencerById(id)
    res.json({ success: true })
  } catch (err) {
    console.error('[influencers] delete error:', err)
    res.status(500).json({
      error: 'Failed to delete influencer',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

module.exports = {
  listInfluencers,
  createInfluencer,
  putInfluencers,
  updateInfluencer,
  deleteInfluencer,
}

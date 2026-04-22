const influencersService = require('../services/influencersService')
const s3Service = require('../services/s3Service')

const MAX_INSIGHT_IMAGES = 6

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
    const rowPayload = { ...parsed.row }
    if (Array.isArray(rowPayload.insightsImageKeys)) {
      rowPayload.insightsImageKeys = normalizeInsightsImageKeys(
        { insightsImageKeys: rowPayload.insightsImageKeys },
        {},
        rowPayload.id,
      )
    }
    const row = await influencersService.addInfluencer(rowPayload)
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

function insightsKeyPrefixForInfluencer(influencerId) {
  const sid = String(influencerId || '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return `influencer-insights/${sid}/`
}

function normalizeInsightsImageKeys(body, existing, influencerId) {
  const prefix = insightsKeyPrefixForInfluencer(influencerId)
  const valid = (k) => typeof k === 'string' && k.trim().startsWith(prefix)

  if (!Array.isArray(body?.insightsImageKeys)) {
    const cur = Array.isArray(existing?.insightsImageKeys) ? existing.insightsImageKeys : []
    return cur.filter(valid).slice(0, MAX_INSIGHT_IMAGES)
  }
  return body.insightsImageKeys
    .filter(valid)
    .map((k) => k.trim())
    .slice(0, MAX_INSIGHT_IMAGES)
}

async function updateInfluencer(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const parsed = sanitizeSingleInfluencer(req.body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) {
      return res.status(404).json({ error: 'Influencer not found' })
    }
    const oldKeys = Array.isArray(existing?.insightsImageKeys) ? existing.insightsImageKeys : []
    const nextKeys = normalizeInsightsImageKeys(parsed.row, existing, id)
    /** Merge with stored row so partial PATCH (or client form with empty insightsImageKeys) never wipes the record. */
    const row = { ...existing, ...parsed.row, id, insightsImageKeys: nextKeys }
    await influencersService.upsertInfluencerById(id, row)
    for (const k of oldKeys) {
      if (!nextKeys.includes(k)) {
        await s3Service.deleteObjectIfExists(k).catch(() => {})
      }
    }
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
    const existing = await influencersService.getInfluencerById(id)
    const keys = Array.isArray(existing?.insightsImageKeys) ? existing.insightsImageKeys : []
    await influencersService.removeInfluencerById(id)
    for (const k of keys) {
      await s3Service.deleteObjectIfExists(k).catch(() => {})
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[influencers] delete error:', err)
    res.status(500).json({
      error: 'Failed to delete influencer',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function getInsightsImageUploadUrl(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) return res.status(404).json({ error: 'Influencer not found' })
    const keys = Array.isArray(existing.insightsImageKeys) ? existing.insightsImageKeys : []
    if (keys.length >= MAX_INSIGHT_IMAGES) {
      return res.status(400).json({ error: `Maximum ${MAX_INSIGHT_IMAGES} insights images per influencer` })
    }
    const { fileName, contentType } = req.body || {}
    const ct = String(contentType || '').toLowerCase()
    if (!ct.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' })
    }
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ error: 'fileName is required' })
    }
    const key = s3Service.createInfluencerInsightsImageKey(id, fileName)
    const uploadUrl = await s3Service.getUploadUrl({ key, contentType: ct })
    res.json({ uploadUrl, key })
  } catch (err) {
    console.error('[influencers] insights upload-url error:', err)
    res.status(err.status || 500).json({
      error: err.message || 'Failed to create upload URL',
      detail: err && err.message ? String(err.message).slice(0, 240) : undefined,
    })
  }
}

async function getInsightsImageSignedUrls(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) return res.status(404).json({ error: 'Influencer not found' })
    const keys = Array.isArray(existing.insightsImageKeys) ? existing.insightsImageKeys : []
    const items = await Promise.all(
      keys.map(async (key) => ({
        key,
        url: await s3Service.getDownloadUrl({ key, expiresIn: 3600 }),
      })),
    )
    res.json({ items })
  } catch (err) {
    console.error('[influencers] insights urls error:', err)
    res.status(500).json({
      error: 'Failed to sign image URLs',
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
  getInsightsImageUploadUrl,
  getInsightsImageSignedUrls,
}

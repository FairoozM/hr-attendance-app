const influencersService = require('../services/influencersService')
const s3Service = require('../services/s3Service')
const {
  fetchInstagramBusinessProfile,
  normalizeInstagramUsername,
} = require('../services/instagramService')

const MAX_INSIGHT_IMAGES = 6

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Enrich `row` from Instagram Graph Business Discovery when the caller opts in.
 * On API errors, does not clear an existing `instagram.picUrl` (only successful responses update it).
 */
async function applyOptionalInstagramGraphSync(row) {
  const h = normalizeInstagramUsername(row && row.instagram && row.instagram.handle)
  if (!h) {
    return {
      success: false,
      username: '',
      profilePictureUrl: null,
      errorCode: 'NO_HANDLE',
      errorMessage: 'No valid Instagram handle on this influencer.',
    }
  }
  const gr = await fetchInstagramBusinessProfile(h)
  if (gr.success) {
    row.instagram = { ...(row.instagram || {}), picUrl: gr.profilePictureUrl != null ? gr.profilePictureUrl : null }
    if (gr.followersCount != null) row.followersCount = gr.followersCount
  }
  return gr
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
    const body = isPlainObject(req.body) ? { ...req.body } : {}
    const syncFromGraph = body.syncInstagramFromGraph === true
    delete body.syncInstagramFromGraph
    const parsed = sanitizeSingleInfluencer(body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const rowPayload = { ...parsed.row }
    if (Array.isArray(rowPayload.insightsImageKeys)) {
      rowPayload.insightsImageKeys = normalizeInsightsImageKeys(
        { insightsImageKeys: rowPayload.insightsImageKeys },
        {},
        rowPayload.id,
      )
    }
    let instagramGraph = null
    if (syncFromGraph) {
      instagramGraph = await applyOptionalInstagramGraphSync(rowPayload)
    }
    const row = await influencersService.addInfluencer(rowPayload)
    res.status(201).json({ success: true, influencer: row, instagramGraph })
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

/** Required fields that must never be cleared by a stale PATCH (silently dropped from the patch). */
const PROTECTED_NON_EMPTY_FIELDS = ['name']

function sanitizePatchRow(parsedRow, existing) {
  const out = { ...parsedRow }
  for (const f of PROTECTED_NON_EMPTY_FIELDS) {
    const incoming = out[f]
    const had = existing && existing[f]
    const incomingEmpty =
      incoming === undefined || incoming === null || (typeof incoming === 'string' && !incoming.trim())
    if (incomingEmpty && had) {
      delete out[f]
    }
  }
  /** Append-only timeline support: avoids a stale full-timeline payload truncating server state. */
  if (out.timelineAppend && typeof out.timelineAppend === 'object') {
    const base = Array.isArray(existing?.timeline) ? existing.timeline : []
    out.timeline = [...base, out.timelineAppend]
    delete out.timelineAppend
  }
  return out
}

async function updateInfluencer(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const body = isPlainObject(req.body) ? { ...req.body } : {}
    const syncFromGraph = body.syncInstagramFromGraph === true
    delete body.syncInstagramFromGraph
    const parsed = sanitizeSingleInfluencer(body)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) {
      return res.status(404).json({ error: 'Influencer not found' })
    }
    const oldKeys = Array.isArray(existing?.insightsImageKeys) ? existing.insightsImageKeys : []
    const safeRow = sanitizePatchRow(parsed.row, existing)
    const nextKeys = normalizeInsightsImageKeys(safeRow, existing, id)
    /** Merge with stored row so partial PATCH never wipes the record. */
    let row = { ...existing, ...safeRow, id, insightsImageKeys: nextKeys }
    let instagramGraph = null
    if (syncFromGraph) {
      instagramGraph = await applyOptionalInstagramGraphSync(row)
    }
    await influencersService.upsertInfluencerById(id, row)
    for (const k of oldKeys) {
      if (!nextKeys.includes(k)) {
        await s3Service.deleteObjectIfExists(k).catch(() => {})
      }
    }
    res.json({ success: true, influencer: row, instagramGraph })
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

/** Batch presign: one snapshot read instead of N — drastically reduces upload latency. */
async function getInsightsImageUploadUrlsBatch(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) return res.status(404).json({ error: 'Influencer not found' })
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) {
      return res.status(400).json({ error: 'items[] required' })
    }
    if (items.length > MAX_INSIGHT_IMAGES) {
      return res.status(400).json({ error: `Cannot request more than ${MAX_INSIGHT_IMAGES} URLs at once` })
    }
    const usedCount = Array.isArray(existing.insightsImageKeys) ? existing.insightsImageKeys.length : 0
    if (usedCount + items.length > MAX_INSIGHT_IMAGES) {
      return res.status(400).json({
        error: `Only ${Math.max(0, MAX_INSIGHT_IMAGES - usedCount)} more image(s) allowed`,
      })
    }
    for (const it of items) {
      const ct = String(it?.contentType || '').toLowerCase()
      if (!ct.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image files are allowed' })
      }
      if (!it?.fileName || typeof it.fileName !== 'string') {
        return res.status(400).json({ error: 'fileName is required for every item' })
      }
    }
    const out = await Promise.all(
      items.map(async (it) => {
        const ct = String(it.contentType).toLowerCase()
        const key = s3Service.createInfluencerInsightsImageKey(id, it.fileName)
        const uploadUrl = await s3Service.getUploadUrl({ key, contentType: ct })
        return { uploadUrl, key, contentType: ct }
      }),
    )
    res.json({ items: out })
  } catch (err) {
    console.error('[influencers] insights batch upload-url error:', err)
    res.status(err.status || 500).json({
      error: err.message || 'Failed to create upload URLs',
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

/**
 * Fetches Business Discovery data and persists `instagram.picUrl` (and optional `followersCount`) on success.
 * Returns a normalized graph payload without raw Meta error objects.
 */
async function refreshInstagramProfileFromGraph(req, res) {
  try {
    const id = req.params.id != null ? String(req.params.id).trim() : ''
    if (!id) return res.status(400).json({ error: 'Missing influencer id' })
    const existing = await influencersService.getInfluencerById(id)
    if (!existing) {
      return res.status(404).json({ error: 'Influencer not found' })
    }
    const h = normalizeInstagramUsername(existing.instagram && existing.instagram.handle)
    if (!h) {
      return res.status(400).json({ error: 'No valid Instagram handle on this influencer' })
    }
    const gr = await fetchInstagramBusinessProfile(h)
    if (gr.success) {
      const row = {
        ...existing,
        instagram: {
          ...(existing.instagram || {}),
          picUrl: gr.profilePictureUrl != null ? gr.profilePictureUrl : null,
        },
        updatedAt: new Date().toISOString(),
      }
      if (gr.followersCount != null) row.followersCount = gr.followersCount
      await influencersService.upsertInfluencerById(id, row)
      return res.json({ success: true, graph: gr, influencer: row })
    }
    return res.json({ success: false, graph: gr })
  } catch (err) {
    console.error('[influencers] refresh Instagram graph error:', err)
    return res.status(500).json({
      error: 'Failed to refresh Instagram profile',
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
  getInsightsImageUploadUrlsBatch,
  getInsightsImageSignedUrls,
  refreshInstagramProfileFromGraph,
}

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

async function listInfluencers(_req, res) {
  try {
    const list = await influencersService.getInfluencers()
    res.json(list)
  } catch (err) {
    console.error('[influencers] list error:', err)
    res.status(500).json({
      error: 'Failed to load influencers',
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

module.exports = { listInfluencers, putInfluencers, deleteInfluencer }

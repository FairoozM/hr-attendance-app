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
    res.status(500).json({ error: 'Failed to load influencers' })
  }
}

async function putInfluencers(req, res) {
  try {
    const parsed = sanitizeInfluencerList(req.body)
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error })
    }
    await influencersService.replaceInfluencers(parsed.list)
    res.json({ success: true, count: parsed.list.length })
  } catch (err) {
    console.error('[influencers] put error:', err)
    res.status(500).json({ error: 'Failed to save influencers' })
  }
}

module.exports = { listInfluencers, putInfluencers }

const express = require('express')
const https = require('https')
const router = express.Router()

// In-memory cache: username → { picUrl, fullName, followersCount, timestamp }
const cache = new Map()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function fetchPage(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...headers,
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.end()
  })
}

function extractOgMeta(html) {
  const picMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)
  const descMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/)

  let picUrl = picMatch ? picMatch[1].replace(/&amp;/g, '&') : null
  let fullName = null
  let followersCount = null

  if (titleMatch) {
    // "Full Name (@handle) • Instagram photos and videos"
    const m = titleMatch[1].match(/^(.+?)\s*\(/)
    if (m) fullName = m[1].trim()
  }

  if (descMatch) {
    // "123K Followers, ..."
    const m = descMatch[1].match(/([\d,KMB.]+)\s+Followers/i)
    if (m) followersCount = m[1]
  }

  return { picUrl, fullName, followersCount }
}

async function fetchInstagramProfile(username) {
  const { status, body } = await fetchPage('www.instagram.com', `/${encodeURIComponent(username)}/`, {})
  if (status === 404) throw new Error('Profile not found')
  if (status !== 200) throw new Error(`Instagram returned HTTP ${status}`)

  const data = extractOgMeta(body)
  if (!data.picUrl) throw new Error('Could not extract profile picture')
  return data
}

function proxyImage(url, res) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Referer': 'https://www.instagram.com/',
      },
    }
    const req = https.request(options, (imgRes) => {
      if (imgRes.statusCode !== 200) return reject(new Error(`Image fetch failed: ${imgRes.statusCode}`))
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Access-Control-Allow-Origin', '*')
      imgRes.pipe(res)
      imgRes.on('end', resolve)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Image fetch timed out')) })
    req.end()
  })
}

// GET /api/instagram-proxy/avatar/:username — proxies profile pic as image
router.get('/avatar/:username', async (req, res) => {
  const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase()
  if (!username || !/^[\w.]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' })
  }

  try {
    const cached = cache.get(username)
    let picUrl
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      picUrl = cached.picUrl
    } else {
      const profile = await fetchInstagramProfile(username)
      cache.set(username, { ...profile, timestamp: Date.now() })
      picUrl = profile.picUrl
    }

    if (!picUrl) return res.status(404).json({ error: 'No profile pic found' })
    await proxyImage(picUrl, res)
  } catch (err) {
    console.error('[instagram-proxy] avatar error:', err.message)
    if (!res.headersSent) res.status(502).json({ error: err.message })
  }
})

// GET /api/instagram-proxy/profile/:username — returns JSON metadata
router.get('/profile/:username', async (req, res) => {
  const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase()
  if (!username || !/^[\w.]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' })
  }

  try {
    const cached = cache.get(username)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.json({ username, ...cached })
    }
    const profile = await fetchInstagramProfile(username)
    cache.set(username, { ...profile, timestamp: Date.now() })
    res.json({ username, ...profile })
  } catch (err) {
    console.error('[instagram-proxy] profile error:', err.message)
    if (!res.headersSent) res.status(502).json({ error: err.message })
  }
})

module.exports = router

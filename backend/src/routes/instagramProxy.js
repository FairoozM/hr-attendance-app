const express = require('express')
const https = require('https')
const router = express.Router()

// Simple in-memory cache: username → { picUrl, fullName, followersCount, timestamp }
const cache = new Map()
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

function fetchInstagramProfile(username) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'i.instagram.com',
      path: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'x-ig-app-id': '936619743392459',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Instagram API: ${res.statusCode}`))
        try {
          const json = JSON.parse(data)
          const user = json?.data?.user
          if (!user) return reject(new Error('User not found'))
          resolve({
            picUrl: user.profile_pic_url_hd || user.profile_pic_url || null,
            fullName: user.full_name || null,
            followersCount: user.edge_followed_by?.count ?? null,
          })
        } catch (e) {
          reject(new Error('Failed to parse Instagram response'))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Instagram request timed out')) })
    req.end()
  })
}

function proxyImage(url, res) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Referer': 'https://www.instagram.com/',
      },
    }
    const req = https.request(options, (imgRes) => {
      if (imgRes.statusCode !== 200) return reject(new Error(`Image fetch: ${imgRes.statusCode}`))
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=1800')
      imgRes.pipe(res)
      imgRes.on('end', resolve)
    })
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Image fetch timed out')) })
    req.end()
  })
}

// GET /api/instagram-proxy/avatar/:username  — proxies the profile pic as an image
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
    if (!res.headersSent) res.status(502).json({ error: err.message })
  }
})

// GET /api/instagram-proxy/profile/:username  — returns JSON with profile metadata
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
    if (!res.headersSent) res.status(502).json({ error: err.message })
  }
})

module.exports = router

const express = require('express')
const https = require('https')
const router = express.Router()

// In-memory cache: username → { picUrl, fullName, followersCount, timestamp }
const cache = new Map()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function fetchUrl(url, redirectsLeft = 5, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        ...extraHeaders,
      },
    }
    const req = https.request(options, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${parsed.hostname}${res.headers.location}`
        res.resume()
        return fetchUrl(next, redirectsLeft - 1, extraHeaders).then(resolve).catch(reject)
      }
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
  // Try the JSON API first (faster, structured data)
  try {
    const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    const { status, body } = await fetchUrl(apiUrl, 5, {
      'x-ig-app-id': '936619743392459',
      'x-csrftoken': 'missing',
      'x-ig-www-claim': '0',
      'Referer': 'https://www.instagram.com/',
    })
    if (status === 200) {
      const json = JSON.parse(body)
      const user = json?.data?.user
      if (user) {
        return {
          picUrl: user.profile_pic_url_hd || user.profile_pic_url || null,
          fullName: user.full_name || null,
          followersCount: user.edge_followed_by?.count
            ? String(user.edge_followed_by.count)
            : null,
        }
      }
    }
  } catch (_) {
    // fall through to og:image scrape
  }

  // Fallback: scrape og:image from profile page
  const { status, body } = await fetchUrl(`https://www.instagram.com/${encodeURIComponent(username)}/`)
  if (status === 404) throw new Error('Profile not found')
  if (status !== 200) throw new Error(`Instagram returned HTTP ${status}`)

  const data = extractOgMeta(body)
  if (!data.picUrl) throw new Error('Could not extract profile picture')
  return data
}

function proxyImage(url, res, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
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
      if ([301, 302, 303, 307, 308].includes(imgRes.statusCode) && imgRes.headers.location) {
        imgRes.resume()
        return proxyImage(imgRes.headers.location, res, redirectsLeft - 1).then(resolve).catch(reject)
      }
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

function svgFallback(username) {
  const initials = username.slice(0, 2).toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="64" x2="64" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f09433"/>
      <stop offset="50%" stop-color="#dc2743"/>
      <stop offset="100%" stop-color="#bc1888"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="32" fill="url(#g)"/>
  <text x="32" y="38" font-family="Arial,sans-serif" font-size="22" font-weight="bold"
        fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text>
</svg>`
}

// GET /api/instagram-proxy/avatar/:username — proxies profile pic as image
router.get('/avatar/:username', async (req, res) => {
  const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase()
  if (!username || !/^[\w.]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' })
  }

  const sendFallback = () => {
    if (res.headersSent) return
    res.setHeader('Content-Type', 'image/svg+xml')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(svgFallback(username))
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

    if (!picUrl) return sendFallback()
    await proxyImage(picUrl, res)
  } catch (err) {
    console.error('[instagram-proxy] avatar error:', err.message)
    sendFallback()
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

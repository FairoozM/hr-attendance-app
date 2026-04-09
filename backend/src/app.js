const express = require('express')
const cors = require('cors')
const apiRoutes = require('./routes')

const app = express()

app.disable('x-powered-by')

app.use(cors())
app.use(express.json({ limit: '10mb' }))

/**
 * This process serves **only** JSON APIs — no express.static, no SPA, no index.html.
 * Order:
 * 1. /api → main API router (includes POST /api/auth/login, GET /api/health, …)
 * 2. /api → JSON 404 if nothing responded (belt-and-suspenders; router already ends all /api/*)
 * 3. Non-/api paths → JSON 404
 * 4. Error handler → always JSON
 */
app.use('/api', apiRoutes)

app.use('/api', (req, res) => {
  if (res.headersSent) return
  res.status(404).json({ error: 'API route not found' })
})

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message || 'Upload failed' })
  }
  console.error('[express] Unhandled error:', err)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = app

const express = require('express')
const cors = require('cors')
const apiRoutes = require('./routes')

const app = express()

app.disable('x-powered-by')

app.use(cors())
app.use(express.json({ limit: '10mb' }))

/**
 * Route order (this process is API-only; it does not serve static files or index.html):
 * 1. /api/* → api router (health, auth without global auth, then protected resources)
 * 2. Unknown /api/* → JSON 404 inside api/routes/index.js
 * 3. Any other path → JSON 404 below (never HTML)
 */
app.use('/api', apiRoutes)

// Non-API paths hit this server directly — respond with JSON, not an SPA
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// All errors → JSON (never Express HTML error pages)
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message || 'Upload failed' })
  }
  console.error('[express] Unhandled error:', err)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = app

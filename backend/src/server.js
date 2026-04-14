require('dotenv').config()
const http = require('http')
const { Server } = require('socket.io')
const app = require('./app')
const { testConnection } = require('./db')

const PORT = process.env.PORT || 5001

const server = http.createServer(app)
const io = new Server(server, {
  path: '/api/socket.io',
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
})

app.set('io', io)

async function startServer() {
  console.log('[boot] Running database migrations / health checks before accepting traffic…')
  try {
    await testConnection()
    console.log('[boot] Database ready.')
  } catch (err) {
    console.error('Database startup failed:', err.message)
    if (err.stack) console.error(err.stack)
  }

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
    console.log(
      '[routes] Express: GET /api, GET /api/health, POST/GET /api/auth/login, GET /api/auth/me, resource routers, /api 404 JSON'
    )
    console.log(
      process.env.FRONTEND_DIST
        ? `[routes] FRONTEND_DIST=${process.env.FRONTEND_DIST} — static + SPA catch-all enabled`
        : '[routes] No FRONTEND_DIST — API-only; SPA hosted on S3/CloudFront'
    )
    console.log('[routes] GET  /api                    → { status, service }')
    console.log('[routes] GET  /api/health')
    console.log('[routes] Auth router at /api/auth:')
    console.log('[routes]   GET  /api/auth/login      → 405 JSON (use POST to sign in)')
    console.log('[routes]   POST /api/auth/login      → { token, user }')
    console.log('[routes]   GET  /api/auth/me         → { user } (Bearer token)')
    console.log('[routes] … /api/employees, /api/attendance, /api/annual-leave (auth as required)')
  })
}

startServer()

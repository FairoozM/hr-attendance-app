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

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log('[routes] API mounted at /api — JSON only; no static/SPA fallback in this process')
  console.log('[routes] GET  /api                    → { status, service }')
  console.log('[routes] GET  /api/health')
  console.log('[routes] Auth router at /api/auth:')
  console.log('[routes]   GET  /api/auth/login      → 405 JSON (use POST to sign in)')
  console.log('[routes]   POST /api/auth/login      → { token, user }')
  console.log('[routes]   GET  /api/auth/me         → { user } (Bearer token)')
  console.log('[routes] … /api/employees, /api/attendance, /api/annual-leave (auth as required)')
  try {
    await testConnection()
  } catch (err) {
    console.error('Database startup failed:', err.message)
    if (err.stack) console.error(err.stack)
  }
})

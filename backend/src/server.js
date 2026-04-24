require('dotenv').config()
const http = require('http')
const { Server } = require('socket.io')
const app = require('./app')
const { testConnection } = require('./db')
const { getOptionalFlagDecision } = require('./services/weeklyReportReportVendor')
const { readZohoConfig } = require('./integrations/zoho/zohoConfig')

{
  const zc = readZohoConfig()
  if (zc.code === 'ok') {
    const id = zc.clientId
    console.log('[zoho-config] clientId suffix:', id.length >= 4 ? id.slice(-4) : id)
    console.log('[zoho-config] clientSecret length:', zc.clientSecret.length)
  } else {
    console.warn('[zoho-config] not configured — missing:', zc.missing.join(', '))
  }
}

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
    // Do not accept traffic with a half-migrated schema (e.g. annual_leave SELECTs would 500).
    process.exit(1)
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

    const opt = getOptionalFlagDecision()
    if (opt.effective) {
      console.warn(
        `[weeklyReports] WEEKLY_REPORT_VENDOR_OPTIONAL=1 is ACTIVE (NODE_ENV=${process.env.NODE_ENV || 'development'}). ` +
          'Reports will run without REPORT_VENDOR_ID; purchases and returned_to_wholesale will be 0.'
      )
    } else if (opt.suppressedInProd) {
      console.warn(
        '[weeklyReports] WEEKLY_REPORT_VENDOR_OPTIONAL=1 is set but IGNORED because NODE_ENV=production. ' +
          'Set WEEKLY_REPORT_VENDOR_OPTIONAL_ALLOW_PROD=1 to opt-in for production explicitly.'
      )
    }
  })
}

startServer()

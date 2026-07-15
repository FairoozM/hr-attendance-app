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
    if (!process.env.ZOHO_REDIRECT_URI) {
      console.warn(
        `[zoho-config] ZOHO_REDIRECT_URI is not set; OAuth helper will use inferred callback ${zc.redirectUri}. ` +
          'Register this exact URI in Zoho API Console or set ZOHO_REDIRECT_URI explicitly.'
      )
    } else {
      console.log('[zoho-config] redirectUri configured:', zc.redirectUri)
    }
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

    if (/^(1|true|yes)$/i.test(String(process.env.ZOHO_AUTO_SYNC_ON_START || ''))) {
      console.log('[zoho] ZOHO_AUTO_SYNC_ON_START=1 — background items refresh scheduled')
      setImmediate(() => {
        const { fetchAllItemsRaw } = require('./integrations/zoho/zohoAdapter')
        fetchAllItemsRaw().catch((err) => {
          console.error('[zoho] ZOHO_AUTO_SYNC_ON_START fetch failed:', err.message || err)
        })
      })
    }
  } catch (err) {
    console.error('Database startup failed:', err.message)
    if (err.stack) console.error(err.stack)
    // Do not accept traffic with a half-migrated schema (e.g. annual_leave SELECTs would 500).
    process.exit(1)
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${PORT} is already in use — stop the other process or pick a different PORT.\n` +
          `  See what holds it:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
          `  Then stop it:        kill <PID>   (or kill -9 <PID> if it ignores SIGTERM)`
      )
      process.exit(1)
      return
    }
    console.error('[server] HTTP server error:', err)
    process.exit(1)
  })

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

    if (!/^(0|false|no)$/i.test(String(process.env.INVENTORY_HEALTH_WARM_ON_START || '1'))) {
      setImmediate(() => {
        try {
          const { readDiskCacheEntry } = require('./services/inventoryHealthDiskCache')
          const { loadInventoryHealthBase, cacheKeyForBase } = require('./services/inventoryHealthService')
          const warmKey = cacheKeyForBase(null)
          const freshDisk = readDiskCacheEntry(warmKey)
          if (freshDisk) {
            console.log('[inventory-health] disk cache present — skip startup warm')
            return
          }
          const staleDisk = readDiskCacheEntry(warmKey, { allowStale: true })
          if (staleDisk) {
            console.log('[inventory-health] expired disk cache present — background refresh on start')
          } else {
            console.log('[inventory-health] warming Zoho dashboard cache in background…')
          }
          // refresh:true when stale so we actually rebuild; false when empty (same path).
          loadInventoryHealthBase({ refresh: Boolean(staleDisk) })
            .then((payload) => {
              const n = payload?.debug?.activeItemsFetched ?? payload?.rows?.length ?? '?'
              console.log(`[inventory-health] startup warm complete (${n} active items)`)
            })
            .catch((err) => {
              console.warn('[inventory-health] startup warm failed:', err?.message || err)
            })
        } catch (err) {
          console.warn('[inventory-health] startup warm setup failed:', err?.message || err)
        }
      })
    }

    const MS_PER_DAY = 24 * 60 * 60 * 1000
    setImmediate(() => {
      const { syncSubscriptionNotifications } = require('./services/subscriptionNotificationsService')
      syncSubscriptionNotifications().catch((err) => {
        console.warn('[subscriptions] initial notification sync failed:', err?.message || err)
      })
      setInterval(() => {
        syncSubscriptionNotifications().catch((err) => {
          console.warn('[subscriptions] daily notification sync failed:', err?.message || err)
        })
      }, MS_PER_DAY)
    })

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

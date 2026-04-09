const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const authMiddleware = require('./middleware/auth')
const authRouter = require('./routes/auth')
const adminRouter = require('./routes/admin')
const profileRouter = require('./routes/profile')
const employeesRoutes = require('./routes/employees')
const attendanceRoutes = require('./routes/attendance')
const annualLeaveRoutes = require('./routes/annualLeave')

const app = express()

app.disable('x-powered-by')

// Handle CORS preflight for every route before anything else
app.options('*', cors())
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// --- API routes (order matters: specific before catch-all) ---

app.get('/api', (_req, res) => {
  res.json({ status: 'ok', service: 'hr-api' })
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Auth router — POST /api/auth/login, GET /api/auth/login (405), GET /api/auth/me, POST /api/auth/change-password
app.use('/api/auth', authRouter)

// Admin user management (list users, reset passwords)
app.use('/api/admin', authMiddleware.attachAuth, adminRouter)

// Employee self-service profile
app.use('/api/profile', authMiddleware.attachAuth, profileRouter)

// Resource routers (attachAuth decodes token if present; individual handlers call requireAuth/requireAdmin)
app.use('/api/employees', authMiddleware.attachAuth, employeesRoutes)
app.use('/api/attendance', authMiddleware.attachAuth, attendanceRoutes)
app.use('/api/annual-leave', authMiddleware.attachAuth, annualLeaveRoutes)

// Catch-all for unmatched /api/* — always JSON, never HTML
app.use('/api', (_req, res) => {
  if (res.headersSent) return
  res.status(404).json({ error: 'API route not found' })
})

// --- Optional static + SPA (production uses S3/CloudFront; enable with FRONTEND_DIST) ---
const frontendDist = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : ''
if (frontendDist && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => (err ? next(err) : undefined))
  })
} else {
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
}

// Global error handler — always returns JSON
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

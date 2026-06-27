const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const userPreferencesRoutes = require('./routes/userPreferences')
const authMiddleware = require('./middleware/auth')
const authRouter = require('./routes/auth')
const adminRouter = require('./routes/admin')
const profileRouter = require('./routes/profile')
const employeesRoutes = require('./routes/employees')
const attendanceRoutes = require('./routes/attendance')
const annualLeaveRoutes = require('./routes/annualLeave')
const annualLeaveSalaryRoutes = require('./routes/annualLeaveSalary')
const notificationsRoutes = require('./routes/notifications')
const influencersRoutes = require('./routes/influencers')
const simCardsRoutes = require('./routes/simCards')
const documentExpiryRoutes = require('./routes/documentExpiry')
const projectsRoutes      = require('./routes/projects')
const teamRoutes          = require('./routes/team')
const weeklyReportsRoutes = require('./routes/weeklyReports')
const itemReportGroupsRoutes = require('./routes/itemReportGroups')
const taxationRoutes = require('./routes/taxation')
const debugRoutes = require('./routes/debug')
const zohoRoutes = require('./routes/zoho')
const purchasePlanningRoutes = require('./routes/purchasePlanning')
const pricesCompositeRoutes = require('./routes/pricesComposite')
const aiRoutes = require('./routes/ai.routes')
const amazonListingRoutes = require('./routes/amazonListing.routes')
const listingBatchesRoutes = require('./routes/listingBatches.routes')
const inventoryRoutes = require('./routes/inventory.routes')
const noonRoutes = require('./routes/noonRoutes')
const skuChannelCoverageRoutes = require('./routes/skuChannelCoverage.routes')
const amazonReturnReconciliationRoutes = require('./routes/amazonReturnReconciliation.routes')
const nutritionCoachRoutes = require('./routes/nutritionCoach')

const app = express()

app.disable('x-powered-by')

// CORS: allow credentials for httpOnly auth cookie + fetch(..., { credentials: 'include' })
const corsOpts = { origin: true, credentials: true }
app.options('*', cors(corsOpts))
app.use(cors(corsOpts))

// --- Public (no authMiddleware) — before express.json so a parse edge case on GET cannot affect health
// 403/500 from the browser for GET /api/health is often the edge (CloudFront → S3) or Vite proxy, not this route. ---

app.get('/api', (_req, res) => {
  res.type('application/json')
  res.json({ status: 'ok', service: 'hr-api' })
})

app.get('/api/health', (_req, res) => {
  res.type('application/json')
  res.json({ status: 'ok' })
})

const inventoryItemImageStorage = require('./services/inventoryItemImageStorage')
inventoryItemImageStorage.ensureUploadDir()
app.use(
  '/uploads/inventory-item-images',
  express.static(inventoryItemImageStorage.UPLOAD_ROOT, {
    maxAge: '365d',
    immutable: true,
  }),
)

// ── Integration webhooks — mounted BEFORE express.json() so the GitHub route
//    can capture the raw body Buffer needed for HMAC SHA-256 verification.
//    The route itself applies express.raw({ type: 'application/json' }) locally.
const integrationsRoutes = require('./routes/integrations')
app.use('/api/integrations', integrationsRoutes)

app.use(express.json({ limit: '50mb' }))

// Auth router — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me, …
app.use('/api/auth', authRouter)

app.use('/api/public/amazon-return-reconciliation', amazonReturnReconciliationRoutes.publicRouter)

app.use('/api/user-preferences', authMiddleware.attachAuth, userPreferencesRoutes)

// Admin user management (list users, reset passwords)
app.use('/api/admin', authMiddleware.attachAuth, adminRouter)

// Employee self-service profile
app.use('/api/profile', authMiddleware.attachAuth, profileRouter)

// Resource routers (attachAuth decodes token if present; individual handlers call requireAuth/requireAdmin)
app.use('/api/employees', authMiddleware.attachAuth, employeesRoutes)
app.use('/api/attendance', authMiddleware.attachAuth, attendanceRoutes)
app.use('/api/annual-leave', authMiddleware.attachAuth, annualLeaveRoutes)
app.use('/api/annual-leave-salary', authMiddleware.attachAuth, annualLeaveSalaryRoutes)
app.use('/api/notifications', authMiddleware.attachAuth, notificationsRoutes)
app.use('/api/influencers', influencersRoutes)
app.use('/api/sim-cards', authMiddleware.attachAuth, simCardsRoutes)
app.use('/api/document-expiry', authMiddleware.attachAuth, documentExpiryRoutes)
app.use('/api/projects',       authMiddleware.attachAuth, projectsRoutes)
app.use('/api/team',           authMiddleware.attachAuth, teamRoutes)
app.use('/api/weekly-reports', authMiddleware.attachAuth, weeklyReportsRoutes)
app.use('/api/item-report-groups', authMiddleware.attachAuth, itemReportGroupsRoutes)
app.use('/api/taxation', authMiddleware.attachAuth, taxationRoutes)
app.use('/api/zoho', authMiddleware.attachAuth, zohoRoutes)
app.use('/api/purchase-planning', authMiddleware.attachAuth, purchasePlanningRoutes)
app.use('/api/prices', authMiddleware.attachAuth, pricesCompositeRoutes)
app.use('/api/ai', authMiddleware.attachAuth, aiRoutes)
app.use('/api/amazon', authMiddleware.attachAuth, amazonListingRoutes)
app.use('/api/noon', authMiddleware.attachAuth, noonRoutes)
app.use('/api/inventory', authMiddleware.attachAuth, inventoryRoutes)
app.use('/api/sku-coverage', authMiddleware.attachAuth, skuChannelCoverageRoutes)
app.use('/api/listings', authMiddleware.attachAuth, listingBatchesRoutes)
app.use('/api/amazon-return-reconciliation', authMiddleware.attachAuth, amazonReturnReconciliationRoutes.adminRouter)
app.use('/api/nutrition-coach', nutritionCoachRoutes)
// TEMPORARY — Zoho debug (remove when stable)
app.use('/api/debug', authMiddleware.attachAuth, debugRoutes)

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

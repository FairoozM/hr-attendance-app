#!/usr/bin/env node
/**
 * Static safety checks for Amazon SP-API integration (no network, no secret printing).
 */
const fs = require('fs')
const path = require('path')

const backendRoot = path.join(__dirname, '..')
const repoRoot = path.join(backendRoot, '..')
const warnings = []

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8')
}

function exists(p) {
  return fs.existsSync(p)
}

function rel(from, p) {
  return path.relative(from, p)
}

// --- .gitignore ---
const gitignorePath = path.join(repoRoot, '.gitignore')
if (!exists(gitignorePath)) {
  warnings.push('Missing root .gitignore')
} else {
  const gi = readUtf8(gitignorePath)
  const lines = gi.split(/\r?\n/).map((l) => l.trim())
  const need = ['.env', 'backend/.env', '.env.local', 'backend/.env.local']
  for (const n of need) {
    if (!lines.includes(n)) warnings.push(`.gitignore should list "${n}" (exact line) to avoid committing secrets`)
  }
}

// --- Obvious token-like literals in backend JS (not env var names) ---
const suspiciousRes = [
  { label: 'LWA access token shape (Atza|)', re: /Atza\|/ },
  { label: 'LWA refresh token shape (Atzr|)', re: /Atzr\|/ },
  { label: 'SP-API solution id prefix', re: /amzn1\.sp\.solution\./ },
]

function walkSourceFiles(dir, extensions, out) {
  if (!exists(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue
      walkSourceFiles(full, extensions, out)
    } else if (ent.isFile()) {
      const ok = extensions.some((ext) => ent.name.endsWith(ext))
      if (ok) out.push(full)
    }
  }
}

const jsFiles = []
walkSourceFiles(path.join(backendRoot, 'src'), ['.js'], jsFiles)
walkSourceFiles(path.join(backendRoot, 'scripts'), ['.js'], jsFiles)
for (const file of jsFiles) {
  if (path.basename(file) === 'audit-amazon-spapi-safety.js') continue
  const text = readUtf8(file)
  for (const { label, re } of suspiciousRes) {
    if (re.test(text)) {
      warnings.push(`Possible hardcoded Amazon credential/token (${label}) in ${rel(backendRoot, file)}`)
    }
  }
}

// --- Guardrails + request-id plumbing ---
const guardrailsPath = path.join(backendRoot, 'src/config/amazonSpApiGuardrails.js')
if (!exists(guardrailsPath)) warnings.push('Missing src/config/amazonSpApiGuardrails.js')

const versionsPath = path.join(backendRoot, 'src/config/amazonSpApiVersions.js')
if (!exists(versionsPath)) warnings.push('Missing src/config/amazonSpApiVersions.js')

const spPath = path.join(backendRoot, 'src/services/amazonSpApiService.js')
if (!exists(spPath)) {
  warnings.push('Missing src/services/amazonSpApiService.js')
} else {
  const sp = readUtf8(spPath)
  if (!sp.includes('pickAmazonRequestId')) {
    warnings.push('amazonSpApiService.js should define pickAmazonRequestId')
  }
  if (!sp.includes('amazonRequestId')) {
    warnings.push('amazonSpApiService.js should propagate amazonRequestId on SP-API responses')
  }
}

const cachePath = path.join(backendRoot, 'src/services/amazonOrdersCacheStore.js')
if (exists(cachePath)) {
  const c = readUtf8(cachePath)
  if (!c.includes('amazon_request_id')) {
    warnings.push('amazonOrdersCacheStore.js should persist amazon_request_id on API call log rows')
  }
}

// --- Event-driven readiness (docs + placeholder; not wired to runtime) ---
const archDocPath = path.join(backendRoot, 'docs/amazon-spapi-architecture.md')
if (!exists(archDocPath)) {
  warnings.push('Missing backend/docs/amazon-spapi-architecture.md (event-driven / architecture doc)')
}

const notificationIngestionPath = path.join(backendRoot, 'src/services/amazonNotificationIngestionService.js')
if (!exists(notificationIngestionPath)) {
  warnings.push('Missing src/services/amazonNotificationIngestionService.js (notification placeholder)')
} else {
  const ing = readUtf8(notificationIngestionPath)
  if (!ing.includes('module.exports')) {
    warnings.push('amazonNotificationIngestionService.js should export handlers via module.exports')
  }
  for (const fn of [
    'handleAmazonNotificationMessage',
    'processAmazonOrderChangeNotification',
    'processAmazonInventoryChangeNotification',
  ]) {
    if (!ing.includes(fn)) {
      warnings.push(`amazonNotificationIngestionService.js should define ${fn}`)
    }
  }
}

// --- Frontend: no direct SP-API host strings; orders/dashboard use backend routes ---
const feSrc = path.join(repoRoot, 'src')
if (exists(feSrc)) {
  const feFiles = []
  walkSourceFiles(feSrc, ['.jsx', '.tsx', '.js', '.ts'], feFiles)
  for (const file of feFiles) {
    const text = readUtf8(file)
    if (/sellingpartnerapi[-a-z0-9.]*\.(amazonaws\.com|amazon\.com)/i.test(text)) {
      warnings.push(`Frontend may reference Amazon SP-API URL — use backend proxy only: ${rel(repoRoot, file)}`)
    }
    if (/\bamazonSpApiService\b/.test(text)) {
      warnings.push(
        `Frontend should not reference backend amazonSpApiService — Amazon calls must stay server-only: ${rel(repoRoot, file)}`
      )
    }
  }
}

const ordersPage = path.join(repoRoot, 'src/pages/AmazonOrdersPage.jsx')
if (!exists(ordersPage)) {
  warnings.push('Missing src/pages/AmazonOrdersPage.jsx')
} else {
  const t = readUtf8(ordersPage)
  if (!t.includes('/api/amazon/orders')) warnings.push('AmazonOrdersPage should load orders via GET /api/amazon/orders')
  if (!t.includes('/api/amazon/sync/status')) warnings.push('AmazonOrdersPage should read sync status via GET /api/amazon/sync/status')
}

const dashPage = path.join(repoRoot, 'src/pages/AmazonOrdersDashboardPage.jsx')
if (!exists(dashPage)) {
  warnings.push('Missing src/pages/AmazonOrdersDashboardPage.jsx')
} else {
  const t = readUtf8(dashPage)
  if (!t.includes('/api/amazon/dashboard/orders')) {
    warnings.push('AmazonOrdersDashboardPage should load BI via GET /api/amazon/dashboard/orders')
  }
}

if (warnings.length) {
  console.error('Amazon SP-API safety audit — issues:')
  for (const w of warnings) console.error(` - ${w}`)
  process.exit(1)
}
console.log('SUCCESS: Amazon SP-API safety audit passed')

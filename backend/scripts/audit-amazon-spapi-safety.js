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
walkSourceFiles(path.join(backendRoot, 'src'), ['.js', '.ts'], jsFiles)
walkSourceFiles(path.join(backendRoot, 'scripts'), ['.js', '.ts'], jsFiles)
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

// --- Amazon Control Tower: read-only toward Amazon and Zoho ---
// Only these external functions may be wired in; every one is a GET or the existing report creation.
const controlTowerAllowedCalls = {
  spApi: [
    'getAmazonFbaInventorySummaries',
    'throwAmazonSpApiIfFailed',
    'marketplaceIdForKey',
    'createAmazonReport',
    'getAmazonReport',
    'listAmazonReports',
    'getAmazonReportDocument',
    'downloadAmazonReportDocument',
  ],
  listingsService: ['fetchActiveAmazonListings', 'parseDelimitedReport'],
  orderReport: ['syncAmazonOrderReport', 'findSuccessfulReportRunCoveringRange'],
  warehouseService: ['resolveLifeSmileWarehouse'],
  zohoAdapter: ['fetchItemsRawForWarehouse'],
}
const controlTowerAllowedRequires = new Set([
  '../amazonSpApiService',
  '../amazonListingsInventoryReadService',
  '../amazonOrderReportSyncService',
  '../zohoLifeSmileWarehouseService',
  '../../integrations/zoho/zohoAdapter',
  '../../db',
  '../../utils/normalizeSku',
  '../../utils/purchasePlanningSkuMatcher',
  '../../config/amazonSpApiGuardrails',
  '../middleware/auth',
  'express',
  'crypto',
  'os',
])
/** Report types Control Tower may request: every one is a read-only data export. */
const controlTowerReadOnlyReportTypes = new Set([
  'GET_MERCHANT_LISTINGS_DATA',
  'GET_MERCHANT_LISTINGS_ALL_DATA',
  'GET_MERCHANTS_LISTINGS_FYP_REPORT',
  'GET_FBA_INVENTORY_PLANNING_DATA',
  'GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA',
  'GET_FBA_MYI_ALL_INVENTORY_DATA',
  'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA',
  'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
])
const controlTowerFiles = []
walkSourceFiles(path.join(backendRoot, 'src/services/amazonControlTower'), ['.ts', '.js'], controlTowerFiles)
for (const extra of ['src/controllers/amazonControlTowerController.ts', 'src/routes/amazonControlTower.routes.ts']) {
  const p = path.join(backendRoot, extra)
  if (exists(p)) controlTowerFiles.push(p)
  else warnings.push(`Missing ${extra}`)
}
if (!controlTowerFiles.length) warnings.push('Missing src/services/amazonControlTower')
for (const file of controlTowerFiles) {
  const text = readUtf8(file)
  const name = rel(backendRoot, file)
  for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    if (spec.startsWith('./') || spec.startsWith('../services/amazonControlTower/')) continue
    if (spec === '../controllers/amazonControlTowerController.ts') continue
    if (!controlTowerAllowedRequires.has(spec)) warnings.push(`Control Tower ${name} requires unapproved module "${spec}"`)
  }
  for (const m of text.matchAll(/\b(spApi|listingsService|orderReport|warehouseService|zohoAdapter)\.(\w+)/g)) {
    if (!controlTowerAllowedCalls[m[1]].includes(m[2])) warnings.push(`Control Tower ${name} uses non-allowlisted ${m[1]}.${m[2]}`)
  }
  if (/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i.test(text)) {
    warnings.push(`Control Tower ${name} declares a mutating HTTP method — Control Tower must not call Amazon/Zoho directly`)
  }
  if (/\b(fetch|axios|https?\.request)\s*\(/.test(text)) {
    warnings.push(`Control Tower ${name} makes a raw HTTP call — go through the existing read services`)
  }
  if (/createInboundShipment|createFulfillmentOrder|submitFeed|createFeed|putListingsItem|patchListingsItem|deleteListingsItem|createRemoval|updatePrice|sponsoredProducts/i.test(text)) {
    warnings.push(`Control Tower ${name} references an Amazon mutation API`)
  }
  if (/paymentClearing|PaymentClearing|zohoBooksWrite|createPurchaseOrder|createJournal|createCustomerPayment|createInvoice/.test(text)) {
    warnings.push(`Control Tower ${name} references Zoho write code`)
  }
  for (const m of text.matchAll(/\b(GET_[A-Z0-9_]+)\b/g)) {
    if (!controlTowerReadOnlyReportTypes.has(m[1])) warnings.push(`Control Tower ${name} references report type ${m[1]} that is not on the read-only report allowlist`)
  }
  if (/\brouter\.delete\s*\(/.test(text)) {
    warnings.push(`Control Tower ${name} exposes a DELETE route — Control Tower data (listings, history, capacity periods) is never deleted`)
  }
  if (/DELETE\s+FROM\s+amazon_sku_master\b|DELETE\s+FROM\s+amazon_listing_status_history\b/i.test(text)) {
    warnings.push(`Control Tower ${name} deletes SKU master / listing status history rows — inactive listings and their history must be kept`)
  }
}

// Capacity / inventory-health / removals persistence is append-or-upsert only.
for (const relPath of [
  'src/services/amazonControlTower/capacityHealthStore.ts',
  'migrations/062_amazon_control_tower_capacity_health.sql',
]) {
  const p = path.join(backendRoot, relPath)
  if (!exists(p)) {
    warnings.push(`Missing ${relPath}`)
    continue
  }
  if (/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT))\b/i.test(readUtf8(p))) {
    warnings.push(`${relPath} contains DELETE/TRUNCATE/DROP — capacity history, removals and listing history must never be deleted`)
  }
}
const ctSchemaPath = path.join(backendRoot, 'src/services/amazonControlTower/controlTowerSchema.ts')
if (exists(ctSchemaPath)) {
  const schemaText = readUtf8(ctSchemaPath)
  const healthDdl = schemaText.slice(schemaText.indexOf('CAPACITY_HEALTH_DDL'))
  if (/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX))\b/i.test(healthDdl)) {
    warnings.push('CAPACITY_HEALTH_DDL contains DELETE/TRUNCATE/DROP')
  }
}
const spForCt = exists(spPath) ? readUtf8(spPath) : ''
const spMutations = [...spForCt.matchAll(/method:\s*'(POST|PUT|PATCH|DELETE)'/g)].length
const spReportCreates = [...spForCt.matchAll(/callAmazonSpApi\(REPORTS_2021_PATH,\s*\{[^}]*?method:\s*'POST'/g)].length
if (spMutations > spReportCreates) {
  warnings.push(
    `amazonSpApiService.js has ${spMutations} mutating requests but only ${spReportCreates} are report creation — review new Amazon write paths`
  )
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

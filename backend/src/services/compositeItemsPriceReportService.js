const { query, pool } = require('../db')
const {
  fetchCompositeItemsList,
  fetchCompositeItemDetail,
} = require('../integrations/zoho/zohoInventoryClient')
const { resolveComponentsFromMappedItems } = require('./compositeItemsZohoLookup')
const {
  DEFAULT_RATES,
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeBundleEconomics,
  computeAllPricesRowEconomics,
} = require('./compositePricingLogic')

const PREF_ALL_PRICES_EC = 'all_prices_ecommerce_v1'
const DEFAULT_PER_PAGE = 200
const MAX_COMPOSITE_PAGES = 50
const REPORT_COMPOSITE_FILTER_BY = 'Status.Active'

function parseEnvInt(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(String(raw).trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

/** Parallel composite detail + pricing (each composite still does bounded component fetches). */
const DETAIL_CONCURRENCY = parseEnvInt('COMPOSITE_REPORT_DETAIL_CONCURRENCY', 8)
/** Parallel GET /items/{id} while resolving BOM lines (shared cache across the run). */
const ITEM_FETCH_CONCURRENCY = parseEnvInt('COMPOSITE_REPORT_ITEM_FETCH_CONCURRENCY', 12)
/** DB progress flush interval (one transaction per batch). */
const PROGRESS_BATCH_SIZE = parseEnvInt('COMPOSITE_REPORT_PROGRESS_BATCH_SIZE', 10)
/** Mark stuck `running` reports failed so a new generation can start. */
const STALE_RUNNING_MS = parseEnvInt('COMPOSITE_REPORT_STALE_RUNNING_MS', 2 * 60 * 60 * 1000)

let generationRunning = false

async function promiseConcurrent(tasks, limit) {
  if (!tasks.length) return []
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next
      next += 1
      // eslint-disable-next-line no-await-in-loop
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

function nowIso() {
  return new Date().toISOString()
}

function safeJson(value) {
  return JSON.stringify(value == null ? null : value)
}

function normalizeCompositeRow(raw) {
  const id = raw?.composite_item_id ?? raw?.item_id ?? raw?.id
  return {
    composite_item_id: id != null ? String(id) : '',
    item_id: raw?.item_id != null ? String(raw.item_id) : '',
    sku: raw?.sku != null ? String(raw.sku) : '',
    name: raw?.name != null ? String(raw.name) : raw?.item_name != null ? String(raw.item_name) : '',
    family: raw?.category_name || raw?.category || raw?.product_type || raw?.item_type || raw?.group_name || '',
    status: raw?.status != null ? String(raw.status) : '',
    created_time: raw?.created_time || raw?.created_at || null,
    last_modified_time: raw?.last_modified_time || raw?.updated_time || raw?.updated_at || null,
  }
}

function sortCompositesByNameDesc(composites) {
  return [...(Array.isArray(composites) ? composites : [])].sort((a, b) =>
    String(b.name || '').localeCompare(String(a.name || ''))
  )
}

async function failStaleRunningReports() {
  const staleSec = Math.max(120, Math.floor(STALE_RUNNING_MS / 1000))
  const r = await query(
    `UPDATE composite_price_reports
     SET status = 'failed',
         error_message = 'Report generation timed out or was interrupted. Start a new full report.',
         zoho_sync_completed_at = COALESCE(zoho_sync_completed_at, NOW()),
         updated_at = NOW()
     WHERE status = 'running'
       AND updated_at < NOW() - ($1::int * INTERVAL '1 second')
     RETURNING id`,
    [staleSec]
  )
  if (r.rows.length > 0) {
    console.warn(
      '[composite-price-report] marked stale running reports as failed:',
      r.rows.map((row) => row.id)
    )
    generationRunning = false
  }
}

async function getRunningReportId() {
  const r = await query(
    `SELECT id FROM composite_price_reports WHERE status = 'running' ORDER BY id DESC LIMIT 1`
  )
  return r.rows[0]?.id ?? null
}

async function ensureCompositeItemsPriceReportTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS composite_price_reports (
      id SERIAL PRIMARY KEY,
      report_name TEXT NOT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'incremental',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      zoho_sync_started_at TIMESTAMPTZ,
      zoho_sync_completed_at TIMESTAMPTZ,
      total_composites_seen INTEGER NOT NULL DEFAULT 0,
      total_new_composites_processed INTEGER NOT NULL DEFAULT 0,
      total_complete INTEGER NOT NULL DEFAULT 0,
      total_incomplete INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'running',
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS composite_price_report_items (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES composite_price_reports(id) ON DELETE CASCADE,
      composite_item_id TEXT NOT NULL,
      sku TEXT,
      name TEXT,
      sales_price NUMERIC,
      vat_5_percent NUMERIC,
      commission_15_percent NUMERIC,
      advertising_15_percent NUMERIC,
      shipping NUMERIC,
      purchase_price NUMERIC,
      total_cost NUMERIC,
      profit NUMERIC,
      profit_percent_of_sales NUMERIC,
      pricing_status VARCHAR(32) NOT NULL DEFAULT 'incomplete',
      unmatched_components_count INTEGER NOT NULL DEFAULT 0,
      created_time TIMESTAMPTZ,
      last_modified_time TIMESTAMPTZ,
      components_json JSONB NOT NULL DEFAULT '[]',
      raw_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS composite_price_report_sync_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_successful_report_id INTEGER REFERENCES composite_price_reports(id) ON DELETE SET NULL,
      last_successful_sync_at TIMESTAMPTZ,
      last_seen_composite_created_time TIMESTAMPTZ,
      last_seen_composite_modified_time TIMESTAMPTZ,
      known_composite_ids_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS composite_parent_prices (
      id SERIAL PRIMARY KEY,
      composite_item_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      name TEXT,
      family TEXT,
      report_item_id INTEGER REFERENCES composite_price_report_items(id) ON DELETE SET NULL,
      purchase_price NUMERIC,
      manual_shipping NUMERIC NOT NULL,
      suggested_sales_price NUMERIC,
      vat_5_percent NUMERIC,
      commission_15_percent NUMERIC,
      advertising_15_percent NUMERIC,
      total_cost NUMERIC,
      profit NUMERIC,
      profit_percent_of_sales NUMERIC,
      pricing_status VARCHAR(32) NOT NULL DEFAULT 'complete',
      date_of_price DATE,
      components_json JSONB NOT NULL DEFAULT '[]',
      raw_json JSONB NOT NULL DEFAULT '{}',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (composite_item_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_reports_generated ON composite_price_reports(generated_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_report_items_report ON composite_price_report_items(report_id, name DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_report_items_composite ON composite_price_report_items(composite_item_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_parent_prices_sku ON composite_parent_prices(sku)`)
}

async function fetchAllCompositeItems() {
  const all = []
  for (let page = 1; page <= MAX_COMPOSITE_PAGES; page += 1) {
    const json = await fetchCompositeItemsList({
      page,
      per_page: DEFAULT_PER_PAGE,
      filter_by: REPORT_COMPOSITE_FILTER_BY,
    }, {
      source: 'composite_price_report_list',
    })
    const rows = Array.isArray(json?.composite_items) ? json.composite_items : []
    all.push(...rows.map(normalizeCompositeRow).filter((r) => r.composite_item_id))
    const hasMore = json?.page_context?.has_more_page === true
    if (!hasMore || rows.length === 0 || rows.length < DEFAULT_PER_PAGE) {
      return sortCompositesByNameDesc(all)
    }
  }
  const err = new Error(`Zoho composite item pagination exceeded ${MAX_COMPOSITE_PAGES} pages.`)
  err.code = 'ZOHO_COMPOSITE_PAGINATION_LIMIT'
  throw err
}

async function loadAllPricesBundle(userId) {
  const uid = Number.isFinite(Number(userId)) ? Number(userId) : null
  const r = uid
    ? await query(
      `SELECT pref_value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
      [uid, PREF_ALL_PRICES_EC]
    )
    : await query(
      `SELECT pref_value FROM user_preferences WHERE pref_key = $1 ORDER BY updated_at DESC LIMIT 1`,
      [PREF_ALL_PRICES_EC]
    )
  const bundle = r.rows[0]?.pref_value
  const rows = Array.isArray(bundle?.rows) ? bundle.rows : []
  if (!rows.length) {
    const err = new Error('All Prices list is empty. Add purchase prices before generating this report.')
    err.code = 'ALL_PRICES_MISSING'
    throw err
  }
  const rates = bundle?.rates && typeof bundle.rates === 'object' ? { ...DEFAULT_RATES, ...bundle.rates } : { ...DEFAULT_RATES }
  return { rows, rates }
}

async function getSyncState() {
  const r = await query(`SELECT * FROM composite_price_report_sync_state WHERE id = 1`)
  const row = r.rows[0]
  if (!row) return { knownIds: new Set(), row: null }
  const ids = Array.isArray(row.known_composite_ids_json) ? row.known_composite_ids_json : []
  return { knownIds: new Set(ids.map(String)), row }
}

function selectCompositesForRun(composites, syncState, { mode, force, includeModified }) {
  if (force || mode === 'full' || !syncState?.row) {
    return sortCompositesByNameDesc(composites)
  }
  const known = syncState.knownIds || new Set()
  const lastModified = syncState.row?.last_seen_composite_modified_time
    ? new Date(syncState.row.last_seen_composite_modified_time).getTime()
    : 0
  return sortCompositesByNameDesc(composites.filter((c) => {
    if (!known.has(String(c.composite_item_id))) return true
    if (!includeModified) return false
    const modified = c.last_modified_time ? new Date(c.last_modified_time).getTime() : 0
    return Number.isFinite(modified) && modified > lastModified
  }))
}

function maxIso(values) {
  let max = null
  for (const value of values) {
    if (!value) continue
    const ms = new Date(value).getTime()
    if (!Number.isFinite(ms)) continue
    if (!max || ms > new Date(max).getTime()) max = value
  }
  return max
}

async function createReport({ client, userId, mode, reportName, totalSeen }) {
  const r = await client.query(
    `INSERT INTO composite_price_reports
       (report_name, mode, generated_at, zoho_sync_started_at, total_composites_seen, status, created_by)
     VALUES ($1, $2, NOW(), NOW(), $3, 'running', $4)
     RETURNING *`,
    [reportName, mode, totalSeen, userId || null]
  )
  return r.rows[0]
}

async function updateReportFailed(reportId, err) {
  await query(
    `UPDATE composite_price_reports
     SET status = 'failed', error_message = $2, zoho_sync_completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [reportId, String(err?.message || err).slice(0, 4000)]
  )
}

async function updateReportStarted(reportId, totalSeen) {
  await query(
    `UPDATE composite_price_reports
     SET total_composites_seen = $2, updated_at = NOW()
     WHERE id = $1`,
    [reportId, Number.isFinite(Number(totalSeen)) ? Number(totalSeen) : 0]
  )
}

async function updateReportProgress(db, reportId, counters) {
  await db.query(
    `UPDATE composite_price_reports
     SET total_new_composites_processed = $2,
         total_complete = $3,
         total_incomplete = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [
      reportId,
      counters.processed,
      counters.complete,
      counters.incomplete,
    ]
  )
}

function decimalOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dateOrNull(value) {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function extractFamily(composite, entity) {
  const candidates = [
    entity?.category_name,
    entity?.category,
    entity?.product_type,
    entity?.item_type,
    entity?.group_name,
    composite?.family,
    composite?.category_name,
    composite?.category,
  ]
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (value) return value
  }
  const sku = String(entity?.sku || composite?.sku || '').trim()
  const m = sku.match(/^[A-Za-z]+/)
  return m ? m[0].toUpperCase() : ''
}

function buildLatestParentPriceMap(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const id = String(row.composite_item_id || '').trim()
    if (id) map.set(id, row)
  }
  return map
}

async function getLatestParentPriceMap() {
  const r = await query(`
    SELECT DISTINCT ON (composite_item_id) *
    FROM composite_parent_prices
    ORDER BY composite_item_id, updated_at DESC, id DESC
  `)
  return buildLatestParentPriceMap(r.rows)
}

function hasManualShipping(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function calculateParentPricing({ purchasePrice, manualShipping, missingComponentsCount, rates, dateOfPrice }) {
  const purchase = Number(purchasePrice)
  const missingShipping = !hasManualShipping(manualShipping)
  const shipping = Number(manualShipping)
  const missingPurchase = !Number.isFinite(purchase) || purchase <= 0
  const incomplete =
    missingComponentsCount > 0 ||
    missingShipping ||
    missingPurchase

  if (incomplete) {
    return {
      purchase_price: Number.isFinite(purchase) ? purchase : null,
      manual_shipping: missingShipping ? null : shipping,
      suggested_sales_price: null,
      vat_5_percent: null,
      commission_15_percent: null,
      advertising_15_percent: null,
      total_cost: null,
      profit: null,
      profit_percent_of_sales: null,
      pricing_status: 'incomplete',
      missing_shipping: missingShipping,
      missing_component_price: missingComponentsCount > 0 || missingPurchase,
      date_of_price: null,
    }
  }

  const economics = computeBundleEconomics(purchase, shipping, rates)
  if (!economics?.ok) {
    return {
      purchase_price: purchase,
      manual_shipping: shipping,
      suggested_sales_price: null,
      vat_5_percent: null,
      commission_15_percent: null,
      advertising_15_percent: null,
      total_cost: null,
      profit: null,
      profit_percent_of_sales: null,
      pricing_status: 'incomplete',
      missing_shipping: false,
      missing_component_price: false,
      date_of_price: null,
    }
  }

  return {
    purchase_price: purchase,
    manual_shipping: shipping,
    suggested_sales_price: economics.salesPrice,
    vat_5_percent: economics.vatAmount,
    commission_15_percent: economics.commissionAmount,
    advertising_15_percent: economics.advertisingAmount,
    total_cost: economics.totalCost,
    profit: economics.profit,
    profit_percent_of_sales: economics.profitPct,
    pricing_status: 'complete',
    missing_shipping: false,
    missing_component_price: false,
    date_of_price: dateOrNull(dateOfPrice) || nowIso().slice(0, 10),
  }
}

function normalizeParentPriceForItem(row) {
  if (!row) return null
  return {
    id: row.id,
    composite_item_id: row.composite_item_id,
    sku: row.sku,
    name: row.name,
    family: row.family,
    report_item_id: row.report_item_id,
    purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
    manual_shipping: row.manual_shipping != null ? Number(row.manual_shipping) : null,
    suggested_sales_price: row.suggested_sales_price != null ? Number(row.suggested_sales_price) : null,
    vat_5_percent: row.vat_5_percent != null ? Number(row.vat_5_percent) : null,
    commission_15_percent: row.commission_15_percent != null ? Number(row.commission_15_percent) : null,
    advertising_15_percent: row.advertising_15_percent != null ? Number(row.advertising_15_percent) : null,
    total_cost: row.total_cost != null ? Number(row.total_cost) : null,
    profit: row.profit != null ? Number(row.profit) : null,
    profit_percent_of_sales: row.profit_percent_of_sales != null ? Number(row.profit_percent_of_sales) : null,
    pricing_status: row.pricing_status,
    date_of_price: row.date_of_price,
    components: Array.isArray(row.components_json) ? row.components_json : [],
    raw: row.raw_json || {},
    updated_at: row.updated_at,
  }
}

async function insertReportItem(client, reportId, item) {
  await client.query(
    `INSERT INTO composite_price_report_items
       (report_id, composite_item_id, sku, name, sales_price, vat_5_percent,
        commission_15_percent, advertising_15_percent, shipping, purchase_price,
        total_cost, profit, profit_percent_of_sales, pricing_status,
        unmatched_components_count, created_time, last_modified_time, components_json, raw_json)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb)`,
    [
      reportId,
      item.composite_item_id,
      item.sku,
      item.name,
      decimalOrNull(item.parent?.suggested_sales_price ?? item.sales_price),
      decimalOrNull(item.parent?.vat_5_percent ?? item.vat_5_percent),
      decimalOrNull(item.parent?.commission_15_percent ?? item.commission_15_percent),
      decimalOrNull(item.parent?.advertising_15_percent ?? item.advertising_15_percent),
      decimalOrNull(item.parent?.manual_shipping ?? item.shipping),
      decimalOrNull(item.parent?.purchase_price ?? item.purchase_price),
      decimalOrNull(item.parent?.total_cost ?? item.total_cost),
      decimalOrNull(item.parent?.profit ?? item.profit),
      decimalOrNull(item.parent?.profit_percent_of_sales ?? item.profit_percent_of_sales),
      item.pricing_status,
      item.unmatched_components_count || 0,
      item.created_time || null,
      item.last_modified_time || null,
      safeJson(item.components || []),
      safeJson(item.raw || {}),
    ]
  )
}

async function calculateCompositeReportItem(composite, purchaseMap, rates, itemByIdCache, savedParentPrice = null) {
  let detailJson
  try {
    detailJson = await fetchCompositeItemDetail(composite.composite_item_id, {
      source: 'composite_price_report_detail',
    })
  } catch (err) {
    console.warn(`[composite-price-report] detail failed ${composite.sku || composite.name || composite.composite_item_id}:`, err.message || err)
    return {
      ...composite,
      family: composite.family || '',
      sales_price: null,
      vat_5_percent: null,
      commission_15_percent: null,
      advertising_15_percent: null,
      shipping: null,
      purchase_price: null,
      total_cost: null,
      profit: null,
      profit_percent_of_sales: null,
      pricing_status: 'incomplete',
      unmatched_components_count: 1,
      parent: calculateParentPricing({
        purchasePrice: null,
        manualShipping: savedParentPrice?.manual_shipping,
        missingComponentsCount: 1,
        rates,
        dateOfPrice: savedParentPrice?.date_of_price,
      }),
      components: [],
      raw: { composite, error: err.message || String(err) },
    }
  }

  const entity = detailJson?.composite_item || detailJson || {}
  const mapped = Array.isArray(entity.mapped_items) ? entity.mapped_items : []
  const components = await resolveComponentsFromMappedItems(mapped, {
    itemByIdCache,
    skipCache: false,
    fetchConcurrency: ITEM_FETCH_CONCURRENCY,
  })
  let purchaseTotal = 0
  let latestDate = ''
  const family = extractFamily(composite, entity)

  const reportComponents = components.map((component) => {
    const result = findPurchaseMatchForComponent(purchaseMap, component)
    const quantity = Number(component.quantity)
    const safeQty = Number.isFinite(quantity) ? quantity : 0
    if (result.status === 'matched' && result.match) {
      const lineTotal = result.match.purchasePrice * safeQty
      purchaseTotal += lineTotal
      if (result.match.dateOfPrices && String(result.match.dateOfPrices).localeCompare(latestDate) > 0) latestDate = result.match.dateOfPrices
      const rowEconomics = computeAllPricesRowEconomics({
        purchasePrice: result.match.purchasePrice,
        shipping: result.match.shipping,
      }, rates)
      return {
        ...component,
        matched_all_prices_item_no: result.match.itemNo,
        matched_all_prices_sku: result.match.itemNo,
        matched_purchase_price: result.match.purchasePrice,
        line_total: lineTotal,
        match_status: 'matched',
        match_key_used: result.match.matchedKey,
        match_kind: result.match.matchKind,
        date_of_prices: result.match.dateOfPrices,
        all_prices: {
          item_no: result.match.itemNo,
          sku: result.match.itemNo,
          sales_price: rowEconomics.ok ? rowEconomics.salesPrice : null,
          vat_5_percent: rowEconomics.ok ? rowEconomics.vatAmount : null,
          commission_15_percent: rowEconomics.ok ? rowEconomics.commissionAmount : null,
          advertising_15_percent: rowEconomics.ok ? rowEconomics.advertisingAmount : null,
          shipping: result.match.shipping,
          purchase_price: result.match.purchasePrice,
          total_cost: rowEconomics.ok ? rowEconomics.totalCost : null,
          profit: rowEconomics.ok ? rowEconomics.profit : null,
          profit_percent_of_sales: rowEconomics.ok ? rowEconomics.profitPct : null,
          pricing_status: rowEconomics.ok && !rowEconomics.denominatorInvalid ? 'complete' : 'incomplete',
          date_of_price: result.match.dateOfPrices,
        },
      }
    }
    return {
      ...component,
      matched_all_prices_item_no: null,
      matched_all_prices_sku: null,
      matched_purchase_price: null,
      line_total: null,
      match_status: result.status,
      possible_matches: result.matches,
      all_prices: null,
    }
  })

  const incompleteCount = reportComponents.filter((c) => c.match_status !== 'matched').length
  const parent = calculateParentPricing({
    purchasePrice: purchaseTotal,
    manualShipping: savedParentPrice?.manual_shipping,
    missingComponentsCount: incompleteCount,
    rates,
    dateOfPrice: savedParentPrice?.date_of_price,
  })
  const pricingStatus = parent.pricing_status

  return {
    composite_item_id: String(entity.composite_item_id || composite.composite_item_id),
    item_id: composite.item_id || (entity.item_id != null ? String(entity.item_id) : ''),
    sku: entity.sku != null ? String(entity.sku) : composite.sku,
    name: entity.name != null ? String(entity.name) : composite.name,
    family,
    status: entity.status != null ? String(entity.status) : composite.status,
    sales_price: parent.suggested_sales_price,
    vat_5_percent: parent.vat_5_percent,
    commission_15_percent: parent.commission_15_percent,
    advertising_15_percent: parent.advertising_15_percent,
    shipping: parent.manual_shipping,
    purchase_price: purchaseTotal,
    partial_purchase_price: pricingStatus === 'incomplete' ? purchaseTotal : null,
    total_cost: parent.total_cost,
    profit: parent.profit,
    profit_percent_of_sales: parent.profit_percent_of_sales,
    pricing_status: pricingStatus,
    unmatched_components_count: incompleteCount,
    date_of_prices: latestDate,
    date_of_price: parent.date_of_price,
    parent,
    saved_parent_price: normalizeParentPriceForItem(savedParentPrice),
    components: reportComponents,
    created_time: composite.created_time || entity.created_time || null,
    last_modified_time: composite.last_modified_time || entity.last_modified_time || null,
    raw: { composite, entity, rates, family, parent, saved_parent_price: normalizeParentPriceForItem(savedParentPrice) },
  }
}

async function persistCompletedReport(client, reportId, items, allComposites) {
  for (const item of items) {
    await insertReportItem(client, reportId, item)
  }
  const totalComplete = items.filter((item) => item.pricing_status === 'complete').length
  const totalIncomplete = items.length - totalComplete
  await client.query(
    `UPDATE composite_price_reports
     SET status = 'completed',
         zoho_sync_completed_at = NOW(),
         total_new_composites_processed = $2,
         total_complete = $3,
         total_incomplete = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [reportId, items.length, totalComplete, totalIncomplete]
  )
  await client.query(
    `INSERT INTO composite_price_report_sync_state
       (id, last_successful_report_id, last_successful_sync_at, last_seen_composite_created_time,
        last_seen_composite_modified_time, known_composite_ids_json, updated_at)
     VALUES (1, $1, NOW(), $2, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       last_successful_report_id = EXCLUDED.last_successful_report_id,
       last_successful_sync_at = NOW(),
       last_seen_composite_created_time = EXCLUDED.last_seen_composite_created_time,
       last_seen_composite_modified_time = EXCLUDED.last_seen_composite_modified_time,
       known_composite_ids_json = EXCLUDED.known_composite_ids_json,
       updated_at = NOW()`,
    [
      reportId,
      maxIso(allComposites.map((c) => c.created_time)),
      maxIso(allComposites.map((c) => c.last_modified_time)),
      safeJson([...new Set(allComposites.map((c) => String(c.composite_item_id)).filter(Boolean))]),
    ]
  )
}

async function persistReportSyncState(client, reportId, allComposites) {
  await client.query(
    `INSERT INTO composite_price_report_sync_state
       (id, last_successful_report_id, last_successful_sync_at, last_seen_composite_created_time,
        last_seen_composite_modified_time, known_composite_ids_json, updated_at)
     VALUES (1, $1, NOW(), $2, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       last_successful_report_id = EXCLUDED.last_successful_report_id,
       last_successful_sync_at = NOW(),
       last_seen_composite_created_time = EXCLUDED.last_seen_composite_created_time,
       last_seen_composite_modified_time = EXCLUDED.last_seen_composite_modified_time,
       known_composite_ids_json = EXCLUDED.known_composite_ids_json,
       updated_at = NOW()`,
    [
      reportId,
      maxIso(allComposites.map((c) => c.created_time)),
      maxIso(allComposites.map((c) => c.last_modified_time)),
      safeJson([...new Set(allComposites.map((c) => String(c.composite_item_id)).filter(Boolean))]),
    ]
  )
}

function applyCounterDelta(counters, item) {
  counters.processed += 1
  if (item.pricing_status === 'complete') counters.complete += 1
  else counters.incomplete += 1
}

async function persistReportItemsBatch(client, reportId, items, counters) {
  if (!items.length) return
  await client.query('BEGIN')
  try {
    for (const item of items) {
      await insertReportItem(client, reportId, item)
      applyCounterDelta(counters, item)
    }
    await updateReportProgress(client, reportId, counters)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  }
}

async function completeReport(client, reportId, counters, allComposites) {
  await client.query(
    `UPDATE composite_price_reports
     SET status = 'completed',
         zoho_sync_completed_at = NOW(),
         total_new_composites_processed = $2,
         total_complete = $3,
         total_incomplete = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [reportId, counters.processed, counters.complete, counters.incomplete]
  )
  await persistReportSyncState(client, reportId, allComposites)
}

async function runCompositeItemsPriceReportJob({ reportId, userId, mode, force, includeModified, rows, rates }) {
  const itemByIdCache = new Map()
  const batchBuffer = []
  const counters = { processed: 0, complete: 0, incomplete: 0 }
  let dbClient = null
  let persistChain = Promise.resolve()

  const flushBatchBuffer = async () => {
    if (!batchBuffer.length || !dbClient) return
    const batch = batchBuffer.splice(0, batchBuffer.length)
    await persistReportItemsBatch(dbClient, reportId, batch, counters)
  }

  const schedulePersist = (item) => {
    persistChain = persistChain.then(async () => {
      batchBuffer.push(item)
      if (batchBuffer.length >= PROGRESS_BATCH_SIZE) {
        await flushBatchBuffer()
      }
    })
    return persistChain
  }

  try {
    const [allComposites, syncState, parentPriceMap] = await Promise.all([
      fetchAllCompositeItems(),
      getSyncState(),
      getLatestParentPriceMap(),
    ])
    await updateReportStarted(reportId, allComposites.length)
    const selected = selectCompositesForRun(allComposites, syncState, { mode, force, includeModified })
    const purchaseMap = buildPurchasePriceMap(rows)

    dbClient = await pool.connect()

    await promiseConcurrent(
      selected.map((composite) => async () => {
        const savedParentPrice = parentPriceMap.get(String(composite.composite_item_id))
        const item = await calculateCompositeReportItem(composite, purchaseMap, rates, itemByIdCache, savedParentPrice)
        await schedulePersist(item)
        return item
      }),
      DETAIL_CONCURRENCY
    )

    await persistChain
    await flushBatchBuffer()

    await dbClient.query('BEGIN')
    await completeReport(dbClient, reportId, counters, allComposites)
    await dbClient.query('COMMIT')
    console.log(
      `[composite-price-report] report ${reportId} completed: ${counters.processed}/${selected.length} selected composite(s), ${allComposites.length} active in Zoho`
    )
  } catch (err) {
    await updateReportFailed(reportId, err).catch(() => {})
    console.error(`[composite-price-report] report ${reportId} failed:`, err.message || err)
  } finally {
    if (dbClient) dbClient.release()
    generationRunning = false
  }
}

async function startCompositeItemsPriceReportGeneration({ userId, mode = 'incremental', force = false, includeModified = false } = {}) {
  await ensureCompositeItemsPriceReportTables()
  await failStaleRunningReports()
  const runningReportId = await getRunningReportId()
  if (runningReportId != null) {
    const err = new Error(
      'A composite price report is already being generated. Refresh saved reports to see progress.'
    )
    err.code = 'REPORT_ALREADY_RUNNING'
    throw err
  }
  if (generationRunning) generationRunning = false
  generationRunning = true
  try {
    const effectiveMode = force || mode === 'full' ? 'full' : 'incremental'
    const { rows, rates } = await loadAllPricesBundle(userId)
    const client = await pool.connect()
    let report
    try {
      await client.query('BEGIN')
      const reportName = `${effectiveMode === 'full' ? 'Full' : 'Delta'} Composite Items Price Report ${nowIso()}`
      report = await createReport({ client, userId, mode: effectiveMode, reportName, totalSeen: 0 })
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    setImmediate(() => {
      runCompositeItemsPriceReportJob({
        reportId: report.id,
        userId,
        mode: effectiveMode,
        force,
        includeModified,
        rows,
        rates,
      })
    })

    return {
      report_id: report.id,
      generated_at: report.generated_at,
      mode: effectiveMode,
      total_composites_seen: 0,
      total_new_composites_processed: 0,
      total_complete: 0,
      total_incomplete: 0,
      status: 'running',
      message: 'Composite price report generation started. Refresh saved reports to see progress.',
    }
  } catch (err) {
    generationRunning = false
    throw err
  }
}

async function listCompositeItemsPriceReports() {
  await ensureCompositeItemsPriceReportTables()
  const r = await query(
    `SELECT id, report_name, mode, generated_at, total_composites_seen,
            total_new_composites_processed, total_complete, total_incomplete,
            status, error_message
     FROM composite_price_reports
     ORDER BY generated_at DESC, id DESC
     LIMIT 100`
  )
  return r.rows
}

async function getCompositeItemsPriceReport(reportId) {
  await ensureCompositeItemsPriceReportTables()
  const id = Number.parseInt(String(reportId), 10)
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid report id')
    err.code = 'INVALID_REPORT_ID'
    throw err
  }
  const reportResult = await query(`SELECT * FROM composite_price_reports WHERE id = $1`, [id])
  const report = reportResult.rows[0]
  if (!report) {
    const err = new Error('Composite price report not found')
    err.code = 'REPORT_NOT_FOUND'
    throw err
  }
  const itemsResult = await query(
    `SELECT * FROM composite_price_report_items WHERE report_id = $1 ORDER BY name DESC NULLS LAST, sku DESC NULLS LAST, id`,
    [id]
  )
  const items = itemsResult.rows.map((row) => ({
    id: row.id,
    report_id: row.report_id,
    composite_item_id: row.composite_item_id,
    sku: row.sku,
    name: row.name,
    family: row.raw_json?.family || row.raw_json?.entity?.category_name || row.raw_json?.composite?.family || '',
    sales_price: row.sales_price != null ? Number(row.sales_price) : null,
    vat_5_percent: row.vat_5_percent != null ? Number(row.vat_5_percent) : null,
    commission_15_percent: row.commission_15_percent != null ? Number(row.commission_15_percent) : null,
    advertising_15_percent: row.advertising_15_percent != null ? Number(row.advertising_15_percent) : null,
    shipping: row.shipping != null ? Number(row.shipping) : null,
    purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
    total_cost: row.total_cost != null ? Number(row.total_cost) : null,
    profit: row.profit != null ? Number(row.profit) : null,
    profit_percent_of_sales: row.profit_percent_of_sales != null ? Number(row.profit_percent_of_sales) : null,
    pricing_status: row.pricing_status,
    unmatched_components_count: row.unmatched_components_count,
    parent: row.raw_json?.parent || {
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      manual_shipping: row.shipping != null ? Number(row.shipping) : null,
      suggested_sales_price: row.sales_price != null ? Number(row.sales_price) : null,
      vat_5_percent: row.vat_5_percent != null ? Number(row.vat_5_percent) : null,
      commission_15_percent: row.commission_15_percent != null ? Number(row.commission_15_percent) : null,
      advertising_15_percent: row.advertising_15_percent != null ? Number(row.advertising_15_percent) : null,
      total_cost: row.total_cost != null ? Number(row.total_cost) : null,
      profit: row.profit != null ? Number(row.profit) : null,
      profit_percent_of_sales: row.profit_percent_of_sales != null ? Number(row.profit_percent_of_sales) : null,
      pricing_status: row.pricing_status,
      date_of_price: row.raw_json?.date_of_price || null,
    },
    saved_parent_price: row.raw_json?.saved_parent_price || null,
    created_time: row.created_time,
    last_modified_time: row.last_modified_time,
    components: Array.isArray(row.components_json) ? row.components_json : [],
    raw: row.raw_json || {},
  }))
  return { report, items }
}

async function saveCompositeParentPrice({ reportId, itemId, userId, manualShipping, dateOfPrice }) {
  await ensureCompositeItemsPriceReportTables()
  const rid = Number.parseInt(String(reportId), 10)
  const iid = Number.parseInt(String(itemId), 10)
  if (!Number.isFinite(rid) || !Number.isFinite(iid)) {
    const err = new Error('Invalid report or item id')
    err.code = 'INVALID_REPORT_ID'
    throw err
  }
  if (!hasManualShipping(manualShipping) || Number(manualShipping) < 0) {
    const err = new Error('Manual shipping must be a non-negative number.')
    err.code = 'INVALID_MANUAL_SHIPPING'
    throw err
  }

  const rowResult = await query(
    `SELECT * FROM composite_price_report_items WHERE report_id = $1 AND id = $2`,
    [rid, iid]
  )
  const row = rowResult.rows[0]
  if (!row) {
    const err = new Error('Composite report item not found')
    err.code = 'REPORT_NOT_FOUND'
    throw err
  }

  const components = Array.isArray(row.components_json) ? row.components_json : []
  const unmatched = components.filter((component) => component.match_status !== 'matched').length
  const purchasePrice = row.purchase_price != null ? Number(row.purchase_price) : null
  const raw = row.raw_json || {}
  const rates = raw.rates && typeof raw.rates === 'object' ? { ...DEFAULT_RATES, ...raw.rates } : { ...DEFAULT_RATES }
  const parent = calculateParentPricing({
    purchasePrice,
    manualShipping: Number(manualShipping),
    missingComponentsCount: unmatched,
    rates,
    dateOfPrice: dateOfPrice || nowIso(),
  })
  if (parent.pricing_status !== 'complete') {
    const err = new Error(
      parent.missing_component_price
        ? 'Cannot save: at least one component is missing from All Prices.'
        : 'Cannot save: parent composite pricing is incomplete.'
    )
    err.code = 'PARENT_PRICE_INCOMPLETE'
    throw err
  }

  const family = raw.family || ''
  const saved = await query(
    `INSERT INTO composite_parent_prices
       (composite_item_id, sku, name, family, report_item_id, purchase_price, manual_shipping,
        suggested_sales_price, vat_5_percent, commission_15_percent, advertising_15_percent,
        total_cost, profit, profit_percent_of_sales, pricing_status, date_of_price,
        components_json, raw_json, created_by, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17::jsonb, $18::jsonb, $19, NOW())
     ON CONFLICT (composite_item_id) DO UPDATE SET
       sku = EXCLUDED.sku,
       name = EXCLUDED.name,
       family = EXCLUDED.family,
       report_item_id = EXCLUDED.report_item_id,
       purchase_price = EXCLUDED.purchase_price,
       manual_shipping = EXCLUDED.manual_shipping,
       suggested_sales_price = EXCLUDED.suggested_sales_price,
       vat_5_percent = EXCLUDED.vat_5_percent,
       commission_15_percent = EXCLUDED.commission_15_percent,
       advertising_15_percent = EXCLUDED.advertising_15_percent,
       total_cost = EXCLUDED.total_cost,
       profit = EXCLUDED.profit,
       profit_percent_of_sales = EXCLUDED.profit_percent_of_sales,
       pricing_status = EXCLUDED.pricing_status,
       date_of_price = EXCLUDED.date_of_price,
       components_json = EXCLUDED.components_json,
       raw_json = EXCLUDED.raw_json,
       created_by = COALESCE(EXCLUDED.created_by, composite_parent_prices.created_by),
       updated_at = NOW()
     RETURNING *`,
    [
      row.composite_item_id,
      row.sku || '',
      row.name || '',
      family,
      row.id,
      decimalOrNull(parent.purchase_price),
      decimalOrNull(parent.manual_shipping),
      decimalOrNull(parent.suggested_sales_price),
      decimalOrNull(parent.vat_5_percent),
      decimalOrNull(parent.commission_15_percent),
      decimalOrNull(parent.advertising_15_percent),
      decimalOrNull(parent.total_cost),
      decimalOrNull(parent.profit),
      decimalOrNull(parent.profit_percent_of_sales),
      parent.pricing_status,
      dateOrNull(parent.date_of_price),
      safeJson(components),
      safeJson({ report_id: rid, report_item_id: iid, rates, parent }),
      userId || null,
    ]
  )

  await query(
    `UPDATE composite_price_report_items
     SET sales_price = $3,
         vat_5_percent = $4,
         commission_15_percent = $5,
         advertising_15_percent = $6,
         shipping = $7,
         total_cost = $8,
         profit = $9,
         profit_percent_of_sales = $10,
         pricing_status = 'complete',
         raw_json = COALESCE(raw_json, '{}'::jsonb) || $11::jsonb,
         updated_at = NOW()
     WHERE report_id = $1 AND id = $2`,
    [
      rid,
      iid,
      decimalOrNull(parent.suggested_sales_price),
      decimalOrNull(parent.vat_5_percent),
      decimalOrNull(parent.commission_15_percent),
      decimalOrNull(parent.advertising_15_percent),
      decimalOrNull(parent.manual_shipping),
      decimalOrNull(parent.total_cost),
      decimalOrNull(parent.profit),
      decimalOrNull(parent.profit_percent_of_sales),
      safeJson({ parent, saved_parent_price: normalizeParentPriceForItem(saved.rows[0]) }),
    ]
  )

  return {
    saved_parent_price: normalizeParentPriceForItem(saved.rows[0]),
    parent,
  }
}

async function deleteCompositeItemsPriceReport(reportId) {
  await ensureCompositeItemsPriceReportTables()
  const id = Number.parseInt(String(reportId), 10)
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid report id')
    err.code = 'INVALID_REPORT_ID'
    throw err
  }
  const result = await query(
    `DELETE FROM composite_price_reports WHERE id = $1 RETURNING id`,
    [id]
  )
  if (result.rowCount === 0) {
    const err = new Error('Composite price report not found')
    err.code = 'REPORT_NOT_FOUND'
    throw err
  }
  return { deleted: true, id }
}

module.exports = {
  ensureCompositeItemsPriceReportTables,
  REPORT_COMPOSITE_FILTER_BY,
  fetchAllCompositeItems,
  sortCompositesByNameDesc,
  selectCompositesForRun,
  calculateCompositeReportItem,
  calculateParentPricing,
  startCompositeItemsPriceReportGeneration,
  runCompositeItemsPriceReportJob,
  listCompositeItemsPriceReports,
  getCompositeItemsPriceReport,
  saveCompositeParentPrice,
  deleteCompositeItemsPriceReport,
}

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
} = require('./compositePricingLogic')

const PREF_ALL_PRICES_EC = 'all_prices_ecommerce_v1'
const DEFAULT_PER_PAGE = 200
const MAX_COMPOSITE_PAGES = 50
const DETAIL_CONCURRENCY = 3

let generationRunning = false

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

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next
      next += 1
      out[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
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
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_reports_generated ON composite_price_reports(generated_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_report_items_report ON composite_price_report_items(report_id, name DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_composite_price_report_items_composite ON composite_price_report_items(composite_item_id)`)
}

async function fetchAllCompositeItems() {
  const all = []
  for (let page = 1; page <= MAX_COMPOSITE_PAGES; page += 1) {
    const json = await fetchCompositeItemsList({
      page,
      per_page: DEFAULT_PER_PAGE,
      filter_by: 'Status.All',
    }, {
      source: 'composite_price_report_list',
      skipCache: true,
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

function decimalOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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
      decimalOrNull(item.sales_price),
      decimalOrNull(item.vat_5_percent),
      decimalOrNull(item.commission_15_percent),
      decimalOrNull(item.advertising_15_percent),
      decimalOrNull(item.shipping),
      decimalOrNull(item.purchase_price),
      decimalOrNull(item.total_cost),
      decimalOrNull(item.profit),
      decimalOrNull(item.profit_percent_of_sales),
      item.pricing_status,
      item.unmatched_components_count || 0,
      item.created_time || null,
      item.last_modified_time || null,
      safeJson(item.components || []),
      safeJson(item.raw || {}),
    ]
  )
}

async function calculateCompositeReportItem(composite, purchaseMap, rates) {
  let detailJson
  try {
    detailJson = await fetchCompositeItemDetail(composite.composite_item_id, {
      source: 'composite_price_report_detail',
      skipCache: true,
    })
  } catch (err) {
    console.warn(`[composite-price-report] detail failed ${composite.sku || composite.name || composite.composite_item_id}:`, err.message || err)
    return {
      ...composite,
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
      components: [],
      raw: { composite, error: err.message || String(err) },
    }
  }

  const entity = detailJson?.composite_item || detailJson || {}
  const mapped = Array.isArray(entity.mapped_items) ? entity.mapped_items : []
  const components = await resolveComponentsFromMappedItems(mapped)
  let purchaseTotal = 0
  let shippingTotal = 0
  let latestDate = ''

  const reportComponents = components.map((component) => {
    const result = findPurchaseMatchForComponent(purchaseMap, component)
    const quantity = Number(component.quantity)
    const safeQty = Number.isFinite(quantity) ? quantity : 0
    if (result.status === 'matched' && result.match) {
      const lineTotal = result.match.purchasePrice * safeQty
      purchaseTotal += lineTotal
      if (Number.isFinite(Number(result.match.shipping))) shippingTotal += Number(result.match.shipping) * safeQty
      if (result.match.dateOfPrices && String(result.match.dateOfPrices).localeCompare(latestDate) > 0) latestDate = result.match.dateOfPrices
      return {
        ...component,
        matched_all_prices_item_no: result.match.itemNo,
        matched_purchase_price: result.match.purchasePrice,
        line_total: lineTotal,
        match_status: 'matched',
        match_key_used: result.match.matchedKey,
        match_kind: result.match.matchKind,
        date_of_prices: result.match.dateOfPrices,
      }
    }
    return {
      ...component,
      matched_all_prices_item_no: null,
      matched_purchase_price: null,
      line_total: null,
      match_status: result.status,
      possible_matches: result.matches,
    }
  })

  const incompleteCount = reportComponents.filter((c) => c.match_status !== 'matched').length
  const pricingStatus = incompleteCount > 0 ? 'incomplete' : 'complete'
  const economics = pricingStatus === 'complete'
    ? computeBundleEconomics(purchaseTotal, shippingTotal, rates)
    : null

  return {
    composite_item_id: String(entity.composite_item_id || composite.composite_item_id),
    item_id: composite.item_id || (entity.item_id != null ? String(entity.item_id) : ''),
    sku: entity.sku != null ? String(entity.sku) : composite.sku,
    name: entity.name != null ? String(entity.name) : composite.name,
    status: entity.status != null ? String(entity.status) : composite.status,
    sales_price: economics?.ok ? economics.salesPrice : null,
    vat_5_percent: economics?.ok ? economics.vatAmount : null,
    commission_15_percent: economics?.ok ? economics.commissionAmount : null,
    advertising_15_percent: economics?.ok ? economics.advertisingAmount : null,
    shipping: pricingStatus === 'complete' ? shippingTotal : null,
    purchase_price: purchaseTotal,
    partial_purchase_price: pricingStatus === 'incomplete' ? purchaseTotal : null,
    total_cost: economics?.ok ? economics.totalCost : null,
    profit: economics?.ok ? economics.profit : null,
    profit_percent_of_sales: economics?.ok ? economics.profitPct : null,
    pricing_status: pricingStatus,
    unmatched_components_count: incompleteCount,
    date_of_prices: latestDate,
    components: reportComponents,
    created_time: composite.created_time || entity.created_time || null,
    last_modified_time: composite.last_modified_time || entity.last_modified_time || null,
    raw: { composite, entity, rates },
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

async function generateCompositeItemsPriceReport({ userId, mode = 'incremental', force = false, includeModified = false } = {}) {
  await ensureCompositeItemsPriceReportTables()
  if (generationRunning) {
    const err = new Error('A composite price report is already being generated.')
    err.code = 'REPORT_ALREADY_RUNNING'
    throw err
  }
  generationRunning = true
  let reportId = null
  try {
    const effectiveMode = force || mode === 'full' ? 'full' : 'incremental'
    const { rows, rates } = await loadAllPricesBundle(userId)
    const [allComposites, syncState] = await Promise.all([
      fetchAllCompositeItems(),
      getSyncState(),
    ])
    const selected = selectCompositesForRun(allComposites, syncState, { mode: effectiveMode, force, includeModified })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const reportName = `${effectiveMode === 'full' ? 'Full' : 'Delta'} Composite Items Price Report ${nowIso()}`
      const report = await createReport({ client, userId, mode: effectiveMode, reportName, totalSeen: allComposites.length })
      reportId = report.id
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    const purchaseMap = buildPurchasePriceMap(rows)
    const items = await mapLimit(selected, DETAIL_CONCURRENCY, (composite) =>
      calculateCompositeReportItem(composite, purchaseMap, rates)
    )
    const sortedItems = sortCompositesByNameDesc(items)

    const saveClient = await pool.connect()
    try {
      await saveClient.query('BEGIN')
      await persistCompletedReport(saveClient, reportId, sortedItems, allComposites)
      await saveClient.query('COMMIT')
    } catch (err) {
      await saveClient.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      saveClient.release()
    }

    const detail = await getCompositeItemsPriceReport(reportId)
    return {
      report_id: reportId,
      generated_at: detail.report.generated_at,
      mode: effectiveMode,
      total_composites_seen: allComposites.length,
      total_new_composites_processed: sortedItems.length,
      total_complete: detail.report.total_complete,
      total_incomplete: detail.report.total_incomplete,
      status: 'completed',
      message: sortedItems.length
        ? `${sortedItems.length} composite item(s) processed.`
        : 'No new composite items were found for the incremental report.',
    }
  } catch (err) {
    if (reportId) await updateReportFailed(reportId, err).catch(() => {})
    throw err
  } finally {
    generationRunning = false
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
    created_time: row.created_time,
    last_modified_time: row.last_modified_time,
    components: Array.isArray(row.components_json) ? row.components_json : [],
    raw: row.raw_json || {},
  }))
  return { report, items }
}

module.exports = {
  ensureCompositeItemsPriceReportTables,
  fetchAllCompositeItems,
  sortCompositesByNameDesc,
  selectCompositesForRun,
  calculateCompositeReportItem,
  generateCompositeItemsPriceReport,
  listCompositeItemsPriceReports,
  getCompositeItemsPriceReport,
}

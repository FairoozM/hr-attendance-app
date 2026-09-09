'use strict'

/**
 * Noon marketplace orders, straight from the Noon Partner API.
 *
 * Noon has no synchronous "list orders" endpoint for marketplace sellers. Its order feed is the
 * Reports (impex) service:
 *
 *   POST /impex/v1/export/create  { export_category_code: 'noon_noonoms_ordersexport',
 *                                   params: { from_date, to_date } }   → export_code
 *   POST /impex/v1/export/status  { export_code }                      → status + download_url
 *   GET  download_url                                                  → CSV, one row per item_nr
 *
 * Statuses observed: PENDING → RUNNING → COMPLETE (download_url set) / FAILED.
 * See https://noon-docs.noonpartners.dev/docs/api-reference/impex.
 *
 * The CSV is the complete result for the window — there are no pages to walk — so the loop that
 * matters here is the status poll, which is bounded and never treats a still-running export as an
 * empty day. Rows land in `noon_order_lines` so the report reads cached API data instead of
 * triggering an export on every page view.
 */

const axios = require('axios')

const { noonPost } = require('./noonClient')
const { readNoonConfig } = require('./noonConfig')
const store = require('./noonOrdersStore')

const ORDERS_EXPORT_CATEGORY = 'noon_noonoms_ordersexport'
const FINANCE_EXPORT_CATEGORY = 'noon_financeweb_transactionviewreportonitemlevel'
const CREATE_PATH = '/impex/v1/export/create'
const STATUS_PATH = '/impex/v1/export/status'
const MAX_POLLS = 40
const POLL_INTERVAL_MS = 3000
const DOWNLOAD_TIMEOUT_MS = 60_000

function ymd(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`expected a YYYY-MM-DD date, received "${value}"`)
    err.code = 'NOON_EXPORT_VALIDATION'
    throw err
  }
  return s
}

function parseCsv(text) {
  const rows = []
  let field = ''
  let record = []
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      rows.push(record)
      record = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || record.length) {
    record.push(field)
    rows.push(record)
  }
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((cell) => String(cell).trim() !== ''))
    .map((r) => {
      const obj = {}
      header.forEach((key, idx) => {
        obj[key] = r[idx] == null ? '' : String(r[idx]).trim()
      })
      return obj
    })
}

/** Noon prints "2026-09-07 06:03:52 UTC". */
function parseNoonTimestamp(value) {
  const s = String(value || '').trim()
  if (!s) return null
  const iso = s.replace(' UTC', 'Z').replace(' ', 'T')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseBoolean(value) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return null
  if (['true', '1', 'yes'].includes(s)) return true
  if (['false', '0', 'no'].includes(s)) return false
  return null
}

async function runExport({ exportCategoryCode, params, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const created = await noonPost(CREATE_PATH, {
    export_category_code: exportCategoryCode,
    params,
  })
  const exportCode = created.data?.export_code
  if (!exportCode) {
    const err = new Error('Noon export was created without an export_code')
    err.code = 'NOON_EXPORT_NO_CODE'
    throw err
  }

  let polls = 0
  let status = null
  let downloadUrl = null
  while (polls < MAX_POLLS) {
    await sleepFn(POLL_INTERVAL_MS)
    polls += 1
    const res = await noonPost(STATUS_PATH, { export_code: exportCode })
    status = String(res.data?.export_status || '').toUpperCase()
    downloadUrl = res.data?.download_url || null
    if (downloadUrl) break
    if (status.includes('FAIL') || status.includes('ERROR')) break
  }

  if (!downloadUrl) {
    const err = new Error(
      `Noon export ${exportCode} did not produce a download after ${polls} status checks (last status ${status || 'unknown'})`,
    )
    err.code = status && status.includes('FAIL') ? 'NOON_EXPORT_FAILED' : 'NOON_EXPORT_TIMEOUT'
    err.exportCode = exportCode
    err.pollCount = polls
    throw err
  }

  const file = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
  })
  const rows = parseCsv(Buffer.from(file.data).toString('utf8'))
  return { exportCode, pollCount: polls, status, rows }
}

function mapOrderRow(raw, lastSyncedAt) {
  const orderNr = String(raw.order_nr || '').trim()
  const itemNr = String(raw.item_nr || '').trim() || `${orderNr}-1`
  if (!orderNr) return null
  return {
    countryCode: String(raw.market_place_country_code || '').trim().toUpperCase() || 'AE',
    orderNr,
    itemNr,
    marketplace: String(raw.market_place || '').trim() || null,
    destinationCountryCode: String(raw.destination_country_code || '').trim().toUpperCase() || null,
    noonSku: String(raw.sku || '').trim() || null,
    partnerSku: String(raw.partner_sku || '').trim() || null,
    warehouseCode: String(raw.warehouse_code || '').trim() || null,
    orderPlacedAt: parseNoonTimestamp(raw.order_placed_at),
    deliveredAt: parseNoonTimestamp(raw.delivered_at),
    itemStatus: String(raw.item_status || '').trim() || null,
    shipmentNr: String(raw.shipment_nr || '').trim() || null,
    awbNr: String(raw.awb_nr || '').trim() || null,
    isFulfilledByNoon: parseBoolean(raw.is_fulfilled_by_noon),
    rawRow: raw,
    lastSyncedAt,
  }
}

function assertNoonConfigured() {
  const config = readNoonConfig()
  if (config.configured) return config
  const err = new Error(
    config.enabled
      ? `Noon API configuration is incomplete (${config.missing.join(', ') || 'unknown'})`
      : 'Noon API integration is disabled (NOON_API_ENABLED)',
  )
  err.code = 'NOON_NOT_CONFIGURED'
  throw err
}

/**
 * Fetch and cache every Noon order line placed in the given date window.
 *
 * @param {{ fromYmd: string, toYmd: string, sleepFn?: (ms: number) => Promise<void> }} opts
 */
async function syncNoonOrders({ fromYmd, toYmd, sleepFn }) {
  assertNoonConfigured()

  const from = ymd(fromYmd)
  const to = ymd(toYmd)
  await store.ensureNoonOrderTables()
  const runId = await store.insertExportRun({
    exportCategoryCode: ORDERS_EXPORT_CATEGORY,
    fromDate: from,
    toDate: to,
    status: 'running',
  })

  try {
    const { exportCode, pollCount, rows } = await runExport({
      exportCategoryCode: ORDERS_EXPORT_CATEGORY,
      params: { from_date: from, to_date: to },
      sleepFn,
    })
    const now = new Date()
    let saved = 0
    const orderNumbers = new Set()
    const byCountry = {}
    for (const raw of rows) {
      const mapped = mapOrderRow(raw, now)
      if (!mapped) continue
      await store.upsertNoonOrderLine(mapped)
      saved += 1
      orderNumbers.add(`${mapped.countryCode}:${mapped.orderNr}`)
      byCountry[mapped.countryCode] = (byCountry[mapped.countryCode] || 0) + 1
    }
    await store.updateExportRun(runId, {
      exportCode,
      status: 'success',
      rowsParsed: rows.length,
      rowsSaved: saved,
      pollCount,
      finishedAt: new Date(),
    })
    return {
      exportCategoryCode: ORDERS_EXPORT_CATEGORY,
      exportCode,
      fromDate: from,
      toDate: to,
      pollCount,
      rowsParsed: rows.length,
      rowsSaved: saved,
      uniqueOrders: orderNumbers.size,
      linesByCountry: byCountry,
    }
  } catch (err) {
    await store.updateExportRun(runId, {
      status: 'failed',
      errorMessage: err && err.message ? String(err.message).slice(0, 500) : 'noon_export_failed',
      pollCount: err?.pollCount ?? null,
      finishedAt: new Date(),
    })
    throw err
  }
}

function parseMoney(value) {
  const s = String(value ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** The finance export prints ISO dates ("2026-08-31"); anything else is left null, never guessed. */
function parseIsoDate(value) {
  const s = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * Noon country for a finance row: the contract title carries it ("NOON-AE"), and the Noon order
 * number repeats it (`NAEI…` = AE, `NSAI…` = SA).
 */
function financeCountryCode(raw) {
  const fromContract = String(raw['Contract Title'] || '').trim().match(/-([A-Z]{2})$/)
  if (fromContract) return fromContract[1]
  const fromOrder = String(raw['Order Nr'] || '').trim().match(/^N([A-Z]{2})/)
  return fromOrder ? fromOrder[1] : null
}

function mapFinanceRow(raw, lastSyncedAt) {
  const orderNr = String(raw['Order Nr'] || '').trim()
  // "NA" is what Noon prints on account-level lines (advertising fees, adjustments); they belong
  // to no order, so they must never be attached to one.
  if (!orderNr || orderNr === 'NA') return null
  return {
    orderNr,
    itemNr: String(raw['Item Nr'] || '').trim(),
    referenceNr: String(raw['Reference Nr'] || '').trim(),
    transactionType: String(raw['Transaction Type'] || '').trim().toLowerCase(),
    contract: String(raw.Contract || '').trim() || null,
    contractTitle: String(raw['Contract Title'] || '').trim() || null,
    countryCode: financeCountryCode(raw),
    currency: String(raw.Currency || '').trim().toUpperCase() || null,
    orderDate: parseIsoDate(raw['Order Date']),
    transactionDate: parseIsoDate(raw['Transaction Date']),
    netProceeds: parseMoney(raw['Net Proceeds']),
    referralFee: parseMoney(raw['Referral Fee including VAT']),
    fulfillmentFee: parseMoney(raw['Fullfilment & Logistics Fees including VAT']),
    shippingCredits: parseMoney(raw['Shipping Credits including VAT']),
    otherOrderFees: parseMoney(raw['Other Order Fees including VAT']),
    orderSubsidies: parseMoney(raw['Order Subsidies including VAT']),
    total: parseMoney(raw.Total),
    rawRow: raw,
    lastSyncedAt,
  }
}

/**
 * Fetch and cache Noon's per-order money for every settlement statement issued in the window.
 *
 * The window is the settlement (transaction) date, not the order date: Noon publishes an order's
 * proceeds and fees only when it lands in a statement, which is days after the order. The report
 * therefore joins these rows to orders by order number.
 *
 * @param {{ fromYmd: string, toYmd: string, sleepFn?: (ms: number) => Promise<void> }} opts
 */
async function syncNoonFinance({ fromYmd, toYmd, sleepFn }) {
  assertNoonConfigured()
  const from = ymd(fromYmd)
  const to = ymd(toYmd)
  await store.ensureNoonOrderTables()
  const runId = await store.insertExportRun({
    exportCategoryCode: FINANCE_EXPORT_CATEGORY,
    fromDate: from,
    toDate: to,
    status: 'running',
  })

  try {
    const { exportCode, pollCount, rows } = await runExport({
      exportCategoryCode: FINANCE_EXPORT_CATEGORY,
      params: { from_date: from, to_date: to },
      sleepFn,
    })
    const now = new Date()
    let saved = 0
    const orderNumbers = new Set()
    for (const raw of rows) {
      const mapped = mapFinanceRow(raw, now)
      if (!mapped) continue
      await store.upsertNoonFinanceRow(mapped)
      saved += 1
      orderNumbers.add(mapped.orderNr)
    }
    await store.updateExportRun(runId, {
      exportCode,
      status: 'success',
      rowsParsed: rows.length,
      rowsSaved: saved,
      pollCount,
      finishedAt: new Date(),
    })
    return {
      exportCategoryCode: FINANCE_EXPORT_CATEGORY,
      exportCode,
      fromDate: from,
      toDate: to,
      pollCount,
      rowsParsed: rows.length,
      rowsSaved: saved,
      ordersWithMoney: orderNumbers.size,
    }
  } catch (err) {
    await store.updateExportRun(runId, {
      status: 'failed',
      errorMessage: err && err.message ? String(err.message).slice(0, 500) : 'noon_export_failed',
      pollCount: err?.pollCount ?? null,
      finishedAt: new Date(),
    })
    throw err
  }
}

module.exports = {
  syncNoonOrders,
  syncNoonFinance,
  mapFinanceRow,
  runExport,
  parseCsv,
  parseNoonTimestamp,
  mapOrderRow,
  ORDERS_EXPORT_CATEGORY,
  FINANCE_EXPORT_CATEGORY,
}

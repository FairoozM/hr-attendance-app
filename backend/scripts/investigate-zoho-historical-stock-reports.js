#!/usr/bin/env node
/**
 * Controlled probe for Zoho Inventory historical stock / valuation report endpoints.
 *
 * This is an investigation-only script. It does not wire anything into production routes.
 *
 * Usage:
 *   node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-17
 *   node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-17 --warehouse-id 123456789
 *   node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-17 --limit 10
 *   node backend/scripts/investigate-zoho-historical-stock-reports.js --date 2026-05-17 --limit 10 --pages 2
 */
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { zohoInventoryJsonRequest } = require('../src/services/zohoApiClient')
const { pool } = require('../src/db')

const DOC_PATH = path.resolve(__dirname, '../../docs/zoho-historical-stock-api-investigation.md')
const ENDPOINT = '/inventory/v1/reports/inventoryvaluation'
const VALUE_FIELD_RE = /(value|valuation|amount|asset|total)/i
const STOCK_FIELD_RE = /(stock|on_hand|onhand|available|quantity|qty|balance)/i

function argValue(name, fallback) {
  const args = process.argv.slice(2)
  const prefix = `--${name}=`
  const withEquals = args.find((arg) => String(arg).startsWith(prefix))
  if (withEquals) return String(withEquals).slice(prefix.length).trim() || fallback
  const idx = args.findIndex((arg) => String(arg) === `--${name}`)
  if (idx >= 0 && args[idx + 1] && !String(args[idx + 1]).startsWith('--')) {
    return String(args[idx + 1]).trim() || fallback
  }
  return fallback
}

function isoDateLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const probeDate = argValue('date', isoDateLocal())
const warehouseId = argValue('warehouse-id', '')
const limit = Math.max(1, Math.min(50, parseInt(argValue('limit', '5'), 10) || 5))
const pages = Math.max(1, Math.min(5, parseInt(argValue('pages', '1'), 10) || 1))

function buildParams(page) {
  const p = new URLSearchParams()
  p.set('page', String(page))
  p.set('per_page', String(limit))
  p.set('date', probeDate)
  if (warehouseId) p.set('warehouse_id', warehouseId)
  return p
}

function firstArrayFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return []
  const direct = payload.inventory_valuation
  if (Array.isArray(direct)) {
    const nestedItems = direct.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      if (Array.isArray(row.item_details)) return row.item_details
      return []
    })
    return nestedItems.length > 0 ? nestedItems : direct
  }
  const firstArray = Object.values(payload).find((v) => Array.isArray(v))
  return Array.isArray(firstArray) ? firstArray : []
}

function flattenObject(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object') return out
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => flattenObject(item, prefix ? `${prefix}.${index}` : String(index), out))
    return out
  }
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flattenObject(value, nextKey, out)
    else out[nextKey] = value
  }
  return out
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return null
  const n = parseFloat(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function detectFields(rows, regex) {
  const found = new Set()
  for (const row of rows) {
    const flat = flattenObject(row)
    for (const key of Object.keys(flat)) {
      if (regex.test(key)) found.add(key)
    }
  }
  return [...found].sort()
}

function valueForFields(row, fields) {
  const flat = flattenObject(row)
  for (const field of fields) {
    const n = numberValue(flat[field])
    if (n != null) return n
  }
  return null
}

function pickText(row, candidates) {
  const flat = flattenObject(row)
  for (const key of candidates) {
    if (flat[key] != null && String(flat[key]).trim() !== '') return String(flat[key]).trim()
  }
  const lowerEntries = Object.entries(flat)
  for (const [key, value] of lowerEntries) {
    const keyLower = key.toLowerCase()
    if (candidates.some((candidate) => keyLower.endsWith(candidate.toLowerCase())) && value != null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

function sampleRows(rows, valueFields, stockFields) {
  return rows.slice(0, Math.min(10, rows.length)).map((row, index) => ({
    index: index + 1,
    item_name: pickText(row, ['name', 'item_name']),
    sku: pickText(row, ['sku']),
    item_id: pickText(row, ['item_id']),
    value_amount: valueForFields(row, valueFields),
    stock_on_hand_amount: valueForFields(row, stockFields),
  }))
}

function safeMarkdownCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
}

async function fetchProbePages() {
  const payloads = []
  const rows = []
  for (let page = 1; page <= pages; page += 1) {
    const params = buildParams(page)
    console.log(`[zoho-historical-stock-probe] ${ENDPOINT} date=${probeDate} page=${page} limit=${limit}`)
    // eslint-disable-next-line no-await-in-loop
    const payload = await zohoInventoryJsonRequest(ENDPOINT, params, 'GET', undefined, {
      critical: false,
      skipCache: true,
      source: 'historical_stock_api_investigation',
      cacheCategory: 'default',
    })
    payloads.push(payload)
    rows.push(...firstArrayFromPayload(payload))
  }
  return { payloads, rows }
}

function summarizeProbe(payloads, rows) {
  const rawTopLevelKeys = payloads[0] && typeof payloads[0] === 'object' ? Object.keys(payloads[0]) : []
  const rawFirstRowKeys = rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : []
  const valueFields = detectFields(rows, VALUE_FIELD_RE)
  const stockFields = detectFields(rows, STOCK_FIELD_RE)
  const totalValueSum = rows.reduce((sum, row) => {
    const n = valueForFields(row, valueFields)
    return n == null ? sum : sum + n
  }, 0)
  const hasAnyValue = rows.some((row) => valueForFields(row, valueFields) != null)
  return {
    endpoint: ENDPOINT,
    dateParamUsed: 'date',
    date: probeDate,
    warehouseId: warehouseId || null,
    pages,
    limit,
    rowCount: rows.length,
    detectedValueFields: valueFields,
    detectedStockOnHandFields: stockFields,
    firstRows: sampleRows(rows, valueFields, stockFields),
    totalValueSum: hasAnyValue ? Math.round(totalValueSum * 100) / 100 : null,
    rawTopLevelKeys,
    rawFirstRowKeys,
  }
}

function renderConsoleSummary(summary) {
  console.log('\nInventory Valuation Probe Summary')
  console.log('Endpoint:', summary.endpoint)
  console.log('Date param used:', `${summary.dateParamUsed}=${summary.date}`)
  console.log('Warehouse:', summary.warehouseId || 'not requested')
  console.log('Rows returned:', summary.rowCount)
  console.log('Detected value fields:', summary.detectedValueFields.join(', ') || 'none')
  console.log('Detected stock/on-hand fields:', summary.detectedStockOnHandFields.join(', ') || 'none')
  console.log('Total value sum:', summary.totalValueSum == null ? 'not available' : summary.totalValueSum)
  console.log('Raw top-level keys:', summary.rawTopLevelKeys.join(', ') || 'none')
  console.log('Raw first row keys:', summary.rawFirstRowKeys.join(', ') || 'none')
  console.table(summary.firstRows)
}

function renderMarkdown(summary) {
  const lines = []
  lines.push('# Zoho Historical Stock API Investigation')
  lines.push('')
  lines.push(`Generated at: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Probe Limits')
  lines.push('')
  lines.push(`- Endpoint: \`${summary.endpoint}\``)
  lines.push(`- Date param used: \`${summary.dateParamUsed}=${summary.date}\``)
  lines.push(`- Warehouse filter: ${summary.warehouseId || 'not requested'}`)
  lines.push(`- Pages requested: ${summary.pages}`)
  lines.push(`- Per-page limit: ${summary.limit}`)
  lines.push('- Client: existing `zohoInventoryJsonRequest` with app guardrails, usage logging, and OAuth')
  lines.push('')
  lines.push('## Inventory Valuation Summary')
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|---|---|')
  lines.push(`| endpoint | \`${summary.endpoint}\` |`)
  lines.push(`| date param used | \`${summary.dateParamUsed}=${summary.date}\` |`)
  lines.push(`| row count | ${summary.rowCount} |`)
  lines.push(`| detected value fields | ${safeMarkdownCell(summary.detectedValueFields.join(', ') || 'none')} |`)
  lines.push(`| detected stock/on-hand fields | ${safeMarkdownCell(summary.detectedStockOnHandFields.join(', ') || 'none')} |`)
  lines.push(`| total value sum from returned rows | ${summary.totalValueSum == null ? 'not available' : summary.totalValueSum} |`)
  lines.push(`| raw top-level keys | ${safeMarkdownCell(summary.rawTopLevelKeys.join(', ') || 'none')} |`)
  lines.push(`| raw first row keys | ${safeMarkdownCell(summary.rawFirstRowKeys.join(', ') || 'none')} |`)
  lines.push('')
  lines.push('## First Returned Item Rows')
  lines.push('')
  lines.push('| # | Item name | SKU | Item id | Value amount | Stock/on-hand amount |')
  lines.push('|---|---|---|---|---:|---:|')
  for (const row of summary.firstRows) {
    lines.push(`| ${row.index} | ${safeMarkdownCell(row.item_name || '—')} | ${safeMarkdownCell(row.sku || '—')} | ${safeMarkdownCell(row.item_id || '—')} | ${row.value_amount == null ? '—' : row.value_amount} | ${row.stock_on_hand_amount == null ? '—' : row.stock_on_hand_amount} |`)
  }
  lines.push('')
  lines.push('## Recommendation')
  lines.push('')
  if (summary.detectedValueFields.length > 0) {
    lines.push('- `inventoryvaluation` is reachable and returns value-like fields in this org.')
    lines.push('- This output should be compared manually against the Zoho UI Inventory Valuation report for the same date and optional warehouse before production calculations change.')
  } else {
    lines.push('- This probe did not find value-like fields in the returned rows; continue treating Weekly Sales stock value as reconstructed/current-live until Zoho confirms an exact report endpoint.')
  }
  lines.push('- Historical/as-of behavior is not proven by API success alone; verify that changing `--date` changes totals as expected and matches Zoho UI.')
  lines.push('')
  return lines.join('\n')
}

function readExistingComparisonSection() {
  if (!fs.existsSync(DOC_PATH)) return ''
  const existing = fs.readFileSync(DOC_PATH, 'utf8')
  const marker = '\n## Comparison Runs\n'
  const idx = existing.indexOf(marker)
  return idx >= 0 ? existing.slice(idx) : ''
}

function renderComparisonRun(summary) {
  const lines = []
  lines.push(`### ${summary.date}${summary.warehouseId ? ` warehouse ${summary.warehouseId}` : ' all warehouses'}`)
  lines.push('')
  lines.push(`Command: \`node backend/scripts/investigate-zoho-historical-stock-reports.js --date ${summary.date}${summary.warehouseId ? ` --warehouse-id ${summary.warehouseId}` : ''} --limit ${summary.limit}${summary.pages !== 1 ? ` --pages ${summary.pages}` : ''}\``)
  lines.push('')
  lines.push(`- Row count: ${summary.rowCount}`)
  lines.push(`- Total value sum from returned rows: ${summary.totalValueSum == null ? 'not available' : summary.totalValueSum}`)
  lines.push(`- Detected value fields: ${summary.detectedValueFields.join(', ') || 'none'}`)
  lines.push(`- Detected stock/on-hand fields: ${summary.detectedStockOnHandFields.join(', ') || 'none'}`)
  lines.push('')
  lines.push('| # | Item name | SKU | Item id | Asset/value | Quantity available |')
  lines.push('|---|---|---|---|---:|---:|')
  for (const row of summary.firstRows) {
    lines.push(`| ${row.index} | ${safeMarkdownCell(row.item_name || '—')} | ${safeMarkdownCell(row.sku || '—')} | ${safeMarkdownCell(row.item_id || '—')} | ${row.value_amount == null ? '—' : row.value_amount} | ${row.stock_on_hand_amount == null ? '—' : row.stock_on_hand_amount} |`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { payloads, rows } = await fetchProbePages()
  const summary = summarizeProbe(payloads, rows)
  renderConsoleSummary(summary)
  const existingComparison = readExistingComparisonSection()
  const comparisonHeader = existingComparison || '\n## Comparison Runs\n\n'
  const markdown = `${renderMarkdown(summary)}${comparisonHeader}${renderComparisonRun(summary)}`
  fs.writeFileSync(DOC_PATH, markdown)
  console.log(JSON.stringify({
    ok: true,
    endpoint: ENDPOINT,
    date: probeDate,
    warehouseId: warehouseId || null,
    pages,
    limit,
    rowCount: summary.rowCount,
    detectedValueFields: summary.detectedValueFields,
    detectedStockOnHandFields: summary.detectedStockOnHandFields,
    totalValueSum: summary.totalValueSum,
    docsPath: DOC_PATH,
  }, null, 2))
}

main()
  .catch((err) => {
    console.error('FAILED:', err && err.message ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })

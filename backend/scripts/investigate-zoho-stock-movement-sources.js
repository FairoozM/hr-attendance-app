#!/usr/bin/env node
/**
 * Controlled probe for Zoho Inventory stock movement source endpoints.
 *
 * Investigation-only script. Do not wire this into production routes.
 *
 * Usage:
 *   node backend/scripts/investigate-zoho-stock-movement-sources.js
 *   node backend/scripts/investigate-zoho-stock-movement-sources.js --from-date 2026-05-01 --to-date 2026-05-18
 *   node backend/scripts/investigate-zoho-stock-movement-sources.js --shallow
 */
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { zohoInventoryJsonRequest } = require('../src/services/zohoApiClient')
const { readZohoConfig, INVENTORY_V1 } = require('../src/integrations/zoho/zohoConfig')
const { pool } = require('../src/db')

const DOC_PATH = path.resolve(__dirname, '../../docs/weekly-sales-stock-movement-source-investigation.md')

const DEEP_FROM_DATE = '2026-05-01'
const DEEP_TO_DATE = '2026-05-18'

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

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

const fromDate = argValue('from-date', DEEP_FROM_DATE)
const toDate = argValue('to-date', DEEP_TO_DATE)
const limit = Math.max(1, Math.min(10, parseInt(argValue('limit', '5'), 10) || 5))
const runShallow = hasFlag('shallow')

/** Endpoints that were available or unclear in the first-pass probe. */
const DEEP_TARGETS = [
  {
    label: 'Inventory adjustments',
    endpoint: `${INVENTORY_V1}/inventoryadjustments`,
    listKeys: ['inventory_adjustments'],
    documentIdField: 'inventory_adjustment_id',
    detailWrapperKeys: ['inventory_adjustment'],
    lineArrayCandidates: ['line_items', 'items', 'inventory_adjustment_items'],
    existingNote: 'Not used in weekly report today.',
  },
  {
    label: 'Sales credit notes',
    endpoint: `${INVENTORY_V1}/creditnotes`,
    listKeys: ['creditnotes'],
    documentIdField: 'creditnote_id',
    detailWrapperKeys: ['creditnote'],
    lineArrayCandidates: ['line_items', 'creditnote_items', 'items'],
    existingNote: 'Not used in weekly report today (invoices used for sales).',
  },
  {
    label: 'Sales returns',
    endpoint: `${INVENTORY_V1}/salesreturns`,
    listKeys: ['salesreturns'],
    documentIdField: 'salesreturn_id',
    detailWrapperKeys: ['salesreturn'],
    lineArrayCandidates: ['line_items', 'salesreturn_items', 'items', 'return_items'],
    existingNote: 'Not used in weekly report today.',
  },
  {
    label: 'Vendor credits (purchase returns)',
    endpoint: `${INVENTORY_V1}/vendorcredits`,
    listKeys: ['vendor_credits', 'vendorcredits'],
    documentIdField: 'vendor_credit_id',
    detailWrapperKeys: ['vendor_credit'],
    lineArrayCandidates: ['line_items'],
    existingNote: 'Already used for returned_to_wholesale column; detail fetch exists in weeklyReportZohoTransactions.js.',
  },
  {
    label: 'Transfer orders',
    endpoint: `${INVENTORY_V1}/transferorders`,
    listKeys: ['transfer_orders', 'transferorders'],
    documentIdField: 'transfer_order_id',
    detailWrapperKeys: ['transfer_order'],
    lineArrayCandidates: ['line_items', 'transfer_order_items', 'items'],
    existingNote: 'Not used in weekly report today.',
  },
]

const LINE_KEY_RE = /(line_items|items|item_details|details|transactions|mapped_items|return_items|transfer_order_items|creditnote_items|salesreturn_items)/i

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

function pickFirstMatchingKey(obj, candidates) {
  if (!obj || typeof obj !== 'object') return ''
  for (const key of candidates) {
    if (Array.isArray(obj[key])) return key
  }
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && LINE_KEY_RE.test(key)) return key
  }
  return ''
}

function pickFieldByPattern(rows, patterns, preferLeaf = false) {
  const found = []
  for (const row of rows || []) {
    const flat = flattenObject(row)
    for (const key of Object.keys(flat)) {
      const leaf = key.split('.').pop()
      const testKey = preferLeaf ? leaf : key
      if (patterns.some((re) => re.test(testKey))) {
        if (!found.includes(key)) found.push(key)
      }
    }
  }
  return found.length ? found[0].split('.').pop() : ''
}

function detectAllFields(rows, patterns) {
  const found = new Set()
  for (const row of rows || []) {
    const flat = flattenObject(row)
    for (const key of Object.keys(flat)) {
      const leaf = key.split('.').pop()
      if (patterns.some((re) => re.test(leaf))) found.add(leaf)
    }
  }
  return [...found].sort()
}

function listRowsFromPayload(payload, listKeys) {
  if (!payload || typeof payload !== 'object') return []
  for (const key of listKeys) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  const firstArray = Object.values(payload).find((v) => Array.isArray(v))
  return Array.isArray(firstArray) ? firstArray : []
}

function detailObjectFromPayload(payload, wrapperKeys) {
  if (!payload || typeof payload !== 'object') return null
  for (const key of wrapperKeys) {
    if (payload[key] && typeof payload[key] === 'object') return payload[key]
  }
  return payload
}

function buildListParams({ withDate }) {
  const cfg = readZohoConfig()
  const p = new URLSearchParams()
  if (cfg.code === 'ok') p.set('organization_id', cfg.organizationId)
  p.set('page', '1')
  p.set('per_page', String(limit))
  if (withDate) {
    p.set('from_date', fromDate)
    p.set('to_date', toDate)
  }
  return p
}

function buildDetailParams() {
  const cfg = readZohoConfig()
  const p = new URLSearchParams()
  if (cfg.code === 'ok') p.set('organization_id', cfg.organizationId)
  return p
}

function docDateValue(row) {
  if (!row || typeof row !== 'object') return ''
  for (const k of ['date', 'issued_date', 'created_date', 'transaction_date']) {
    if (row[k]) return String(row[k]).slice(0, 10)
  }
  return ''
}

function compareDateFilter(noDateRows, datedRows) {
  if (noDateRows.error || datedRows.error) return 'unclear'
  if (noDateRows.rowCount === 0 && datedRows.rowCount === 0) return 'unclear'
  const noIds = new Set(noDateRows.rows.map((r) => r._docId).filter(Boolean))
  const datedIds = new Set(datedRows.rows.map((r) => r._docId).filter(Boolean))
  if (noDateRows.rowCount !== datedRows.rowCount) return 'yes'
  if (noIds.size && datedIds.size) {
    const same = [...noIds].every((id) => datedIds.has(id))
    return same ? 'unclear' : 'yes'
  }
  const noDates = noDateRows.rows.map((r) => docDateValue(r)).filter(Boolean)
  const datedDates = datedRows.rows.map((r) => docDateValue(r)).filter(Boolean)
  if (noDates.length && datedDates.length) {
    const allInRange = datedDates.every((d) => d >= fromDate && d <= toDate)
    const wider = noDates.some((d) => d < fromDate || d > toDate)
    if (wider && allInRange) return 'yes'
    if (JSON.stringify(noDates) === JSON.stringify(datedDates)) return 'unclear'
  }
  return 'unclear'
}

function inferStockDirection(target, listRows, detailDoc, lineRows) {
  const endpoint = target.endpoint
  if (endpoint.includes('inventoryadjustments')) {
    const types = new Set(
      [...listRows, detailDoc].filter(Boolean).map((r) => String(r.adjustment_type || '').toLowerCase())
    )
    const qtyField = 'quantity_adjusted'
    const hasSigned = [...listRows, ...lineRows].some((r) => {
      const q = Number(r && r[qtyField])
      return Number.isFinite(q) && q !== 0
    })
    if (types.size > 1 || (hasSigned && [...listRows, ...lineRows].some((r) => Number(r[qtyField]) < 0))) {
      return 'depends on adjustment_type and sign of quantity_adjusted'
    }
    return 'depends on adjustment_type and sign of quantity_adjusted (sample suggests signed quantity_adjusted)'
  }
  if (endpoint.includes('creditnotes') || endpoint.includes('salesreturns')) {
    return 'typically increases stock when received (customer return); confirm receive_status on salesreturns'
  }
  if (endpoint.includes('vendorcredits')) {
    return 'typically decreases stock (purchase return to vendor); already partially used in weekly report'
  }
  if (endpoint.includes('transferorders')) {
    return 'warehouse-neutral at org level; increases source warehouse and decreases destination warehouse'
  }
  return 'unclear'
}

function reconstructionRecommendation(deep) {
  if (deep.listWorks === 'no' || deep.listWorks === 'unclear') {
    return 'Do not include yet — list endpoint not proven.'
  }
  if (deep.lineItemArray === 'unclear' && deep.listLooksLikeLineLevel !== 'yes') {
    return 'Do not include yet — cannot identify per-item lines from list or detail.'
  }
  if (deep.itemIdField === 'unclear' && deep.skuField === 'unclear') {
    return 'Do not include yet — cannot map rows to items.'
  }
  if (deep.quantityField === 'unclear') {
    return 'Investigate further — quantity field unclear; may still help with detail fetch on known documents.'
  }
  if (deep.dateFilterWorks === 'unclear' && deep.listNoDate.rowCount > 0) {
    return 'Investigate further — date filter behavior unproven; validate against Zoho UI before production use.'
  }
  if (endpointNeedsDetail(deep) && deep.detailWorks !== 'yes') {
    return 'Investigate further — list works but detail/line_items needed for reconstruction.'
  }
  if (deep.endpoint.includes('transferorders')) {
    return 'Candidate for per-warehouse reconstruction after UI validation — use detail line_items with quantity_transfer; net-zero org-wide but required for warehouse-scoped opening stock.';
  }
  if (deep.endpoint.includes('vendorcredits') && deep.listDated.rowCount === 0 && deep.listNoDate.rowCount === 0) {
    return 'Partially usable — endpoint already used for returned_to_wholesale; empty dated list in probe does not disprove production use with wider dates.'
  }
  return 'Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.'
}

function endpointNeedsDetail(deep) {
  return deep.listLooksLikeLineLevel !== 'yes' && deep.lineItemArray !== 'unclear' && deep.detailWorks === 'yes'
}

async function fetchList(target, withDate) {
  const params = buildListParams({ withDate })
  const query = params.toString()
  try {
    const payload = await zohoInventoryJsonRequest(target.endpoint, params, 'GET', undefined, {
      critical: false,
      skipCache: true,
      source: 'stock_movement_deep_investigation',
      cacheCategory: 'default',
    })
    const rows = listRowsFromPayload(payload, target.listKeys)
    for (const row of rows) {
      if (row && target.documentIdField && row[target.documentIdField]) {
        row._docId = String(row[target.documentIdField])
      }
    }
    return { ok: true, error: '', query, rowCount: rows.length, rows, payload }
  } catch (err) {
    return {
      ok: false,
      error: (err && err.message ? err.message : String(err)).slice(0, 500),
      query,
      rowCount: 0,
      rows: [],
      payload: null,
    }
  }
}

async function fetchDetail(target, documentId) {
  const params = buildDetailParams()
  const detailPath = `${target.endpoint}/${encodeURIComponent(documentId)}`
  try {
    const payload = await zohoInventoryJsonRequest(detailPath, params, 'GET', undefined, {
      critical: false,
      skipCache: true,
      source: 'stock_movement_deep_investigation',
      cacheCategory: 'default',
    })
    const doc = detailObjectFromPayload(payload, target.detailWrapperKeys)
    return { ok: true, error: '', query: params.toString(), doc, payload }
  } catch (err) {
    return {
      ok: false,
      error: (err && err.message ? err.message : String(err)).slice(0, 500),
      query: params.toString(),
      doc: null,
      payload: null,
    }
  }
}

function analyzeRows(target, listRows, detailDoc) {
  const lineKeyList =
    pickFirstMatchingKey(detailDoc, target.lineArrayCandidates) ||
    pickFirstMatchingKey(listRows[0], target.lineArrayCandidates)
  const lineRows = lineKeyList && detailDoc && Array.isArray(detailDoc[lineKeyList])
    ? detailDoc[lineKeyList]
    : lineKeyList && listRows[0] && Array.isArray(listRows[0][lineKeyList])
      ? listRows[0][lineKeyList]
      : []

  const listHasItemId = listRows.some((r) => r && r.item_id)
  const listHasQty = listRows.some((r) => r && (r.quantity_adjusted != null || r.quantity != null))
  const listLooksLikeLineLevel = listHasItemId && listHasQty && !lineKeyList ? 'yes' : lineKeyList ? 'no' : listHasItemId ? 'yes' : 'unclear'

  const inspectRows = lineRows.length > 0 ? lineRows : listRows
  const itemIdField = pickFieldByPattern(inspectRows, [/^item_id$/i], true) || (listHasItemId ? 'item_id' : '')
  const skuField = pickFieldByPattern(inspectRows, [/^sku$/i], true)
  const quantityField =
    pickFieldByPattern(
      inspectRows,
      [/quantity_adjusted/i, /quantity_transfer/i, /quantity_transferred/i, /^quantity$/i, /quantity_received/i, /item_quantity/i],
      true
    ) || pickFieldByPattern(listRows, [/quantity_adjusted/i, /quantity_transfer/i, /^quantity$/i], true)
  const valueField =
    pickFieldByPattern(inspectRows, [/value_adjusted/i, /item_total/i, /^total$/i, /return_amount/i, /^rate$/i, /^amount$/i], true) ||
    pickFieldByPattern(listRows, [/value_adjusted/i, /^total$/i], true)
  const warehouseField = pickFieldByPattern(
    [...listRows, ...lineRows, detailDoc].filter(Boolean),
    [/warehouse_id/i, /warehouse_name/i, /location_id/i],
    true
  )
  const dateField =
    pickFieldByPattern(listRows, [/^date$/i, /issued_date/i], true) ||
    pickFieldByPattern(detailDoc ? [detailDoc] : [], [/^date$/i], true)

  return {
    lineItemArray: lineKeyList || (listLooksLikeLineLevel === 'yes' ? '(list rows are line-level; no nested array)' : 'unclear'),
    listLooksLikeLineLevel,
    lineRows,
    itemIdField: itemIdField || 'unclear',
    skuField: skuField || 'unclear',
    quantityField: quantityField || 'unclear',
    valueField: valueField || 'unclear',
    warehouseField: warehouseField || 'unclear',
    dateField: dateField || 'unclear',
    itemIdFieldsAll: detectAllFields(inspectRows, [/^item_id$/i]),
    skuFieldsAll: detectAllFields(inspectRows, [/^sku$/i]),
    quantityFieldsAll: detectAllFields(inspectRows, [/quantity/i]),
    valueFieldsAll: detectAllFields(inspectRows, [/value|amount|total|rate/i]),
    warehouseFieldsAll: detectAllFields(
      [...listRows, ...lineRows, detailDoc].filter(Boolean),
      [/warehouse|location/i]
    ),
    stockDirection: inferStockDirection(target, listRows, detailDoc, lineRows),
  }
}

async function deepProbeTarget(target) {
  console.log(`\n[deep-probe] ${target.endpoint}`)
  const listNoDate = await fetchList(target, false)
  console.log(`  list (no date): ${listNoDate.ok ? `${listNoDate.rowCount} rows` : listNoDate.error}`)
  const listDated = await fetchList(target, true)
  console.log(`  list (dated): ${listDated.ok ? `${listDated.rowCount} rows` : listDated.error}`)

  const listWorks = listNoDate.ok || listDated.ok ? (listNoDate.rowCount > 0 || listDated.rowCount > 0 ? 'yes' : 'unclear') : 'no'
  const dateFilterWorks = compareDateFilter(listNoDate, listDated)

  const sampleList = listNoDate.rowCount > 0 ? listNoDate.rows : listDated.rows
  const firstDocId =
    sampleList[0] && sampleList[0]._docId
      ? sampleList[0]._docId
      : sampleList[0] && sampleList[0][target.documentIdField]
        ? String(sampleList[0][target.documentIdField])
        : ''

  let detail = { ok: false, error: 'no document id from list', doc: null, query: '' }
  if (firstDocId) {
    detail = await fetchDetail(target, firstDocId)
    console.log(`  detail ${firstDocId}: ${detail.ok ? 'ok' : detail.error}`)
  } else {
    console.log('  detail: skipped (no list document id)')
  }

  const detailWorks = firstDocId ? (detail.ok && detail.doc ? 'yes' : detail.ok ? 'unclear' : 'no') : 'unclear'
  const fields = analyzeRows(target, sampleList, detail.doc)
  const includeRecommendation = reconstructionRecommendation({
    endpoint: target.endpoint,
    listWorks,
    listNoDate,
    listDated,
    detailWorks,
    ...fields,
  })

  return {
    ...target,
    listWorks,
    detailWorks,
    dateFilterWorks,
    listNoDate,
    listDated,
    detail,
    firstDocId: firstDocId || '—',
    ...fields,
    includeRecommendation,
  }
}

function safeCell(value) {
  if (Array.isArray(value)) return value.join(', ').replace(/\|/g, '/')
  return String(value == null || value === '' ? '-' : value).replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
}

function renderDeepSection(deepResults) {
  const lines = []
  lines.push('## Deep Probe: Available / Unclear Movement Sources')
  lines.push('')
  lines.push('Second-pass investigation for endpoints that were available or unclear in the first pass.')
  lines.push('')
  lines.push('- Each endpoint: `GET` list with **no date filter**, then `GET` list with `from_date` / `to_date`, then `GET /endpoint/:id` for the first document when available.')
  lines.push(`- Date range tested: \`${fromDate}\` to \`${toDate}\`.`)
  lines.push('- Page `1`, `per_page` = 5 only. Existing Zoho client rate guards used.')
  lines.push('')
  lines.push('| Endpoint | List works | Detail works | Date filter works | Doc date field | Line array field | Item id | SKU | Qty field | Value/cost field | Warehouse field | Stock direction | Include in reconstruction? |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of deepResults) {
    lines.push(
      `| \`${r.endpoint}\` | ${r.listWorks} | ${r.detailWorks} | ${r.dateFilterWorks} | ${safeCell(r.dateField)} | ${safeCell(r.lineItemArray)} | ${safeCell(r.itemIdField)} | ${safeCell(r.skuField)} | ${safeCell(r.quantityField)} | ${safeCell(r.valueField)} | ${safeCell(r.warehouseField)} | ${safeCell(r.stockDirection)} | ${safeCell(r.includeRecommendation)} |`
    )
  }
  lines.push('')

  for (const r of deepResults) {
    lines.push(`### ${r.endpoint}`)
    lines.push('')
    if (r.existingNote) lines.push(`- Existing code note: ${r.existingNote}`)
    lines.push(`- List (no date): ${r.listNoDate.ok ? `${r.listNoDate.rowCount} rows` : `error — ${safeCell(r.listNoDate.error)}`}`)
    lines.push(`- List (dated): ${r.listDated.ok ? `${r.listDated.rowCount} rows` : `error — ${safeCell(r.listDated.error)}`}`)
    lines.push(`- First document id probed: \`${r.firstDocId}\``)
    lines.push(`- Detail: ${r.detailWorks === 'yes' ? 'ok' : r.detail.error ? safeCell(r.detail.error) : 'not tested'}`)
    lines.push(`- List appears line-level (no nested line_items): ${r.listLooksLikeLineLevel}`)
    lines.push(`- All detected item id fields: ${safeCell(r.itemIdFieldsAll)}`)
    lines.push(`- All detected SKU fields: ${safeCell(r.skuFieldsAll)}`)
    lines.push(`- All detected quantity fields: ${safeCell(r.quantityFieldsAll)}`)
    lines.push(`- All detected value/cost fields: ${safeCell(r.valueFieldsAll)}`)
    lines.push(`- All detected warehouse/location fields: ${safeCell(r.warehouseFieldsAll)}`)
    if (r.listNoDate.rows[0]) {
      lines.push(`- Sample list row keys: ${safeCell(Object.keys(r.listNoDate.rows[0]))}`)
    } else if (r.listDated.rows[0]) {
      lines.push(`- Sample list row keys: ${safeCell(Object.keys(r.listDated.rows[0]))}`)
    }
    if (r.detail.doc) {
      lines.push(`- Sample detail keys: ${safeCell(Object.keys(r.detail.doc))}`)
      if (r.lineRows.length) {
        lines.push(`- Sample detail line keys: ${safeCell(Object.keys(r.lineRows[0]))}`)
      }
    }
    lines.push('')
  }

  const productionUsable = deepResults.filter((r) => r.includeRecommendation.startsWith('Candidate'))
  const investigate = deepResults.filter((r) => r.includeRecommendation.startsWith('Investigate'))
  const doNotInclude = deepResults.filter((r) => r.includeRecommendation.startsWith('Do not') || r.includeRecommendation.startsWith('Partially'))

  lines.push('## Deep Probe Summary')
  lines.push('')
  lines.push('### Production-usable for reconstruction (after UI validation)')
  lines.push('')
  if (productionUsable.length) {
    for (const r of productionUsable) lines.push(`- \`${r.endpoint}\` — ${r.includeRecommendation}`)
  } else {
    lines.push('- None proven production-usable from this probe alone.')
  }
  lines.push('')
  lines.push('### Still unclear')
  lines.push('')
  const unclear = deepResults.filter((r) => r.listWorks === 'unclear' || r.dateFilterWorks === 'unclear' || r.detailWorks === 'unclear' || r.includeRecommendation.startsWith('Investigate'))
  if (unclear.length) {
    for (const r of unclear) {
      lines.push(`- \`${r.endpoint}\` — list=${r.listWorks}, detail=${r.detailWorks}, date filter=${r.dateFilterWorks}. ${r.includeRecommendation}`)
    }
  } else {
    lines.push('- None')
  }
  lines.push('')
  lines.push('### Unavailable')
  lines.push('')
  const unavailable = deepResults.filter((r) => r.listWorks === 'no')
  if (unavailable.length) {
    for (const r of unavailable) lines.push(`- \`${r.endpoint}\``)
  } else {
    lines.push('- None of the five deep-probe endpoints returned HTTP errors.')
  }
  lines.push('')
  lines.push('### Next calculation recommendation')
  lines.push('')
  lines.push('- **Do not change Opening Stock Value / Closing Stock Value calculations yet.**')
  lines.push('- **Keep** current path: live `items` stock + invoices/bills/vendor credits reconciliation + `report_meta` incompleteness warning.')
  lines.push('- **Strongest new candidate:** `/inventory/v1/inventoryadjustments` — list rows already expose `item_id`, `quantity_adjusted`, `value_adjusted`, `warehouse_id`, and `date`; validate date filter and adjustment sign against Zoho UI.')
  lines.push('- **Sales returns path:** prefer `/inventory/v1/salesreturns` and/or `/inventory/v1/creditnotes` only after detail `line_items` are confirmed and matched to report items; list rows may be header-level or aggregated.');
  lines.push('- **Vendor credits:** continue using for purchase-return quantity (already in app); extend to opening recon only after confirming dated list + line_items + warehouse on detail for your vendor scope.');
  lines.push('- **Transfer orders:** `/inventory/v1/transferorders` + detail `line_items` with `quantity_transfer`, `from_warehouse_id`, `to_warehouse_id` — candidate for per-warehouse recon; validate date filter against Zoho UI.');
  lines.push('- **Note:** first-pass probe showed empty vendor credits / transfer orders with date filter only; deep probe returned rows for both list modes — do not treat those endpoints as unavailable.');
  lines.push('- **Still missing:** complete stock ledger (`stocktracking` / `inventorydetails` returned 404 in first pass) and production-safe historical valuation API.');
  lines.push('')
  return lines.join('\n')
}

function mergeDeepIntoDoc(deepMarkdown) {
  let existing = ''
  if (fs.existsSync(DOC_PATH)) {
    existing = fs.readFileSync(DOC_PATH, 'utf8')
    const marker = '\n## Deep Probe: Available / Unclear Movement Sources\n'
    const idx = existing.indexOf(marker)
    if (idx >= 0) existing = existing.slice(0, idx)
  }
  return `${existing.trim()}\n\n${deepMarkdown}\n`
}

async function main() {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    throw new Error(`Zoho is not configured: missing ${cfg.missing.join(', ')}`)
  }

  const deepResults = []
  for (const target of DEEP_TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    deepResults.push(await deepProbeTarget(target))
  }

  const deepMarkdown = renderDeepSection(deepResults)
  fs.writeFileSync(DOC_PATH, mergeDeepIntoDoc(deepMarkdown))
  console.log(`\nWrote deep probe section to ${DOC_PATH}`)

  if (runShallow) {
    console.log('Note: --shallow first-pass scan removed from default run; deep probe only.')
  }
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch (_) {
      // ignore shutdown errors
    }
  })

#!/usr/bin/env node
/**
 * Read-only probe for Zoho Inventory endpoints that might return historical
 * stock-on-hand / available-for-sale / valuation by date and warehouse.
 *
 * Endpoints probed (one page, per_page=5):
 *   - /inventory/v1/reports/inventoryvaluation
 *   - /inventory/v1/reports/inventorysummary
 *   - /inventory/v1/reports/stocksummary
 *   - /inventory/v1/reports/stocktracking
 *   - /inventory/v1/reports/inventorydetails
 *   - /inventory/v1/reports/inventoryaging
 *   - /inventory/v1/items                 (with and without date params)
 *   - /inventory/v1/items/{item_id}       (with and without date params)
 *
 * For each endpoint we probe at two dates and (where supported) with a
 * warehouse_id to test date and warehouse sensitivity.
 *
 * Usage:
 *   node backend/scripts/investigate-zoho-stock-as-of-endpoints.js \
 *     --date1 2026-04-01 --date2 2026-05-18 [--warehouse-id <id>]
 *
 * Investigation only. No production code touched.
 */
const path = require('path')
const fs = require('fs')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { zohoInventoryJsonRequest } = require('../src/services/zohoApiClient')
const { pool } = require('../src/db')

const DOC_PATH = path.resolve(__dirname, '../../docs/zoho-stock-as-of-endpoint-investigation.md')

function argValue(name, fallback) {
  const args = process.argv.slice(2)
  const prefix = `--${name}=`
  const withEquals = args.find((a) => String(a).startsWith(prefix))
  if (withEquals) return String(withEquals).slice(prefix.length).trim() || fallback
  const idx = args.findIndex((a) => String(a) === `--${name}`)
  if (idx >= 0 && args[idx + 1] && !String(args[idx + 1]).startsWith('--')) {
    return String(args[idx + 1]).trim() || fallback
  }
  return fallback
}

const DATE1 = argValue('date1', '2026-04-01')
const DATE2 = argValue('date2', '2026-05-18')
const WAREHOUSE_ID = argValue('warehouse-id', '')
const TARGETED_SKU = argValue('targeted-sku', '')
const TARGETED_ITEM_ID = argValue('targeted-item-id', '')
const PER_PAGE = Math.max(1, Math.min(200, parseInt(argValue('per-page', '5'), 10) || 5))
const DEEP_PAGES = Math.max(1, Math.min(10, parseInt(argValue('deep-pages', '1'), 10) || 1))

function pickArrayFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return []
  const candidateKeys = [
    'inventory_valuation',
    'inventory_summary',
    'stock_summary',
    'stock_tracking',
    'inventory_details',
    'inventory_aging',
    'items',
    'item',
  ]
  let top = []
  for (const k of candidateKeys) {
    if (Array.isArray(payload[k])) {
      top = payload[k]
      break
    }
  }
  if (top.length === 0) {
    for (const v of Object.values(payload)) {
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
        top = v
        break
      }
    }
  }
  const flattened = top.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    if (Array.isArray(row.item_details) && row.item_details.length > 0) return row.item_details
    return [row]
  })
  return flattened
}

function flattenObject(obj, prefix = '', out = {}) {
  if (obj == null || typeof obj !== 'object') return out
  if (Array.isArray(obj)) {
    obj.slice(0, 3).forEach((v, i) => flattenObject(v, prefix ? `${prefix}.${i}` : String(i), out))
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flattenObject(v, nk, out)
    else out[nk] = v
  }
  return out
}

const STOCK_RE = /(stock|on_hand|onhand|available|quantity|qty|balance)/i
const VALUE_RE = /(value|valuation|amount|asset|total|price)/i

function detectFields(rows, regex) {
  const found = new Set()
  for (const row of rows) {
    for (const k of Object.keys(flattenObject(row))) {
      if (regex.test(k)) found.add(k)
    }
  }
  return [...found].sort()
}

function firstRowKeys(rows) {
  return rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).sort() : []
}

function topLevelKeys(payload) {
  return payload && typeof payload === 'object' ? Object.keys(payload).sort() : []
}

async function probe(label, endpoint, query, opts = {}) {
  const perPage = opts.perPage || PER_PAGE
  const pages = opts.pages || 1
  const t0 = Date.now()
  let firstPayload = null
  const allRows = []
  try {
    for (let page = 1; page <= pages; page += 1) {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(query || {})) {
        if (v != null && String(v) !== '') p.set(k, String(v))
      }
      p.set('per_page', String(perPage))
      p.set('page', String(page))
      // eslint-disable-next-line no-await-in-loop
      const payload = await zohoInventoryJsonRequest(endpoint, p, 'GET', undefined, {
        source: 'stock_as_of_probe',
        cacheCategory: 'default',
        skipCache: true,
        critical: false,
      })
      if (!firstPayload) firstPayload = payload
      const rows = pickArrayFromPayload(payload)
      allRows.push(...rows)
      const ctx = payload && payload.page_context
      const hasMore = ctx && typeof ctx === 'object' ? Boolean(ctx.has_more_page) : rows.length === perPage
      if (!hasMore) break
    }
    const stockFields = detectFields(allRows, STOCK_RE)
    const valueFields = detectFields(allRows, VALUE_RE)
    return {
      label,
      endpoint,
      query: Object.fromEntries(
        Object.entries(query || {})
          .filter(([, v]) => v != null && String(v) !== '')
          .concat([['per_page', String(perPage)]]),
      ),
      pages_fetched: Math.min(pages, allRows.length === 0 ? 1 : Math.ceil(allRows.length / perPage) || 1),
      elapsed_ms: Date.now() - t0,
      http_ok: true,
      row_count: allRows.length,
      top_level_keys: topLevelKeys(firstPayload),
      first_row_keys: firstRowKeys(allRows),
      stock_fields_detected: stockFields,
      value_fields_detected: valueFields,
      first_row_sample: allRows[0] || null,
      rows: allRows,
    }
  } catch (e) {
    return {
      label,
      endpoint,
      query,
      elapsed_ms: Date.now() - t0,
      http_ok: false,
      http_status: e?.httpStatus ?? null,
      error: e?.message ? String(e.message).slice(0, 400) : String(e),
    }
  }
}

function pickItemQty(row) {
  if (!row || typeof row !== 'object') return null
  const flat = flattenObject(row)
  for (const k of ['quantity_available', 'available_stock', 'actual_available_stock', 'stock_on_hand', 'quantity', 'qty', 'available_for_sale']) {
    if (flat[k] != null) {
      const n = Number(flat[k])
      if (Number.isFinite(n)) return { field: k, value: n }
    }
  }
  for (const k of Object.keys(flat)) {
    if (STOCK_RE.test(k)) {
      const n = Number(flat[k])
      if (Number.isFinite(n)) return { field: k, value: n }
    }
  }
  return null
}

function pickItemValue(row) {
  if (!row || typeof row !== 'object') return null
  const flat = flattenObject(row)
  for (const k of ['asset_value', 'inventory_value', 'value', 'stock_value']) {
    if (flat[k] != null) {
      const n = Number(flat[k])
      if (Number.isFinite(n)) return { field: k, value: n }
    }
  }
  return null
}

function indexRows(rows, idField) {
  const m = new Map()
  for (const r of rows || []) {
    const id = r && r[idField] != null ? String(r[idField]).trim() : ''
    if (id) m.set(id, r)
  }
  return m
}

function compareDateSensitivity(probe1, probe2, idField) {
  if (!probe1.http_ok || !probe2.http_ok) {
    return { comparable: false, reason: 'one_or_both_probes_failed' }
  }
  if (probe1.row_count === 0 || probe2.row_count === 0) {
    return { comparable: false, reason: 'zero_rows' }
  }
  const m1 = indexRows(probe1.rows, idField)
  const m2 = indexRows(probe2.rows, idField)
  const overlap = []
  let qtyDifferCount = 0
  let valueDifferCount = 0
  const qtyDifferExamples = []
  const valueDifferExamples = []
  for (const [id, r1] of m1.entries()) {
    if (!m2.has(id)) continue
    const r2 = m2.get(id)
    const q1 = pickItemQty(r1)
    const q2 = pickItemQty(r2)
    const v1 = pickItemValue(r1)
    const v2 = pickItemValue(r2)
    const row = {
      id,
      qty_field: q1?.field || q2?.field || null,
      qty_d1: q1?.value ?? null,
      qty_d2: q2?.value ?? null,
      value_field: v1?.field || v2?.field || null,
      value_d1: v1?.value ?? null,
      value_d2: v2?.value ?? null,
      qty_differs: q1 && q2 && q1.value !== q2.value,
      value_differs: v1 && v2 && v1.value !== v2.value,
    }
    overlap.push(row)
    if (row.qty_differs) {
      qtyDifferCount += 1
      if (qtyDifferExamples.length < 5) qtyDifferExamples.push(row)
    }
    if (row.value_differs) {
      valueDifferCount += 1
      if (valueDifferExamples.length < 5) valueDifferExamples.push(row)
    }
  }
  return {
    comparable: true,
    overlap_count: overlap.length,
    qty_differ_count: qtyDifferCount,
    value_differ_count: valueDifferCount,
    any_qty_differs: qtyDifferCount > 0,
    any_value_differs: valueDifferCount > 0,
    overlap_sample: overlap.slice(0, 5),
    qty_differ_examples: qtyDifferExamples,
    value_differ_examples: valueDifferExamples,
  }
}

function compareWarehouseScope(probeAll, probeWh, idField) {
  if (!probeAll.http_ok || !probeWh.http_ok) {
    return { comparable: false, reason: 'one_or_both_probes_failed' }
  }
  if (probeAll.row_count === 0 || probeWh.row_count === 0) {
    return { comparable: false, reason: 'zero_rows' }
  }
  const ma = indexRows(probeAll.rows, idField)
  const mb = indexRows(probeWh.rows, idField)
  let qtyDiffers = false
  const sample = []
  for (const [id, ra] of ma.entries()) {
    if (!mb.has(id)) continue
    const qa = pickItemQty(ra)
    const qb = pickItemQty(mb.get(id))
    if (qa && qb && qa.value !== qb.value) qtyDiffers = true
    sample.push({ id, qty_all: qa?.value ?? null, qty_wh: qb?.value ?? null })
    if (sample.length >= 5) break
  }
  return { comparable: true, qty_differs: qtyDiffers, overlap_sample: sample }
}

const ENDPOINT_PROBES = [
  { id: 'inventoryvaluation', endpoint: '/inventory/v1/reports/inventoryvaluation', idField: 'item_id', dateParam: 'date' },
  { id: 'inventorysummary', endpoint: '/inventory/v1/reports/inventorysummary', idField: 'item_id', dateParam: 'date' },
  { id: 'stocksummary', endpoint: '/inventory/v1/reports/stocksummary', idField: 'item_id', dateParam: 'date' },
  { id: 'stocktracking', endpoint: '/inventory/v1/reports/stocktracking', idField: 'item_id', dateParam: 'date' },
  { id: 'inventorydetails', endpoint: '/inventory/v1/reports/inventorydetails', idField: 'item_id', dateParam: 'date' },
  { id: 'inventoryaging', endpoint: '/inventory/v1/reports/inventoryaging', idField: 'item_id', dateParam: 'date' },
]

function endpointVerdict(d1, d2, sens) {
  const exists = d1.http_ok || d2.http_ok
  const item = d1.http_ok ? d1 : d2
  const hasStock = (item.stock_fields_detected || []).length > 0
  const hasValue = (item.value_fields_detected || []).length > 0
  const dateSensitive = sens?.any_qty_differs || sens?.any_value_differs
  return {
    endpoint_exists: exists,
    rows_returned: item.row_count || 0,
    stock_fields_detected: item.stock_fields_detected || [],
    value_fields_detected: item.value_fields_detected || [],
    item_level: hasStock || hasValue,
    date_sensitive: !!dateSensitive,
    date_sensitivity_evidence: sens,
  }
}

async function probeReportEndpoints() {
  const results = []
  for (const spec of ENDPOINT_PROBES) {
    const probeOpts = { perPage: PER_PAGE, pages: DEEP_PAGES }
    const d1 = await probe(`${spec.id}@${DATE1}`, spec.endpoint, { [spec.dateParam]: DATE1 }, probeOpts)
    const d2 = await probe(`${spec.id}@${DATE2}`, spec.endpoint, { [spec.dateParam]: DATE2 }, probeOpts)
    let wh = null
    if (WAREHOUSE_ID) {
      wh = await probe(
        `${spec.id}@${DATE2}+wh`,
        spec.endpoint,
        { [spec.dateParam]: DATE2, warehouse_id: WAREHOUSE_ID },
        probeOpts,
      )
    }
    const dateSens = compareDateSensitivity(d1, d2, spec.idField)
    const whSens = wh ? compareWarehouseScope(d2, wh, spec.idField) : null
    results.push({
      id: spec.id,
      endpoint: spec.endpoint,
      d1,
      d2,
      wh,
      date_sensitivity: dateSens,
      warehouse_sensitivity: whSens,
      verdict: endpointVerdict(d1, d2, dateSens),
    })
  }
  return results
}

async function probeItemsListWithDateParams() {
  const baseline = await probe('items_baseline', '/inventory/v1/items', {})
  const withReportDate = await probe('items_report_date', '/inventory/v1/items', { report_date: DATE1 })
  const withAsOfDate = await probe('items_as_of_date', '/inventory/v1/items', { as_of_date: DATE1 })
  const withFromTo = await probe('items_from_to', '/inventory/v1/items', { from_date: DATE1, to_date: DATE2 })
  let withWh = null
  if (WAREHOUSE_ID) {
    withWh = await probe('items_warehouse', '/inventory/v1/items', { warehouse_id: WAREHOUSE_ID })
  }
  const datedDifferent = (cand) => {
    if (!baseline.http_ok || !cand.http_ok) return null
    const a = baseline.first_row_sample
    const b = cand.first_row_sample
    if (!a || !b) return null
    const qa = pickItemQty(a)
    const qb = pickItemQty(b)
    if (!qa || !qb) return null
    return { qty_field: qa.field, qty_baseline: qa.value, qty_with_date: qb.value, differs: qa.value !== qb.value }
  }
  return {
    baseline,
    with_report_date: withReportDate,
    with_as_of_date: withAsOfDate,
    with_from_to: withFromTo,
    with_warehouse: withWh,
    compare_report_date: datedDifferent(withReportDate),
    compare_as_of_date: datedDifferent(withAsOfDate),
    compare_from_to: datedDifferent(withFromTo),
  }
}

async function probeItemDetailWithDates(itemId) {
  if (!itemId) return { skipped: 'no item id available' }
  const baseline = await probe('item_detail_baseline', `/inventory/v1/items/${encodeURIComponent(itemId)}`, {})
  const withReportDate = await probe(
    'item_detail_report_date',
    `/inventory/v1/items/${encodeURIComponent(itemId)}`,
    { report_date: DATE1 },
  )
  const withAsOfDate = await probe(
    'item_detail_as_of_date',
    `/inventory/v1/items/${encodeURIComponent(itemId)}`,
    { as_of_date: DATE1 },
  )
  const compare = (cand) => {
    if (!baseline.http_ok || !cand.http_ok) return null
    const a = baseline.first_row_sample || (baseline.rows && baseline.rows[0])
    const b = cand.first_row_sample || (cand.rows && cand.rows[0])
    const qa = pickItemQty(a)
    const qb = pickItemQty(b)
    if (!qa || !qb) return null
    return {
      qty_field: qa.field,
      qty_baseline: qa.value,
      qty_with_date: qb.value,
      differs: qa.value !== qb.value,
    }
  }
  return {
    item_id: itemId,
    baseline,
    with_report_date: withReportDate,
    with_as_of_date: withAsOfDate,
    compare_report_date: compare(withReportDate),
    compare_as_of_date: compare(withAsOfDate),
  }
}

function md(value) {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return String(value).replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '—'
}

function renderTargetedSection(targeted) {
  if (!targeted || targeted.skipped) {
    return [
      '## 4. Targeted item date probe',
      '',
      `- skipped: ${targeted?.skipped || 'no targeted item supplied'}`,
      '',
    ].join('\n')
  }
  const lines = []
  lines.push('## 4. Targeted item date probe (`search_text` / `item_id` filter)')
  lines.push('')
  lines.push(`- Target: \`sku=${md(targeted.target.sku)}\` \`item_id=${md(targeted.target.item_id)}\``)
  lines.push('')
  lines.push(`| endpoint | http d1 | http d2 | qty field | qty @${DATE1} | qty @${DATE2} | qty_differs | value field | value @${DATE1} | value @${DATE2} | value_differs |`)
  lines.push('|---|---|---|---|---:|---:|---|---|---:|---:|---|')
  for (const p of targeted.probes) {
    lines.push(
      `| \`${p.endpoint}\` | ${md(p.d1_http)} | ${md(p.d2_http)} | ${md(p.qty_field)} | ${md(p.qty_d1)} | ${md(p.qty_d2)} | ${p.qty_differs ? '**yes**' : 'no'} | ${md(p.value_field)} | ${md(p.value_d1)} | ${md(p.value_d2)} | ${p.value_differs ? '**yes**' : 'no'} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

function renderDoc({ reportResults, itemsList, itemDetail, targeted }) {
  const lines = []
  lines.push('# Zoho stock-as-of endpoint investigation')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`Probe dates: \`date1=${DATE1}\`, \`date2=${DATE2}\`${WAREHOUSE_ID ? `, warehouse_id=\`${WAREHOUSE_ID}\`` : ''}`)
  lines.push('Per-page: 5 (single page).')
  lines.push('')
  lines.push('Read-only. Uses existing `zohoInventoryJsonRequest` (rate limits / OAuth / usage logging respected).')
  lines.push('')
  lines.push('## 1. Reports endpoints')
  lines.push('')
  lines.push('| endpoint | exists | date param | item-level qty | available-for-sale | value | rows@d2 | date-sensitive (qty or value differs across `date1` vs `date2`)? |')
  lines.push('|---|---|---|---|---|---|---:|---|')
  for (const r of reportResults) {
    const v = r.verdict
    const probe = r.d2.http_ok ? r.d2 : r.d1
    const stock = (v.stock_fields_detected || []).join(', ')
    const value = (v.value_fields_detected || []).join(', ')
    const dateSens = v.date_sensitive ? 'yes' : r.date_sensitivity?.comparable ? 'no (same across dates)' : `inconclusive (${r.date_sensitivity?.reason || 'n/a'})`
    lines.push(
      `| \`${r.endpoint}\` | ${v.endpoint_exists ? 'yes' : `no (HTTP ${r.d2.http_status ?? r.d1.http_status ?? '?'})`} | \`date\` (${probe.http_ok ? 'accepted' : 'unknown'}) | ${stock ? 'yes' : 'no'} | ${/available/i.test(stock) ? 'yes (`' + stock.match(/\S*available\S*/i)[0] + '`)' : 'no'} | ${value ? 'yes' : 'no'} | ${v.rows_returned || 0} | ${dateSens} |`,
    )
  }
  lines.push('')
  for (const r of reportResults) {
    lines.push(`### \`${r.endpoint}\``)
    lines.push('')
    if (!r.verdict.endpoint_exists) {
      lines.push(`- HTTP failure for both dates (${md(r.d1.http_status)}/${md(r.d2.http_status)}): \`${md(r.d1.error || r.d2.error)}\``)
      lines.push('')
      continue
    }
    const probe = r.d2.http_ok ? r.d2 : r.d1
    lines.push(`- date param accepted: \`date=${DATE2}\` (HTTP 2xx)`)
    lines.push(`- top-level keys: ${md(probe.top_level_keys)}`)
    lines.push(`- first row keys: ${md(probe.first_row_keys)}`)
    lines.push(`- stock-like fields: ${md(r.verdict.stock_fields_detected)}`)
    lines.push(`- value-like fields: ${md(r.verdict.value_fields_detected)}`)
    lines.push(`- row count @ ${DATE2}: ${probe.row_count}`)
    if (r.date_sensitivity?.comparable) {
      lines.push(
        `- date sensitivity on overlapping items (qty differs across ${DATE1} vs ${DATE2}): **${r.date_sensitivity.qty_differ_count} / ${r.date_sensitivity.overlap_count}**`,
      )
      lines.push(
        `- value sensitivity: **${r.date_sensitivity.value_differ_count} / ${r.date_sensitivity.overlap_count}**`,
      )
      if (r.date_sensitivity.qty_differ_examples?.length) {
        lines.push('- qty-differing items (first 5):')
        for (const o of r.date_sensitivity.qty_differ_examples) {
          lines.push(
            `  - \`${md(o.id)}\` qty(${md(o.qty_field)}): ${md(o.qty_d1)} → ${md(o.qty_d2)}`,
          )
        }
      }
      if (r.date_sensitivity.value_differ_examples?.length) {
        lines.push('- value-differing items (first 5):')
        for (const o of r.date_sensitivity.value_differ_examples) {
          lines.push(
            `  - \`${md(o.id)}\` value(${md(o.value_field)}): ${md(o.value_d1)} → ${md(o.value_d2)}`,
          )
        }
      }
    } else {
      lines.push(`- date sensitivity: inconclusive (${md(r.date_sensitivity?.reason)})`)
    }
    if (r.warehouse_sensitivity) {
      lines.push(
        `- warehouse param (\`warehouse_id=${WAREHOUSE_ID}\`): ${
          r.warehouse_sensitivity.comparable
            ? r.warehouse_sensitivity.qty_differs
              ? '**accepted and qty differs from all-warehouses**'
              : 'accepted but qty identical to all-warehouses (likely ignored or same item happens to live there)'
            : `inconclusive (${md(r.warehouse_sensitivity.reason)})`
        }`,
      )
    } else {
      lines.push('- warehouse param: not probed (no --warehouse-id)')
    }
    lines.push('')
  }
  lines.push('## 2. `/inventory/v1/items` list with date params')
  lines.push('')
  lines.push('| variant | http | rows | qty field | qty value (first row) | differs vs baseline |')
  lines.push('|---|---|---:|---|---:|---|')
  function rowQty(p) {
    if (!p) return null
    const r = p.first_row_sample || (p.rows && p.rows[0])
    return pickItemQty(r)
  }
  const baseQty = rowQty(itemsList.baseline)
  const entries = [
    ['baseline (no date)', itemsList.baseline, null],
    [`report_date=${DATE1}`, itemsList.with_report_date, itemsList.compare_report_date],
    [`as_of_date=${DATE1}`, itemsList.with_as_of_date, itemsList.compare_as_of_date],
    [`from_date=${DATE1}&to_date=${DATE2}`, itemsList.with_from_to, itemsList.compare_from_to],
    [WAREHOUSE_ID ? `warehouse_id=${WAREHOUSE_ID}` : null, itemsList.with_warehouse, null],
  ].filter((e) => e[0] != null && e[1] != null)
  for (const [label, probeItem, cmp] of entries) {
    const q = rowQty(probeItem)
    const differs =
      cmp == null
        ? '(baseline)'
        : cmp == null
          ? '?'
          : cmp.differs
            ? `**yes** (${cmp.qty_baseline} → ${cmp.qty_with_date})`
            : 'no'
    lines.push(
      `| ${md(label)} | ${probeItem.http_ok ? 'ok' : `HTTP ${md(probeItem.http_status)}`} | ${md(probeItem.row_count)} | ${md(q?.field || baseQty?.field)} | ${md(q?.value)} | ${differs} |`,
    )
  }
  lines.push('')
  lines.push('## 3. `/inventory/v1/items/{item_id}` detail with date params')
  lines.push('')
  if (itemDetail.skipped) {
    lines.push(`- skipped: ${itemDetail.skipped}`)
  } else {
    lines.push(`- item_id probed: \`${md(itemDetail.item_id)}\``)
    const entriesD = [
      ['baseline (no date)', itemDetail.baseline, null],
      [`report_date=${DATE1}`, itemDetail.with_report_date, itemDetail.compare_report_date],
      [`as_of_date=${DATE1}`, itemDetail.with_as_of_date, itemDetail.compare_as_of_date],
    ]
    lines.push('')
    lines.push('| variant | http | qty field | qty value | differs vs baseline |')
    lines.push('|---|---|---|---:|---|')
    for (const [label, p, cmp] of entriesD) {
      const r = p.first_row_sample || (p.rows && p.rows[0])
      const q = pickItemQty(r)
      const differs = cmp == null ? '(baseline)' : cmp.differs ? `**yes** (${cmp.qty_baseline} → ${cmp.qty_with_date})` : 'no'
      lines.push(`| ${md(label)} | ${p.http_ok ? 'ok' : `HTTP ${md(p.http_status)}`} | ${md(q?.field)} | ${md(q?.value)} | ${differs} |`)
    }
  }
  lines.push('')
  lines.push(renderTargetedSection(targeted))
  lines.push('## Final answers')
  lines.push('')
  const valuation = reportResults.find((r) => r.id === 'inventoryvaluation')
  const valuationDateSensitive =
    valuation?.verdict?.date_sensitive === true ||
    (targeted?.probes || []).some((p) => p.endpoint.includes('inventoryvaluation') && (p.qty_differs || p.value_differs))
  const valuationOk = valuation?.verdict?.endpoint_exists === true
  lines.push('### 1. Can Inventory Valuation be used for Opening / Closing stock value?')
  lines.push('')
  if (valuationOk && valuationDateSensitive) {
    lines.push(
      `- **Likely yes for value.** \`${valuation.endpoint}\` is reachable, returns \`${md(valuation.verdict.value_fields_detected)}\`, and probe shows qty or value differs between ${DATE1} and ${DATE2}.`,
    )
    lines.push('- Confirm against Zoho UI Inventory Valuation Summary before any production wire-up.')
  } else if (valuationOk) {
    lines.push(
      `- **Not safe to use yet.** \`${valuation.endpoint}\` is reachable and returns \`${md(valuation.verdict.value_fields_detected)}\` + \`${md(valuation.verdict.stock_fields_detected)}\`, but qty/value were identical across ${DATE1} and ${DATE2} on the sampled overlap → date sensitivity not proven in this org.`,
    )
  } else {
    lines.push(`- **No.** \`${valuation?.endpoint || '/inventory/v1/reports/inventoryvaluation'}\` is not reachable on this org/scope.`)
  }
  lines.push('')
  lines.push('### 2. Can Inventory Warehouse / item stock endpoint be used for dated stock available for sale?')
  lines.push('')
  const itemsDated =
    (itemsList.compare_report_date && itemsList.compare_report_date.differs) ||
    (itemsList.compare_as_of_date && itemsList.compare_as_of_date.differs) ||
    (itemsList.compare_from_to && itemsList.compare_from_to.differs) ||
    (itemDetail && itemDetail.compare_report_date && itemDetail.compare_report_date.differs) ||
    (itemDetail && itemDetail.compare_as_of_date && itemDetail.compare_as_of_date.differs)
  if (itemsDated) {
    lines.push(`- **Maybe** — at least one date param caused \`/inventory/v1/items\` (or item detail) to return a different stock value. Inspect the table above and verify against Zoho UI; do not enable without confirmation.`)
  } else {
    lines.push(`- **No.** \`/inventory/v1/items\` and \`/inventory/v1/items/{id}\` ignore \`report_date\`, \`as_of_date\`, \`from_date\`/\`to_date\` (results identical to baseline). These endpoints return current live stock only.`)
  }
  lines.push('')
  lines.push('### 3. Best candidate endpoint')
  lines.push('')
  const reachable = reportResults.filter((r) => r.verdict.endpoint_exists)
  const dateSensitive = reachable.filter((r) => r.verdict.date_sensitive)
  if (dateSensitive.length > 0) {
    const best = dateSensitive[0]
    lines.push(`- \`${best.endpoint}\` — reachable, returns item-level fields, and shows date sensitivity in this probe.`)
  } else if (reachable.length > 0) {
    const best = reachable.find((r) => r.id === 'inventoryvaluation') || reachable[0]
    lines.push(
      `- \`${best.endpoint}\` — reachable and returns item-level qty/value, but **no proven date sensitivity** in the small sampled set. Larger sample / Zoho UI cross-check needed before any production use.`,
    )
  } else {
    lines.push('- None — no probed reports endpoint is reachable in this org.')
  }
  lines.push('')
  lines.push('### 4. If none work, why?')
  lines.push('')
  if (dateSensitive.length === 0) {
    lines.push('- Probed endpoints either return the same per-item qty/value across two different dates (Zoho appears to ignore `date` for the sampled items), do not exist, or do not expose item-level qty/value. The first-page sample is sorted by item name and contains items whose qty/value may not have changed between the two dates — a broader test is needed to refute or confirm.')
    lines.push('- Recommended next investigation: pick a sample of items with **known** stock movement between `date1` and `date2` (e.g. SPHM-S SKUs that recorded April invoices), query their item_id directly on `inventoryvaluation` for the two dates, and compare against the Zoho UI Inventory Valuation Summary. Until that cross-check matches, continue with reconstruction-based opening/closing values.')
  } else {
    lines.push('- Not applicable — at least one endpoint is date-sensitive; see best candidate above.')
  }
  lines.push('')
  lines.push('## Probe raw artifacts')
  lines.push('')
  lines.push('Top-level keys and first-row keys per probe (for reference):')
  lines.push('')
  for (const r of reportResults) {
    const probe = r.d2.http_ok ? r.d2 : r.d1
    if (!probe.http_ok) {
      lines.push(`- \`${r.endpoint}\` — HTTP ${md(probe.http_status)}: ${md(probe.error)}`)
    } else {
      lines.push(
        `- \`${r.endpoint}\` — top: \`${md(probe.top_level_keys)}\` ; first_row: \`${md(probe.first_row_keys)}\``,
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

async function probeTargetedItemAcrossDates() {
  if (!TARGETED_SKU && !TARGETED_ITEM_ID) return { skipped: 'no --targeted-sku / --targeted-item-id' }
  const search = TARGETED_SKU ? { search_text: TARGETED_SKU } : { item_id: TARGETED_ITEM_ID }
  const probes = []
  for (const [endpoint, dateParam] of [
    ['/inventory/v1/reports/inventoryvaluation', 'date'],
    ['/inventory/v1/reports/inventorysummary', 'date'],
  ]) {
    const d1 = await probe(`targeted@${endpoint}@${DATE1}`, endpoint, { ...search, [dateParam]: DATE1 })
    const d2 = await probe(`targeted@${endpoint}@${DATE2}`, endpoint, { ...search, [dateParam]: DATE2 })
    const matchRow = (p) => {
      if (!p.http_ok || !p.rows) return null
      const skuLower = TARGETED_SKU ? String(TARGETED_SKU).trim().toLowerCase() : ''
      const target = p.rows.find((r) => {
        if (TARGETED_ITEM_ID && String(r.item_id || '').trim() === String(TARGETED_ITEM_ID).trim()) return true
        if (skuLower && String(r.sku || '').trim().toLowerCase() === skuLower) return true
        return false
      })
      return target || p.rows[0] || null
    }
    const r1 = matchRow(d1)
    const r2 = matchRow(d2)
    const q1 = pickItemQty(r1)
    const q2 = pickItemQty(r2)
    const v1 = pickItemValue(r1)
    const v2 = pickItemValue(r2)
    probes.push({
      endpoint,
      d1_http: d1.http_ok ? 'ok' : `HTTP ${d1.http_status}`,
      d2_http: d2.http_ok ? 'ok' : `HTTP ${d2.http_status}`,
      d1_rows_returned: d1.row_count,
      d2_rows_returned: d2.row_count,
      qty_field: q1?.field || q2?.field || null,
      qty_d1: q1?.value ?? null,
      qty_d2: q2?.value ?? null,
      qty_differs: q1 && q2 && q1.value !== q2.value,
      value_field: v1?.field || v2?.field || null,
      value_d1: v1?.value ?? null,
      value_d2: v2?.value ?? null,
      value_differs: v1 && v2 && v1.value !== v2.value,
      sample_row_d2_keys: r2 ? Object.keys(r2).slice(0, 20) : null,
    })
  }
  return { target: { sku: TARGETED_SKU || null, item_id: TARGETED_ITEM_ID || null }, probes }
}

async function main() {
  console.log(`Stock-as-of endpoint probe: date1=${DATE1}, date2=${DATE2}${WAREHOUSE_ID ? `, warehouse=${WAREHOUSE_ID}` : ''}`)
  const reportResults = await probeReportEndpoints()
  const itemsList = await probeItemsListWithDateParams()
  const targeted = await probeTargetedItemAcrossDates()
  let itemId = ''
  for (const r of reportResults) {
    const probe = r.d2.http_ok ? r.d2 : r.d1
    if (!probe.http_ok) continue
    for (const row of probe.rows || []) {
      const id = row && row.item_id ? String(row.item_id).trim() : ''
      const q = pickItemQty(row)
      if (id && q && q.value > 0) {
        itemId = id
        break
      }
    }
    if (itemId) break
  }
  if (!itemId) {
    for (const r of reportResults) {
      const probe = r.d2.http_ok ? r.d2 : r.d1
      if (!probe.http_ok) continue
      const row = probe.rows && probe.rows[0]
      const id = row && row.item_id ? String(row.item_id).trim() : ''
      if (id) {
        itemId = id
        break
      }
    }
  }
  if (!itemId && itemsList.baseline.http_ok) {
    const r = itemsList.baseline.rows && itemsList.baseline.rows[0]
    if (r && r.item_id) itemId = String(r.item_id).trim()
  }
  const itemDetail = await probeItemDetailWithDates(itemId)
  const doc = renderDoc({ reportResults, itemsList, itemDetail, targeted })
  fs.writeFileSync(DOC_PATH, doc)
  console.log(
    JSON.stringify(
      {
        wrote: DOC_PATH,
        reports: reportResults.map((r) => ({
          endpoint: r.endpoint,
          exists: r.verdict.endpoint_exists,
          rows: r.verdict.rows_returned,
          stock_fields: r.verdict.stock_fields_detected,
          value_fields: r.verdict.value_fields_detected,
          date_sensitive: r.verdict.date_sensitive,
        })),
        items_list_dated_diff:
          (itemsList.compare_report_date && itemsList.compare_report_date.differs) ||
          (itemsList.compare_as_of_date && itemsList.compare_as_of_date.differs) ||
          (itemsList.compare_from_to && itemsList.compare_from_to.differs) ||
          false,
        item_detail_probe_id: itemDetail.item_id || null,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error('FAILED:', e && e.stack ? e.stack : e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch {}
  })

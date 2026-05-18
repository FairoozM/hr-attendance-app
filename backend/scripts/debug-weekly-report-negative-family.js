#!/usr/bin/env node
/**
 * Read-only drill-down for one family with negative reconstructed opening (closing-as-of mode).
 *
 * Usage:
 *   node backend/scripts/debug-weekly-report-negative-family.js \
 *     --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { readZohoConfig } = require('../src/integrations/zoho/zohoConfig')
const { fetchAllItemsRaw } = require('../src/integrations/zoho/zohoAdapter')
const {
  getStockReconstruction,
  getInventoryAdjustments,
  isoDateLocal,
} = require('../src/integrations/zoho/weeklyReportZohoTransactions')
const { getInventoryByGroup } = require('../src/services/zohoService')
const {
  buildItemIdToSkuMap,
  _internals: { parseLineQty },
} = require('../src/services/weeklyReportZohoLineMerge')
const {
  pickFamilyValue: parseFamilyFromZohoItem,
  _internals: {
    parseZohoStockOnHand,
    parseZohoUnitSalesPrice,
    resolveUnitPriceForStockValuation,
    familyRowKeyFromDisplay,
    filterMovementLinesByHalfOpenWindow,
    buildWeeklyReportScope,
  },
} = require('../src/services/weeklyReportZohoData')
const { pool } = require('../src/db')

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

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return 'null'
  return Math.round(n * 1000) / 1000
}

function lineBelongsToItem(line, item) {
  if (!line || !item) return false
  const id = item.item_id != null ? String(item.item_id).trim() : ''
  if (id && line.item_id != null && String(line.item_id).trim() === id) return true
  const sk = item.sku != null ? String(item.sku).trim().toLowerCase() : ''
  if (sk && line.sku != null && String(line.sku).trim().toLowerCase() === sk) return true
  const nm = item.item_name != null ? String(item.item_name).trim().toLowerCase() : ''
  if (nm && line.name != null && String(line.name).trim().toLowerCase() === nm) return true
  return false
}

function sumLineQty(lines, qtyField = 'quantity') {
  let t = 0
  for (const li of lines || []) {
    const v = qtyField === 'quantity_adjusted' ? li.quantity_adjusted : li.quantity
    t += parseLineQty(v)
  }
  return t
}

function docSample(line) {
  return {
    document_id: line.document_id || '',
    document_date: line.document_date || '',
    qty: parseLineQty(line.quantity != null ? line.quantity : line.quantity_adjusted),
    sku: line.sku || '',
    name: line.name || '',
    type: line.type || '',
  }
}

function printHelp() {
  console.log(`Usage:
  node backend/scripts/debug-weekly-report-negative-family.js \\
    --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18

Uses closing-as-of reconstruction (script sets WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1).
Read-only. See docs/weekly-sales-negative-family-debug.md`)
}

async function main() {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp()
    return
  }

  const group = argValue('group', 'other_family')
  const family = argValue('family', 'SPHM-S')
  const fromDate = argValue('from', '2026-05-01')
  const toDate = argValue('to', '2026-05-18')
  const warehouseId = argValue('warehouse-id', '') || null
  const excludeWarehouseId = argValue('exclude-warehouse-id', '') || null
  const familyKey = familyRowKeyFromDisplay(family)

  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    throw new Error(`Zoho not configured: ${(cfg.missing || []).join(', ')}`)
  }

  process.env.WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE = '1'
  delete process.env.WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS
  delete process.env.WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS
  const invoiceMaxPages = parseInt(argValue('max-invoice-pages', process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES || '2'), 10) || 2
  const invoiceDetailLimit =
    parseInt(argValue('max-invoice-details', process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT || '80'), 10) || 80
  process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES = String(invoiceMaxPages)
  process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT = String(invoiceDetailLimit)

  const throughDate = isoDateLocal()
  const reportScope = buildWeeklyReportScope(warehouseId, excludeWarehouseId)
  const stockReconOpts = {
    reportGroup: group,
    includeWarehouseDetail: true,
    requireDatedSalesLines: true,
    maxInvoicePages: invoiceMaxPages,
    maxInvoiceDetailLimit: invoiceDetailLimit,
    ...reportScope.transactionFilter,
  }

  console.log('Weekly report — negative family debug (read-only)')
  console.log(`  group=${group} family=${family} from=${fromDate} to=${toDate} through=${throughDate}`)
  console.log('  mode: closing-as-of (CLOSING_AS_OF_TO_DATE=1, INCLUDE_ADJUSTMENTS=off)')
  console.log(`  invoice_caps: max_pages=${invoiceMaxPages} max_details=${invoiceDetailLimit}`)

  const t0 = Date.now()
  const { items: familyRows, itemDetails, reportMeta } = await getInventoryByGroup(
    group,
    fromDate,
    toDate,
    warehouseId,
    excludeWarehouseId,
    { includeItemDetails: true },
  )
  const familyRow = familyRows.find((r) => familyRowKeyFromDisplay(r.family) === familyKey)
  const skusInFamily = itemDetails.filter(
    (r) => familyRowKeyFromDisplay(r.family_display || r.family) === familyKey,
  )

  const stockReconR = await getStockReconstruction(fromDate, throughDate, stockReconOpts)
  const inventoryAdjR = await getInventoryAdjustments(fromDate, throughDate, stockReconOpts)
  const raw = await fetchAllItemsRaw()
  const idToSku = buildItemIdToSkuMap(raw)
  const zohoByItemId = new Map()
  for (const z of raw) {
    if (z && z.item_id) zohoByItemId.set(String(z.item_id).trim(), z)
  }

  const reconSales = (stockReconR.salesR && stockReconR.salesR.lines) || []
  const reconPurch = (stockReconR.purchR && stockReconR.purchR.lines) || []
  const reconVc = (stockReconR.vcR && stockReconR.vcR.lines) || []
  const reconAdj = (inventoryAdjR && inventoryAdjR.lines) || []

  const salesOpen = filterMovementLinesByHalfOpenWindow(reconSales, fromDate, toDate)
  const salesAfter = filterMovementLinesByHalfOpenWindow(reconSales, toDate, throughDate)
  const purchOpen = filterMovementLinesByHalfOpenWindow(reconPurch, fromDate, toDate)
  const purchAfter = filterMovementLinesByHalfOpenWindow(reconPurch, toDate, throughDate)
  const vcOpen = filterMovementLinesByHalfOpenWindow(reconVc, fromDate, toDate)
  const vcAfter = filterMovementLinesByHalfOpenWindow(reconVc, toDate, throughDate)
  const adjOpen = filterMovementLinesByHalfOpenWindow(reconAdj, fromDate, toDate)
  const adjAfter = filterMovementLinesByHalfOpenWindow(reconAdj, toDate, throughDate)

  const itemRows = []
  for (const detail of skusInFamily) {
    const zItem = detail.item_id ? zohoByItemId.get(String(detail.item_id).trim()) || null : null
    const zohoFamily = zItem ? parseFamilyFromZohoItem(zItem, cfg.familyCustomFieldId) : ''
    const linesForItem = (all) => (all || []).filter((li) => lineBelongsToItem(li, detail))

    const sOpen = sumLineQty(linesForItem(salesOpen))
    const sAfter = sumLineQty(linesForItem(salesAfter))
    const pOpen = sumLineQty(linesForItem(purchOpen))
    const pAfter = sumLineQty(linesForItem(purchAfter))
    const rOpen = sumLineQty(linesForItem(vcOpen))
    const rAfter = sumLineQty(linesForItem(vcAfter))
    const aOpen = sumLineQty(linesForItem(adjOpen), 'quantity_adjusted')
    const aAfter = sumLineQty(linesForItem(adjAfter), 'quantity_adjusted')

    const qNow = zItem ? parseZohoStockOnHand(zItem) : null
    const netAfter = pAfter - sAfter - rAfter
    const netOpen = pOpen - sOpen - rOpen
    const qClose = detail.closing_qty
    const qOpen = detail.opening_qty
    const unit = resolveUnitPriceForStockValuation(zItem, detail)
    const salesPriceBasis = parseZohoUnitSalesPrice(zItem) ?? unit

    itemRows.push({
      item_id: detail.item_id,
      sku: detail.sku,
      item_name: detail.item_name,
      zoho_family: zohoFamily,
      q_now: qNow,
      sales_open: sOpen,
      sales_after: sAfter,
      purch_open: pOpen,
      purch_after: pAfter,
      vc_open: rOpen,
      vc_after: rAfter,
      adj_open: aOpen,
      adj_after: aAfter,
      q_close: qClose,
      q_open: qOpen,
      sales_price_basis: salesPriceBasis,
      opening_value: detail.opening_amount,
      closing_value: detail.closing_amount,
      net_delta_open: netOpen - sOpen - rOpen,
      net_delta_after: netAfter,
      allLines: {
        sales: [...linesForItem(salesOpen), ...linesForItem(salesAfter)],
        purch: [...linesForItem(purchOpen), ...linesForItem(purchAfter)],
        vc: [...linesForItem(vcOpen), ...linesForItem(vcAfter)],
        adj: [...linesForItem(adjOpen), ...linesForItem(adjAfter)],
      },
    })
  }

  itemRows.sort((a, b) => (a.q_open ?? 0) - (b.q_open ?? 0))

  console.log(`\nFetched in ${Date.now() - t0}ms — ${skusInFamily.length} SKU rows in family`)
  if (familyRow) {
    console.log('\nFamily aggregate (report row):')
    console.log(`  opening_stock (value): ${fmt(familyRow.opening_stock)}`)
    console.log(`  closing_stock (value): ${fmt(familyRow.closing_stock)}`)
    console.log(`  sales_amount: ${fmt(familyRow.sales_amount)}`)
  }

  const tot = itemRows.reduce(
    (acc, r) => {
      acc.q_now += r.q_now || 0
      acc.sales_open += r.sales_open
      acc.sales_after += r.sales_after
      acc.purch_open += r.purch_open
      acc.purch_after += r.purch_after
      acc.vc_open += r.vc_open
      acc.vc_after += r.vc_after
      acc.adj_open += r.adj_open
      acc.adj_after += r.adj_after
      acc.q_close += r.q_close || 0
      acc.q_open += r.q_open || 0
      return acc
    },
    {
      q_now: 0,
      sales_open: 0,
      sales_after: 0,
      purch_open: 0,
      purch_after: 0,
      vc_open: 0,
      vc_after: 0,
      adj_open: 0,
      adj_after: 0,
      q_close: 0,
      q_open: 0,
    },
  )

  console.log('\nFamily totals (sum of item rows):')
  console.log(`  live qty now:          ${fmt(tot.q_now)}`)
  console.log(`  sales (open window):   ${fmt(tot.sales_open)}`)
  console.log(`  sales (after to_date): ${fmt(tot.sales_after)}`)
  console.log(`  purch (open window):   ${fmt(tot.purch_open)}`)
  console.log(`  purch (after to_date): ${fmt(tot.purch_after)}`)
  console.log(`  VC (open window):      ${fmt(tot.vc_open)}`)
  console.log(`  VC (after to_date):    ${fmt(tot.vc_after)}`)
  console.log(`  adj (open window):     ${fmt(tot.adj_open)}  [not in calc without INCLUDE_ADJ]`)
  console.log(`  adj (after to_date):   ${fmt(tot.adj_after)}`)
  console.log(`  recon closing qty:     ${fmt(tot.q_close)}`)
  console.log(`  recon opening qty:     ${fmt(tot.q_open)}`)
  console.log(
    `  check: q_close ≈ q_now - (p_after - s_after - vc_after) => ${fmt(tot.q_now - (tot.purch_after - tot.sales_after - tot.vc_after))}`,
  )
  console.log(
    `  check: q_open ≈ q_close - (p_open - s_open - vc_open) => ${fmt(tot.q_close - (tot.purch_open - tot.sales_open - tot.vc_open))}`,
  )

  console.log('\n--- Item-level table ---')
  console.log(
    'item_id | sku | q_now | s_open | s_after | p_open | p_after | vc_o | vc_a | adj_o | adj_a | q_close | q_open | unit | open$ | close$ | zoho_family',
  )
  for (const r of itemRows) {
    console.log(
      [
        r.item_id,
        r.sku,
        fmt(r.q_now),
        fmt(r.sales_open),
        fmt(r.sales_after),
        fmt(r.purch_open),
        fmt(r.purch_after),
        fmt(r.vc_open),
        fmt(r.vc_after),
        fmt(r.adj_open),
        fmt(r.adj_after),
        fmt(r.q_close),
        fmt(r.q_open),
        fmt(r.sales_price_basis),
        fmt(r.opening_value),
        fmt(r.closing_value),
        r.zoho_family || '',
      ].join(' | '),
    )
  }

  const negativeItems = itemRows.filter((r) => (r.q_open ?? 0) < 0)
  console.log(`\nItems with negative reconstructed opening qty: ${negativeItems.length}`)

  const contributors = [...itemRows]
    .map((r) => ({ ...r, negScore: r.q_open < 0 ? Math.abs(r.q_open) : 0 }))
    .sort((a, b) => b.negScore - a.negScore)
    .slice(0, 10)

  console.log('\n--- Top 10 items by negative opening (document samples) ---')
  for (const r of contributors) {
    if (r.negScore <= 0 && contributors[0].negScore <= 0) break
    console.log(`\n### ${r.sku || r.item_id} — q_open=${fmt(r.q_open)} q_close=${fmt(r.q_close)} q_now=${fmt(r.q_now)}`)
    const buckets = [
      ['sales', r.allLines.sales],
      ['purchase', r.allLines.purch],
      ['vendor_credit', r.allLines.vc],
      ['adjustment', r.allLines.adj],
    ]
    for (const [label, lines] of buckets) {
      if (!lines.length) continue
      const sorted = [...lines].sort(
        (a, b) => Math.abs(parseLineQty(b.quantity || b.quantity_adjusted)) - Math.abs(parseLineQty(a.quantity || a.quantity_adjusted)),
      )
      console.log(`  ${label} (${lines.length} lines, top 5 by |qty|):`)
      for (const li of sorted.slice(0, 5)) {
        const s = docSample(li)
        console.log(`    ${s.document_date} ${s.type || label} ${s.document_id} qty=${s.qty} ${s.sku} ${s.name}`)
      }
    }
  }

  const wrongFamily = itemRows.filter(
    (r) => r.zoho_family && familyRowKeyFromDisplay(r.zoho_family) !== familyKey,
  )
  if (wrongFamily.length) {
    console.log(`\n⚠ SKU rows under family label "${family}" but Zoho Family field differs:`)
    for (const r of wrongFamily.slice(0, 15)) {
      console.log(`  ${r.sku}: zoho_family=${r.zoho_family}`)
    }
  }

  console.log('\nreconstruction meta:')
  console.log(JSON.stringify(reportMeta && reportMeta.reconstruction, null, 2))
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
      // ignore
    }
  })

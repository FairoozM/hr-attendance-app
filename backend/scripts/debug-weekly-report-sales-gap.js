#!/usr/bin/env node
/**
 * Read-only: why period Sales Amount > 0 but reconstruction sales qty = 0 for a family.
 *
 * Usage:
 *   node backend/scripts/debug-weekly-report-sales-gap.js \
 *     --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18
 *
 * Optional:
 *   --warehouse-id ID
 *   --exclude-warehouse-id ID
 *   --closing-as-of   (sets WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1 like prod flag test)
 *   --max-invoice-pages N     (WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES, default 2 with --closing-as-of)
 *   --max-invoice-details N   (WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT, default 80 with --closing-as-of)
 *   --stop-after-matching-sales-lines N
 *                           Targeted recon: stop invoice detail fetch after N dated lines
 *                           matching --family items in opening window (from, to]
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { readZohoConfig } = require('../src/integrations/zoho/zohoConfig')
const { fetchAllItemsRaw } = require('../src/integrations/zoho/zohoAdapter')
const {
  getSales,
  getStockReconstruction,
  isoDateLocal,
  _internals: { buildTargetReconItemSets },
} = require('../src/integrations/zoho/weeklyReportZohoTransactions')
const { getInventoryByGroup } = require('../src/services/zohoService')
const {
  buildItemIdToSkuMap,
  sumLinesToMap,
  sumAmountsToMap,
  mapLookupForReportRow,
  lineCanonicalKey,
  _internals: { parseLineQty },
} = require('../src/services/weeklyReportZohoLineMerge')
const {
  pickFamilyValue: parseFamilyFromZohoItem,
  _internals: {
    parseZohoStockOnHand,
    parseZohoUnitSalesPrice,
    familyRowKeyFromDisplay,
    buildWeeklyReportScope,
    filterMovementLinesByHalfOpenWindow,
    isWeeklyReportReconClosingAsOfToDateEnabled,
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

function parseCapArg(cliName, envKey, fallback) {
  const fromCli = argValue(cliName, '')
  if (fromCli !== '') {
    const n = parseInt(fromCli, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  const fromEnv = process.env[envKey]
  if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
    const n = parseInt(String(fromEnv).trim(), 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return fallback
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return 'null'
  return Math.round(n * 1000) / 1000
}

function printHelp() {
  console.log(`Usage:
  node backend/scripts/debug-weekly-report-sales-gap.js \\
    --group other_family --family SPHM-S --from 2026-05-01 --to 2026-05-18

Read-only. See docs/weekly-sales-sales-gap-debug.md`)
}

function buildFamilyLineIndex(raw, familyFieldId) {
  const itemIdToFam = new Map()
  const skuToFam = new Map()
  const nameToFam = new Map()
  for (const it of raw || []) {
    if (!it) continue
    const fk = familyRowKeyFromDisplay(parseFamilyFromZohoItem(it, familyFieldId))
    if (!fk) continue
    if (it.item_id) itemIdToFam.set(String(it.item_id).trim(), fk)
    if (it.sku) skuToFam.set(String(it.sku).trim().toLowerCase(), fk)
    const nm = it.name || it.item_name
    if (nm) nameToFam.set(String(nm).trim().toLowerCase(), fk)
  }
  return { itemIdToFam, skuToFam, nameToFam }
}

function famKeyForLine(line, index) {
  if (!line) return null
  const id = line.item_id != null ? String(line.item_id).trim() : ''
  if (id && index.itemIdToFam.has(id)) return index.itemIdToFam.get(id)
  const sk = line.sku != null ? String(line.sku).trim().toLowerCase() : ''
  if (sk && index.skuToFam.has(sk)) return index.skuToFam.get(sk)
  const nm = line.name != null ? String(line.name).trim().toLowerCase() : ''
  if (nm && index.nameToFam.has(nm)) return index.nameToFam.get(nm)
  return null
}

function matchLineToFamilyItem(line, familyItems) {
  for (const it of familyItems) {
    const id = it.item_id != null ? String(it.item_id).trim() : ''
    if (id && line.item_id != null && String(line.item_id).trim() === id) {
      return { item: it, matched_by: 'item_id' }
    }
    const sk = it.sku != null ? String(it.sku).trim().toLowerCase() : ''
    if (sk && line.sku != null && String(line.sku).trim().toLowerCase() === sk) {
      return { item: it, matched_by: 'sku' }
    }
    const nm = it.item_name != null ? String(it.item_name).trim().toLowerCase() : ''
    if (nm && line.name != null && String(line.name).trim().toLowerCase() === nm) {
      return { item: it, matched_by: 'name' }
    }
  }
  return null
}

function suspectedGapReason(line, reconQtyInWindow) {
  const reasons = []
  const d = line.document_date != null ? String(line.document_date).slice(0, 10) : ''
  if (!d) reasons.push('empty_document_date_salesbyitem')
  if (line.type === 'sales_by_item' && !d) {
    reasons.push('closing_as_of_half_open_filter_drops_aggregated_sales')
  }
  if ((Number(line.quantity) || 0) <= 0 && (Number(line.item_total) || 0) > 0) {
    reasons.push('amount_without_quantity_on_line')
  }
  if (reconQtyInWindow === 0 && (Number(line.item_total) || 0) > 0) {
    reasons.push('in_period_amount_map_not_in_recon_window_qty')
  }
  return reasons.length ? reasons.join(';') : 'unclassified'
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

  if (hasFlag('closing-as-of')) {
    process.env.WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE = '1'
  }

  const closingAsOf = isWeeklyReportReconClosingAsOfToDateEnabled()
  const invoiceMaxPages = parseCapArg('max-invoice-pages', 'WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES', closingAsOf ? 2 : 50)
  const invoiceDetailLimit = parseCapArg(
    'max-invoice-details',
    'WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT',
    closingAsOf ? 80 : Infinity,
  )
  const stopAfterMatching = (() => {
    const v = argValue('stop-after-matching-sales-lines', '')
    if (v === '') return null
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  })()
  if (closingAsOf) {
    process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES = String(invoiceMaxPages)
    if (Number.isFinite(invoiceDetailLimit)) {
      process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT = String(invoiceDetailLimit)
    }
  }

  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    throw new Error(`Zoho not configured: ${(cfg.missing || []).join(', ')}`)
  }

  const throughDate = isoDateLocal()
  const reportScope = buildWeeklyReportScope(warehouseId, excludeWarehouseId)

  console.log('Weekly report — sales amount vs reconstruction qty gap (read-only)')
  console.log(`  group=${group} family=${family} from=${fromDate} to=${toDate} through=${throughDate}`)
  console.log(`  scope=${reportScope.kind} closing_as_of=${closingAsOf}`)
  if (closingAsOf) {
    console.log(
      `  invoice_caps: max_pages=${invoiceMaxPages} max_details=${Number.isFinite(invoiceDetailLimit) ? invoiceDetailLimit : 'none'}` +
        (stopAfterMatching ? ` stop_after_matching=${stopAfterMatching}` : ''),
    )
  }

  const slowWarnMs = parseInt(argValue('slow-warn-ms', '120000'), 10) || 120000
  const t0 = Date.now()
  const slowTimer = setInterval(() => {
    const elapsed = Date.now() - t0
    if (elapsed >= slowWarnMs) {
      console.warn(
        `[sales-gap] still running after ${Math.round(elapsed / 1000)}s — dated invoice fetch may be rate-limited; lower --max-invoice-details or narrow dates`,
      )
    }
  }, 30000)

  let reportResult
  let raw
  let periodSalesR
  let stockReconR
  try {
    const familyFieldId = cfg.familyCustomFieldId
    if (stopAfterMatching && closingAsOf) {
      ;[reportResult, raw, periodSalesR] = await Promise.all([
        getInventoryByGroup(group, fromDate, toDate, warehouseId, excludeWarehouseId),
        fetchAllItemsRaw(),
        getSales(fromDate, toDate, { ...reportScope.salesTransactionFilter }),
      ])
      const reconTargetItems = []
      for (const it of raw || []) {
        if (!it || (it.status && String(it.status).toLowerCase() === 'inactive')) continue
        const fk = familyRowKeyFromDisplay(parseFamilyFromZohoItem(it, familyFieldId))
        if (fk !== familyKey) continue
        reconTargetItems.push({
          item_id: it.item_id,
          sku: it.sku,
          name: it.name || it.item_name,
        })
      }
      stockReconR = await getStockReconstruction(fromDate, throughDate, {
        reportGroup: group,
        includeWarehouseDetail: true,
        requireDatedSalesLines: true,
        maxInvoicePages: invoiceMaxPages,
        maxInvoiceDetailLimit: Number.isFinite(invoiceDetailLimit) ? invoiceDetailLimit : undefined,
        reconTargetItems,
        stopAfterMatchingSalesLines: stopAfterMatching,
        reconMatchFromDate: fromDate,
        reconMatchToDate: toDate,
        ...reportScope.transactionFilter,
      })
      console.log(
        `  targeted_recon_items=${reconTargetItems.length} target_sets=${buildTargetReconItemSets(reconTargetItems).count}`,
      )
    } else {
      ;[reportResult, raw, periodSalesR, stockReconR] = await Promise.all([
        getInventoryByGroup(group, fromDate, toDate, warehouseId, excludeWarehouseId),
        fetchAllItemsRaw(),
        getSales(fromDate, toDate, { ...reportScope.salesTransactionFilter }),
        getStockReconstruction(fromDate, throughDate, {
          reportGroup: group,
          includeWarehouseDetail: true,
          requireDatedSalesLines: closingAsOf,
          maxInvoicePages: invoiceMaxPages,
          maxInvoiceDetailLimit: Number.isFinite(invoiceDetailLimit) ? invoiceDetailLimit : undefined,
          ...reportScope.transactionFilter,
        }),
      ])
    }
  } finally {
    clearInterval(slowTimer)
  }

  const familyRow = (reportResult.items || []).find(
    (r) => familyRowKeyFromDisplay(r.family) === familyKey,
  )
  const familyFieldId = cfg.familyCustomFieldId
  const famIndex = buildFamilyLineIndex(raw, familyFieldId)

  const familyZohoItems = []
  for (const it of raw || []) {
    if (!it || (it.status && String(it.status).toLowerCase() === 'inactive')) continue
    const fk = familyRowKeyFromDisplay(parseFamilyFromZohoItem(it, familyFieldId))
    if (fk !== familyKey) continue
    familyZohoItems.push({
      item_id: it.item_id != null ? String(it.item_id).trim() : '',
      sku: it.sku != null ? String(it.sku).trim() : '',
      item_name: (it.name || it.item_name || '').trim(),
      family: parseFamilyFromZohoItem(it, familyFieldId),
      current_qty: parseZohoStockOnHand(it),
      rate: parseZohoUnitSalesPrice(it),
    })
  }
  familyZohoItems.sort((a, b) => String(a.sku).localeCompare(String(b.sku)))

  const idToSku = buildItemIdToSkuMap(raw)
  const periodLines = (periodSalesR && periodSalesR.lines) || []
  const reconLinesAll = (stockReconR && stockReconR.salesR && stockReconR.salesR.lines) || []
  const reconLinesPeriod =
    periodSalesR.source === stockReconR.salesR.source &&
    JSON.stringify(reportScope.salesTransactionFilter) ===
      JSON.stringify(reportScope.transactionFilter)
      ? periodLines
      : (stockReconR.salesR && stockReconR.salesR.lines) || []

  const salesOpenWindow = filterMovementLinesByHalfOpenWindow(reconLinesAll, fromDate, toDate)
  const salesAfterWindow = filterMovementLinesByHalfOpenWindow(reconLinesAll, toDate, throughDate)

  const periodQtyMap = sumLinesToMap(periodLines, idToSku)
  const periodAmtMap = sumAmountsToMap(
    periodLines.map((l) => ({
      item_id: l.item_id,
      sku: l.sku,
      name: l.name,
      item_total: l.item_total,
    })),
    idToSku,
  )
  const reconOpenQtyMap = sumLinesToMap(salesOpenWindow, idToSku)
  const reconAllQtyMap = sumLinesToMap(reconLinesAll, idToSku)

  const periodFamLines = periodLines.filter((l) => famKeyForLine(l, famIndex) === familyKey)
  const reconFamLinesAll = reconLinesAll.filter((l) => famKeyForLine(l, famIndex) === familyKey)
  const reconFamLinesOpen = salesOpenWindow.filter((l) => famKeyForLine(l, famIndex) === familyKey)

  let periodFamQty = 0
  let periodFamAmt = 0
  for (const l of periodFamLines) {
    periodFamQty += parseLineQty(l.quantity)
    periodFamAmt += parseLineQty(l.item_total)
  }

  let reconOpenFamQty = 0
  for (const l of reconFamLinesOpen) reconOpenFamQty += parseLineQty(l.quantity)

  const emptyDocDatePeriod = periodFamLines.filter(
    (l) => !l.document_date || String(l.document_date).trim() === '',
  )
  const emptyDocDateRecon = reconFamLinesAll.filter(
    (l) => !l.document_date || String(l.document_date).trim() === '',
  )

  console.log(`\nFetched in ${Date.now() - t0}ms — ${familyZohoItems.length} Zoho items in family`)

  console.log('\n=== 1) SPHM-S items (current Zoho catalog) ===')
  console.log('item_id | sku | name | family | current_qty | rate')
  for (const it of familyZohoItems.slice(0, 20)) {
    console.log(
      [it.item_id, it.sku, it.item_name, it.family, fmt(it.current_qty), fmt(it.rate)].join(' | '),
    )
  }
  if (familyZohoItems.length > 20) {
    console.log(`  ... +${familyZohoItems.length - 20} more SKUs`)
  }

  console.log('\n=== Report family row (period column) ===')
  if (familyRow) {
    console.log(`  sales_amount: ${fmt(familyRow.sales_amount)}`)
    console.log(`  sold (if on row): ${fmt(familyRow.sold)}`)
  } else {
    console.log('  (family row not found in report output)')
  }

  console.log('\n=== API / filter differences ===')
  console.log(
    JSON.stringify(
      {
        period_sales: {
          endpoint: periodSalesR.source || 'unknown',
          fallback_used: !!periodSalesR.fallback_used,
          date_params: { from_date: fromDate, to_date: toDate },
          warehouse_filter: reportScope.salesTransactionFilter,
          line_count_total: periodLines.length,
          list_truncated: !!periodSalesR.list_truncated,
          list_pages: periodSalesR.list_pages || 0,
        },
        stock_recon_sales: {
          endpoint: stockReconR.salesR.source || 'unknown',
          fallback_used: !!stockReconR.salesR.fallback_used,
          dated_lines_for_reconstruction: !!stockReconR.salesR.dated_lines_for_reconstruction,
          date_params: { from_date: fromDate, through_date: throughDate },
          warehouse_filter: reportScope.transactionFilter,
          line_count_total: reconLinesAll.length,
          list_truncated: !!stockReconR.list_truncated,
          invoice_list_count: stockReconR.salesR.invoice_list_count,
          invoice_list_pages: stockReconR.salesR.list_pages,
          invoice_list_with_usable_line_items: stockReconR.salesR.invoice_list_with_usable_line_items,
          invoice_detail_fetches: stockReconR.salesR.invoice_detail_fetches,
          invoice_detail_cache_hits: stockReconR.salesR.invoice_detail_cache_hits,
          invoice_detail_fetch_limit: stockReconR.salesR.invoice_detail_fetch_limit,
          max_invoice_details: stockReconR.salesR.max_invoice_details,
          invoice_detail_fetch_truncated: !!stockReconR.salesR.invoice_detail_fetch_truncated,
          sales_reconstruction_partial: !!stockReconR.salesR.sales_reconstruction_partial,
          targeted_recon_complete: !!stockReconR.salesR.targeted_recon_complete,
          invoice_sort_column: stockReconR.salesR.invoice_sort_column,
          invoice_sort_order: stockReconR.salesR.invoice_sort_order,
          invoice_date_start: stockReconR.salesR.invoice_date_start,
          invoice_date_end: stockReconR.salesR.invoice_date_end,
          first_invoice_date: stockReconR.salesR.first_invoice_date,
          last_invoice_date: stockReconR.salesR.last_invoice_date,
          prefilter: stockReconR.salesR.prefilter || null,
        },
        closing_as_of_enabled: closingAsOf,
        recon_opening_window: closingAsOf ? `(from_date, to_date] = (${fromDate}, ${toDate}]` : 'n/a (full range)',
        salesbyitem_document_date_empty: {
          period_family_lines: periodFamLines.length,
          period_family_empty_date: emptyDocDatePeriod.length,
          recon_family_empty_date: emptyDocDateRecon.length,
        },
        scope_mismatch_period_vs_recon:
          JSON.stringify(reportScope.salesTransactionFilter) !==
          JSON.stringify(reportScope.transactionFilter),
      },
      null,
      2,
    ),
  )

  console.log('\n=== 2) Sales Amount path — rows matched to SPHM-S ===')
  console.log(
    `source=${periodSalesR.source} fallback=${periodSalesR.fallback_used} family_lines=${periodFamLines.length} qty_sum=${fmt(periodFamQty)} amount_sum=${fmt(periodFamAmt)}`,
  )
  const amtRows = [...periodFamLines]
    .sort((a, b) => (Number(b.item_total) || 0) - (Number(a.item_total) || 0))
    .slice(0, 25)
  console.log('source | item_id | sku | name | qty | amount | matched_by | document_date | type')
  for (const line of amtRows) {
    const m = matchLineToFamilyItem(line, familyZohoItems)
    console.log(
      [
        periodSalesR.source,
        line.item_id,
        line.sku,
        (line.name || '').slice(0, 40),
        fmt(line.quantity),
        fmt(line.item_total),
        m ? m.matched_by : 'family_index_only',
        line.document_date || '(empty)',
        line.type || '',
      ].join(' | '),
    )
  }

  console.log('\n=== 3) Reconstruction sales qty path ===')
  console.log(
    `source=${stockReconR.salesR.source} family_lines_all=${reconFamLinesAll.length} family_lines_open_window=${reconFamLinesOpen.length} open_window_qty_sum=${fmt(reconOpenFamQty)}`,
  )
  if (reconFamLinesOpen.length === 0 && reconFamLinesAll.length > 0) {
    console.log(
      '  NOTE: family has sales lines in fetch but 0 after half-open window (likely empty document_date on salesbyitem).',
    )
  }
  const reconSample = [...reconFamLinesOpen, ...reconFamLinesAll]
    .filter((l, i, arr) => arr.indexOf(l) === i)
    .slice(0, 15)
  console.log('invoice_id | date | item_id | sku | name | qty | warehouse_id | type | status')
  for (const line of reconSample) {
    console.log(
      [
        line.document_id || '',
        line.document_date || '(empty)',
        line.item_id,
        line.sku,
        (line.name || '').slice(0, 40),
        fmt(line.quantity),
        line.warehouse_id || '',
        line.type || '',
        line.status || '',
      ].join(' | '),
    )
  }

  console.log('\n=== Per-item: period amount vs recon opening qty (top by amount) ===')
  const itemCompare = familyZohoItems.map((it) => {
    const row = {
      sku: it.sku,
      item_id: it.item_id,
      item_name: it.item_name,
    }
    return {
      ...it,
      period_qty: mapLookupForReportRow(periodQtyMap, row),
      period_amt: mapLookupForReportRow(periodAmtMap, row),
      recon_open_qty: mapLookupForReportRow(reconOpenQtyMap, row),
      recon_all_qty: mapLookupForReportRow(reconAllQtyMap, row),
    }
  })
  const withSales = itemCompare.filter((r) => r.period_amt > 0 || r.period_qty > 0)
  withSales.sort((a, b) => b.period_amt - a.period_amt)
  console.log('sku | period_qty | period_$ | recon_open_qty | recon_all_qty')
  for (const r of withSales.slice(0, 20)) {
    console.log(
      [r.sku, fmt(r.period_qty), fmt(r.period_amt), fmt(r.recon_open_qty), fmt(r.recon_all_qty)].join(
        ' | ',
      ),
    )
  }
  console.log(`  items with period sales $ > 0: ${withSales.filter((r) => r.period_amt > 0).length}`)
  console.log(
    `  items with period sales $ > 0 AND recon_open_qty = 0: ${withSales.filter((r) => r.period_amt > 0 && r.recon_open_qty === 0).length}`,
  )

  console.log('\n=== 4) In Sales Amount path but NOT in recon opening-window qty ===')
  const gapRows = []
  for (const line of periodFamLines) {
    const qty = parseLineQty(line.quantity)
    const amt = parseLineQty(line.item_total)
    if (amt <= 0 && qty <= 0) continue
    const inOpen = reconFamLinesOpen.some(
      (rl) =>
        lineCanonicalKey(rl, idToSku) === lineCanonicalKey(line, idToSku) &&
        parseLineQty(rl.quantity) > 0,
    )
    if (!inOpen) {
      gapRows.push({
        item_id: line.item_id,
        sku: line.sku,
        name: line.name,
        amount: amt,
        quantity: qty,
        reason: suspectedGapReason(line, 0),
      })
    }
  }
  gapRows.sort((a, b) => b.amount - a.amount)
  console.log(`gap_row_count=${gapRows.length}`)
  for (const g of gapRows.slice(0, 20)) {
    console.log(
      [g.item_id, g.sku, (g.name || '').slice(0, 35), fmt(g.amount), fmt(g.quantity), g.reason].join(
        ' | ',
      ),
    )
  }

  console.log('\n=== 5) Summary ===')
  console.log(
    JSON.stringify(
      {
        family,
        report_sales_amount: familyRow ? familyRow.sales_amount : null,
        period_path_family_qty: periodFamQty,
        period_path_family_amount: periodFamAmt,
        recon_opening_window_family_qty: reconOpenFamQty,
        period_lines_empty_document_date: emptyDocDatePeriod.length,
        period_lines_with_invoice_type: periodFamLines.filter((l) => l.type === 'invoice').length,
        period_lines_sales_by_item_type: periodFamLines.filter((l) => l.type === 'sales_by_item')
          .length,
        closing_as_of: closingAsOf,
        invoice_recon: {
          detail_fetches: stockReconR?.salesR?.invoice_detail_fetches,
          detail_limit: stockReconR?.salesR?.invoice_detail_fetch_limit,
          detail_truncated: stockReconR?.salesR?.invoice_detail_fetch_truncated,
          targeted_recon_complete: stockReconR?.salesR?.targeted_recon_complete,
          invoice_sort_column: stockReconR?.salesR?.invoice_sort_column,
          invoice_sort_order: stockReconR?.salesR?.invoice_sort_order,
          invoice_date_start: stockReconR?.salesR?.invoice_date_start,
          invoice_date_end: stockReconR?.salesR?.invoice_date_end,
          first_invoice_date: stockReconR?.salesR?.first_invoice_date,
          last_invoice_date: stockReconR?.salesR?.last_invoice_date,
          prefilter: stockReconR?.salesR?.prefilter,
        },
        targeted_validation_status:
          stockReconR?.salesR?.prefilter?.targeted_recon_complete === true
            ? 'full_for_target_family'
            : stockReconR?.salesR?.sales_reconstruction_partial
              ? 'partial'
              : 'full',
        likely_root_cause:
          stockReconR?.salesR?.prefilter?.targeted_recon_complete
            ? 'Targeted recon: enough matching dated invoice lines for family validation window'
            : stockReconR?.salesR?.invoice_detail_fetch_truncated
            ? 'Invoice detail cap hit — raise WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT or narrow date range'
            : closingAsOf &&
                stockReconR?.salesR?.source === 'zoho_inventory_reports_salesbyitem' &&
                emptyDocDatePeriod.length === periodFamLines.length
              ? 'Recon used salesbyitem (requireDatedSalesLines not applied) — use production path or --closing-as-of'
              : closingAsOf &&
                  emptyDocDatePeriod.length === periodFamLines.length &&
                  periodFamLines.length > 0 &&
                  reconOpenFamQty === 0
                ? 'Sales-by-Item has no document_date; use dated invoice lines for recon'
                : periodFamAmt > 0 && reconOpenFamQty === 0
                  ? 'Period amount from salesbyitem; recon opening window has no matched dated sales'
                  : 'See gap rows above',
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch {
      /* ignore */
    }
  })

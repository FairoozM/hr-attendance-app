#!/usr/bin/env node
/**
 * Compare Weekly Sales Report totals across reconstruction feature-flag modes.
 * Investigation / validation only — does not change calculations, routes, or DB data.
 *
 * Usage:
 *   node backend/scripts/validate-weekly-report-reconstruction.js \
 *     --group slow_moving --from 2026-05-01 --to 2026-05-18 --limit 20
 *
 *   node backend/scripts/validate-weekly-report-reconstruction.js \
 *     --group slow_moving --from 2026-05-01 --to 2026-05-18 \
 *     --warehouse-id 123 --exclude-warehouse-id 456 --limit 10
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { readZohoConfig } = require('../src/integrations/zoho/zohoConfig')
const { getInventoryByGroup } = require('../src/services/zohoService')
const { sumReportGrandTotals } = require('../src/utils/weeklyReportTotals')
const { pool } = require('../src/db')

const RECON_ENV_KEYS = [
  'WEEKLY_REPORT_RECON_PROBE_ADJUSTMENTS',
  'WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS',
  'WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE',
  'WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES',
  'WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT',
]

const MODES = [
  {
    id: 'legacy',
    label: 'legacy (no reconstruction flags)',
    env: {},
  },
  {
    id: 'adjustments_only',
    label: 'adjustments only (INCLUDE_ADJUSTMENTS=1)',
    env: { WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS: '1' },
  },
  {
    id: 'closing_as_of',
    label: 'closing as-of (CLOSING_AS_OF_TO_DATE=1)',
    env: { WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE: '1' },
  },
  {
    id: 'closing_and_adjustments',
    label: 'closing as-of + adjustments',
    env: {
      WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE: '1',
      WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS: '1',
    },
  },
]

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

function snapshotReconEnv() {
  const snap = {}
  for (const k of RECON_ENV_KEYS) {
    snap[k] = process.env[k]
  }
  return snap
}

function applyReconEnv(modeEnv) {
  for (const k of RECON_ENV_KEYS) {
    delete process.env[k]
  }
  for (const [k, v] of Object.entries(modeEnv || {})) {
    process.env[k] = v
  }
}

function restoreReconEnv(snap) {
  for (const k of RECON_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return 'null'
  return Math.round(v * 100) / 100
}

function fmtDiff(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = Math.round(v * 100) / 100
  return n > 0 ? `+${n}` : String(n)
}

function familyKey(row) {
  return String((row && row.family) || '').trim().toLowerCase()
}

function familyDisplay(row) {
  return String((row && row.family) || '').trim() || '(empty)'
}

function warningsCount(reportMeta) {
  if (!reportMeta || typeof reportMeta !== 'object') return 0
  const completeness = reportMeta.completeness
  if (completeness && Array.isArray(completeness.warnings)) {
    return completeness.warnings.length
  }
  if (Array.isArray(reportMeta.warnings)) return reportMeta.warnings.length
  return 0
}

function indexItemsByFamily(items) {
  const m = new Map()
  for (const row of items || []) {
    m.set(familyKey(row), row)
  }
  return m
}

function topFamilyDeltas(legacyItems, modeItems, limit) {
  const legacyBy = indexItemsByFamily(legacyItems)
  const modeBy = indexItemsByFamily(modeItems)
  const keys = new Set([...legacyBy.keys(), ...modeBy.keys()])
  const rows = []
  for (const k of keys) {
    if (!k) continue
    const legacy = legacyBy.get(k) || null
    const mode = modeBy.get(k) || null
    const lo = legacy && typeof legacy.opening_stock === 'number' ? legacy.opening_stock : null
    const mo = mode && typeof mode.opening_stock === 'number' ? mode.opening_stock : null
    const lc = legacy && typeof legacy.closing_stock === 'number' ? legacy.closing_stock : null
    const mc = mode && typeof mode.closing_stock === 'number' ? mode.closing_stock : null
    const openDiff = lo != null && mo != null ? mo - lo : null
    const closeDiff = lc != null && mc != null ? mc - lc : null
    const score = Math.max(Math.abs(openDiff || 0), Math.abs(closeDiff || 0))
    if (score <= 0) continue
    rows.push({
      family: familyDisplay(mode || legacy),
      legacyOpening: lo,
      modeOpening: mo,
      openingDiff: openDiff,
      legacyClosing: lc,
      modeClosing: mc,
      closingDiff: closeDiff,
      score,
    })
  }
  rows.sort((a, b) => b.score - a.score)
  return rows.slice(0, limit)
}

function printTotals(label, totals) {
  console.log(`  ${label}:`)
  console.log(`    opening_stock:         ${fmtMoney(totals.opening_stock)}`)
  console.log(`    closing_stock:         ${fmtMoney(totals.closing_stock)}`)
  console.log(`    purchase_amount:       ${fmtMoney(totals.purchase_amount)}`)
  console.log(`    returned_to_wholesale: ${fmtMoney(totals.returned_to_wholesale)}`)
  console.log(`    sales_amount:          ${fmtMoney(totals.sales_amount)}`)
}

function printReconstructionMeta(reportMeta) {
  const r = reportMeta && reportMeta.reconstruction
  if (!r) {
    console.log('  reconstruction: (none)')
    return
  }
  console.log(`  reconstruction.version: ${r.version || '(missing)'}`)
  console.log(`  reconstruction.closing_as_of_to_date_enabled: ${r.closing_as_of_to_date_enabled === true}`)
  console.log(
    `  reconstruction.sources_included_in_calculation: ${JSON.stringify(r.sources_included_in_calculation || [])}`,
  )
  console.log(
    `  reconstruction.sources_excluded_from_calculation: ${JSON.stringify(r.sources_excluded_from_calculation || [])}`,
  )
  if (r.inventoryadjustments) {
    console.log(
      `  reconstruction.inventoryadjustments.applied_to_calculation: ${r.inventoryadjustments.applied_to_calculation === true}`,
    )
    if (Number.isFinite(Number(r.inventoryadjustments.net_quantity_adjusted))) {
      console.log(
        `  reconstruction.inventoryadjustments.net_quantity_adjusted: ${r.inventoryadjustments.net_quantity_adjusted}`,
      )
    }
  }
  const sms = r.sales_movement_source
  if (sms) {
    console.log(`  reconstruction.sales_movement_source.status: ${sms.status}`)
    console.log(`  reconstruction.sales_movement_source.sales_reconstruction_partial: ${sms.sales_reconstruction_partial === true}`)
    for (const k of [
      'requires_document_dates',
      'windowed_split_date',
      'windowed_through_date',
      'opening_window_line_count',
      'closing_window_line_count',
      'opening_window_quantity',
      'closing_window_quantity',
      'invoice_list_count',
      'invoice_list_pages',
      'invoice_list_with_usable_line_items',
      'invoice_detail_fetches',
      'invoice_detail_cache_hits',
      'invoice_detail_fetch_truncated',
      'max_invoice_details',
      'invoice_sort_column',
      'invoice_sort_order',
      'invoice_date_start',
      'invoice_date_end',
      'first_invoice_date',
      'last_invoice_date',
    ]) {
      if (sms[k] != null) console.log(`  reconstruction.sales_movement_source.${k}: ${sms[k]}`)
    }
    if (sms.in_window) {
      console.log(`  reconstruction.sales_movement_source.in_window: ${JSON.stringify(sms.in_window)}`)
    }
    if (sms.after_window) {
      console.log(`  reconstruction.sales_movement_source.after_window: ${JSON.stringify(sms.after_window)}`)
    }
    if (r.closing_as_of_reconstruction_complete != null) {
      console.log(`  reconstruction.closing_as_of_reconstruction_complete: ${r.closing_as_of_reconstruction_complete}`)
    }
    if (sms.prefilter) {
      console.log(`  reconstruction.sales_movement_source.prefilter: ${JSON.stringify(sms.prefilter)}`)
    }
  }
}

function printModeComparison(modeResult, legacyResult, limit) {
  console.log('\n' + '='.repeat(72))
  console.log(`MODE: ${modeResult.label}`)
  console.log('='.repeat(72))
  console.log(`  families: ${modeResult.familyCount}  elapsed_ms: ${modeResult.elapsedMs}`)
  printTotals('totals', modeResult.totals)
  printReconstructionMeta(modeResult.reportMeta)
  console.log(`  warnings_count: ${warningsCount(modeResult.reportMeta)}`)

  if (modeResult.id === 'legacy') {
    console.log('  (baseline — no family deltas vs legacy)')
    return
  }

  const deltas = topFamilyDeltas(legacyResult.items, modeResult.items, limit)
  console.log(`\n  top ${limit} families by max(|Δopening|, |Δclosing|) vs legacy:`)
  if (deltas.length === 0) {
    console.log('    (no numeric opening/closing differences)')
    return
  }
  for (const d of deltas) {
    console.log(`    - ${d.family}`)
    console.log(
      `      opening: legacy ${fmtMoney(d.legacyOpening)} → mode ${fmtMoney(d.modeOpening)} (Δ ${fmtDiff(d.openingDiff)})`,
    )
    console.log(
      `      closing: legacy ${fmtMoney(d.legacyClosing)} → mode ${fmtMoney(d.modeClosing)} (Δ ${fmtDiff(d.closingDiff)})`,
    )
  }
}

function printHelp() {
  console.log(`Usage:
  node backend/scripts/validate-weekly-report-reconstruction.js \\
    --group <report_group> --from YYYY-MM-DD --to YYYY-MM-DD [--limit N]

Options:
  --group                 Report group key (e.g. slow_moving)
  --from                  Period start (YYYY-MM-DD)
  --to                    Period end (YYYY-MM-DD)
  --warehouse-id          Optional Zoho warehouse scope
  --exclude-warehouse-id  Optional warehouse exclusion (e.g. damaged)
  --limit                 Top N families to show per mode (default 20)
  --max-invoice-pages N     Cap invoice list pages for dated recon (default 2)
  --max-invoice-details N   Cap GET /invoices/{id} fan-out (default 80)

Modes compared (sequential, same Zoho fetches per run):
  1. legacy — no reconstruction flags
  2. adjustments only — WEEKLY_REPORT_RECON_INCLUDE_ADJUSTMENTS=1
  3. closing as-of — WEEKLY_REPORT_RECON_CLOSING_AS_OF_TO_DATE=1
  4. closing as-of + adjustments — both flags

See docs/weekly-sales-reconstruction-validation.md`)
}

async function runMode(mode, group, fromDate, toDate, warehouseId, excludeWarehouseId) {
  const t0 = Date.now()
  const { items, reportMeta } = await getInventoryByGroup(
    group,
    fromDate,
    toDate,
    warehouseId,
    excludeWarehouseId,
    { includeItemDetails: false },
  )
  return {
    id: mode.id,
    label: mode.label,
    items,
    totals: sumReportGrandTotals(items),
    reportMeta: reportMeta || {},
    familyCount: Array.isArray(items) ? items.length : 0,
    elapsedMs: Date.now() - t0,
  }
}

async function main() {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp()
    return
  }

  const group = argValue('group', '')
  const fromDate = argValue('from', '')
  const toDate = argValue('to', '')
  const warehouseId = argValue('warehouse-id', '') || null
  const excludeWarehouseId = argValue('exclude-warehouse-id', '') || null
  const limit = Math.max(1, Math.min(100, parseInt(argValue('limit', '20'), 10) || 20))
  const modesArg = argValue('modes', '')
  const wantedModeIds = modesArg
    ? new Set(
        String(modesArg)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null

  if (!group || !fromDate || !toDate) {
    printHelp()
    process.exitCode = 1
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('--from and --to must be YYYY-MM-DD')
  }
  if (fromDate > toDate) {
    throw new Error('--from must be <= --to')
  }

  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') {
    throw new Error(
      `Zoho is not configured (${cfg.missing && cfg.missing.length ? cfg.missing.join(', ') : cfg.code})`,
    )
  }

  const envSnap = snapshotReconEnv()
  const results = []

  console.log('Weekly Sales Report — reconstruction mode comparison')
  console.log(`  group: ${group}`)
  console.log(`  from:  ${fromDate}`)
  console.log(`  to:    ${toDate}`)
  console.log(`  warehouse_id: ${warehouseId || '(all)'}`)
  console.log(`  exclude_warehouse_id: ${excludeWarehouseId || '(none)'}`)
  console.log(`  family_delta_limit: ${limit}`)
  console.log(`  Zoho org: ${cfg.organizationId || '(unknown)'}`)
  const invoiceMaxPages = argValue('max-invoice-pages', process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES || '2')
  const invoiceDetailLimit = argValue('max-invoice-details', process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT || '80')
  process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES = String(invoiceMaxPages)
  process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT = String(invoiceDetailLimit)
  console.log(`  invoice_caps: max_pages=${invoiceMaxPages} max_details=${invoiceDetailLimit}`)

  const activeModes = wantedModeIds
    ? MODES.filter((m) => wantedModeIds.has(m.id))
    : MODES
  if (wantedModeIds && activeModes.length === 0) {
    throw new Error(
      `--modes filter matched none of: ${MODES.map((m) => m.id).join(', ')}`,
    )
  }
  if (wantedModeIds && !activeModes.some((m) => m.id === 'legacy')) {
    activeModes.unshift(MODES[0])
  }
  console.log(`  modes: ${activeModes.map((m) => m.id).join(', ')}`)

  try {
    for (const mode of activeModes) {
      applyReconEnv(mode.env)
      // eslint-disable-next-line no-await-in-loop
      const result = await runMode(mode, group, fromDate, toDate, warehouseId, excludeWarehouseId)
      results.push(result)
      console.log(`\n[ok] ${mode.id} — ${result.familyCount} families in ${result.elapsedMs}ms`)
    }
  } finally {
    restoreReconEnv(envSnap)
  }

  const legacy = results.find((r) => r.id === 'legacy')
  if (!legacy) {
    throw new Error('legacy mode result missing')
  }

  console.log('\n' + '#'.repeat(72))
  console.log('SUMMARY')
  console.log('#'.repeat(72))
  printTotals('legacy totals', legacy.totals)

  for (const mode of results) {
    printModeComparison(mode, legacy, limit)
  }

  console.log('\nDone. No database writes. Calculation code unchanged.')
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

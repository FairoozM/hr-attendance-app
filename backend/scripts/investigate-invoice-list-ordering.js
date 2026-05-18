#!/usr/bin/env node
/**
 * Read-only investigation: invoice list ordering and date params used by
 * dated sales reconstruction (closing-as-of).
 *
 * - Confirms which date_start/date_end the recon path actually sends
 * - Fetches one page (200 rows) with several sort_column/sort_order
 *   combinations to observe ordering and date coverage
 * - Optionally narrows date_end to the selected report to_date to see if
 *   April invoices appear ahead of the cap
 *
 * Usage:
 *   node backend/scripts/investigate-invoice-list-ordering.js \
 *     --from 2026-04-01 --to 2026-04-30
 *
 * Optional:
 *   --through 2026-05-18         (default: today; matches production recon date_end)
 *   --max-pages 1                (default 1; per-mode page cap)
 *   --probe-sort                 (try sort_column=date with sort_order A and D)
 *   --probe-narrow               (try date_end = to_date instead of throughDate)
 *
 * Investigation only. No production code, calculations, or flags changed.
 */
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { readZohoConfig, INVENTORY_V1 } = require('../src/integrations/zoho/zohoConfig')
const { zohoInventoryJsonRequest } = require('../src/services/zohoApiClient')
const { isoDateLocal } = require('../src/integrations/zoho/weeklyReportZohoTransactions')
const { pool } = require('../src/db')

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
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

async function fetchOneInvoicePage({ dateStart, dateEnd, perPage, sortColumn, sortOrder, label }) {
  const cfg = readZohoConfig()
  if (cfg.code !== 'ok') throw new Error('Zoho not configured')
  const p = new URLSearchParams()
  p.set('organization_id', cfg.organizationId)
  p.set('page', '1')
  p.set('per_page', String(perPage))
  if (dateStart) p.set('date_start', dateStart)
  if (dateEnd) p.set('date_end', dateEnd)
  if (sortColumn) p.set('sort_column', sortColumn)
  if (sortOrder) p.set('sort_order', sortOrder)
  const t0 = Date.now()
  const json = await zohoInventoryJsonRequest(`${INVENTORY_V1}/invoices`, p, 'GET', undefined, {
    source: 'invoice_list_probe',
    cacheCategory: 'sales_orders',
    cacheKey: `zoho:probe:invoices:${dateStart}:${dateEnd}:p1:per${perPage}:${sortColumn || ''}:${sortOrder || ''}`,
    skipCache: true,
  })
  const rows = Array.isArray(json?.invoices) ? json.invoices : []
  const elapsed = Date.now() - t0
  const dates = rows.map((r) => (r?.date ? String(r.date).slice(0, 10) : ''))
  const first = dates.slice(0, 20)
  const last = dates.slice(-5)
  const min = dates.filter(Boolean).sort()[0] || ''
  const max = dates.filter(Boolean).sort().slice(-1)[0] || ''
  const inApr = dates.filter((d) => d >= '2026-04-01' && d <= '2026-04-30').length
  const inMay = dates.filter((d) => d >= '2026-05-01' && d <= '2026-05-31').length
  const params = Object.fromEntries(p.entries())
  delete params.organization_id
  return { label, rows, elapsed, min, max, inApr, inMay, first, last, params }
}

function printPageSummary(probe) {
  console.log(`\n--- ${probe.label} ---`)
  console.log(
    `params: ${JSON.stringify(probe.params)} -> ${probe.rows.length} rows in ${probe.elapsed}ms`,
  )
  console.log(`  date_min=${probe.min}  date_max=${probe.max}  apr_count=${probe.inApr}  may_count=${probe.inMay}`)
  console.log(`  first_20_dates: ${probe.first.join(', ')}`)
  console.log(`  last_5_dates:   ${probe.last.join(', ')}`)
  if (probe.rows[0]) {
    const r = probe.rows[0]
    console.log(
      `  first_row: invoice_id=${r.invoice_id} invoice_number=${r.invoice_number} date=${r.date} status=${r.status} total=${r.total}`,
    )
  }
}

async function main() {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(`Usage:
  node backend/scripts/investigate-invoice-list-ordering.js \\
    --from 2026-04-01 --to 2026-04-30 [--through 2026-05-18] \\
    [--probe-sort] [--probe-narrow]

Investigation only. Read-only. No production calculations changed.`)
    return
  }

  const fromDate = argValue('from', '2026-04-01')
  const toDate = argValue('to', '2026-04-30')
  const throughDate = argValue('through', isoDateLocal())
  const perPage = parseInt(argValue('per-page', '200'), 10) || 200
  const probeSort = hasFlag('probe-sort')
  const probeNarrow = hasFlag('probe-narrow')

  console.log('Invoice list ordering / date-param probe (read-only)')
  console.log(`  selected report: from=${fromDate} to=${toDate}  throughDate=${throughDate}`)
  console.log(`  page_size=${perPage}`)
  console.log('  production recon path sends: date_start=from, date_end=throughDate (NOT to_date)')

  const probes = []

  probes.push(
    await fetchOneInvoicePage({
      dateStart: fromDate,
      dateEnd: throughDate,
      perPage,
      label: `prod-style: date_start=${fromDate}&date_end=${throughDate}  (no sort param)`,
    }),
  )

  if (probeSort) {
    probes.push(
      await fetchOneInvoicePage({
        dateStart: fromDate,
        dateEnd: throughDate,
        perPage,
        sortColumn: 'date',
        sortOrder: 'A',
        label: `prod-range + sort_column=date sort_order=A (oldest first)`,
      }),
    )
    probes.push(
      await fetchOneInvoicePage({
        dateStart: fromDate,
        dateEnd: throughDate,
        perPage,
        sortColumn: 'date',
        sortOrder: 'D',
        label: `prod-range + sort_column=date sort_order=D (newest first)`,
      }),
    )
  }

  if (probeNarrow) {
    probes.push(
      await fetchOneInvoicePage({
        dateStart: fromDate,
        dateEnd: toDate,
        perPage,
        label: `narrow-range: date_start=${fromDate}&date_end=${toDate}  (no sort param)`,
      }),
    )
    if (probeSort) {
      probes.push(
        await fetchOneInvoicePage({
          dateStart: fromDate,
          dateEnd: toDate,
          perPage,
          sortColumn: 'date',
          sortOrder: 'A',
          label: `narrow-range + sort_column=date sort_order=A`,
        }),
      )
    }
  }

  for (const p of probes) printPageSummary(p)

  console.log('\n=== Conclusions ===')
  const prod = probes[0]
  const prodAprFirst80 = (prod.first.slice(0, 20).filter((d) => d >= '2026-04-01' && d <= '2026-04-30')).length
  console.log(
    JSON.stringify(
      {
        production_date_params: prod.params,
        production_first_page_first_20_april_count: prodAprFirst80,
        production_first_page_apr_total: prod.inApr,
        production_first_page_may_total: prod.inMay,
        production_first_page_date_min: prod.min,
        production_first_page_date_max: prod.max,
        narrow_range_helps:
          probeNarrow && probes.find((x) => x.label.startsWith('narrow-range')) != null,
        sort_column_supported_hint:
          probeSort && probes[1] && probes[1].first[0] && probes[2] && probes[2].first[0]
            ? probes[1].first[0] < probes[2].first[0]
              ? 'yes — sort_column=date with sort_order A/D produced different ordering'
              : 'inconclusive — first row identical (Zoho may have ignored sort params)'
            : 'not probed',
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e && e.stack ? e.stack : e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch {}
  })

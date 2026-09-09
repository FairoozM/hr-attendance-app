#!/usr/bin/env node
'use strict'

/**
 * Reconciliation harness for the Daily Ecommerce Report.
 *
 * For each requested Dubai date it prints, per channel: what the marketplace integration cached,
 * what the provider included, and what the report finally shows — so the three figures the report
 * has to agree on can be compared at a glance.
 *
 * Usage: node scripts/reconcile-daily-ecommerce-report.js 2026-09-07 2026-09-08
 *
 * Read-only. It builds the report exactly as the API does; it syncs nothing.
 */

require('dotenv').config()

const {
  buildDailyEcommerceReport,
} = require('../src/services/dailyEcommerceReport/dailyEcommerceReportService')

const dates = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
if (!dates.length) dates.push(new Date().toISOString().slice(0, 10))

function fmt(value) {
  if (value == null) return 'Pending'
  return typeof value === 'number' ? value.toFixed(2) : String(value)
}

;(async () => {
  for (const date of dates) {
    const report = await buildDailyEcommerceReport({ date, includeLiveAds: false })
    console.log(`\n===== ${date} (${report.timezone}) SAR→AED ${report.exchangeRate.rateDisplay}`)
    for (const ch of report.channels) {
      const r = ch.reconciliation || {}
      console.log(
        [
          ch.label.padEnd(20),
          `status=${ch.integrationStatus}`,
          `orders=${ch.orders.length}`,
          `qty=${ch.summary.quantity == null ? 'N/A' : ch.summary.quantity}`,
          `amount=${fmt(ch.summary.salesAmountAED)}`,
          `commission=${fmt(ch.summary.commissionAED)}`,
          `shipping=${fmt(ch.summary.shippingAED)}`,
          `balance=${fmt(ch.summary.balanceAED)}`,
        ].join(' | '),
      )
      if (Object.keys(r).length) console.log(`  reconciliation: ${JSON.stringify(r)}`)
      console.log(`  source: ${ch.dataSource || 'n/a'} lastSynced=${ch.lastSyncedAt || 'n/a'}`)
      for (const order of ch.orders) {
        console.log(
          `    ${String(order.orderNumber).padEnd(24)} ${String(order.status || '').padEnd(12)} ` +
            `${fmt(order.amountAED).padStart(10)} ${order.amountSource || ''} ` +
            order.items.map((i) => `${i.sku}×${i.quantity ?? 'N/A'}`).join(', '),
        )
      }
      for (const w of ch.warnings || []) console.log(`  ! ${w}`)
    }
    console.log(
      `TOTALS qty=${report.totals.quantity} amount=${fmt(report.totals.salesAmountAED)} ` +
        `commission=${fmt(report.totals.commissionAED)} shipping=${fmt(report.totals.shippingAED)} ` +
        `balance=${fmt(report.totals.balanceAED)}`,
    )
    for (const w of report.warnings || []) console.log(`! ${w}`)
  }
  process.exit(0)
})().catch((err) => {
  console.error('reconciliation failed:', err)
  process.exit(1)
})

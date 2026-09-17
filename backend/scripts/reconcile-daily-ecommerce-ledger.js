#!/usr/bin/env node
'use strict'

/**
 * Live reconciliation for Daily Ecommerce Ledger vs legacy paper 12.09.2026.
 * Usage: node scripts/reconcile-daily-ecommerce-ledger.js [YYYY-MM-DD]
 * Read-only. Does not deploy.
 */

require('dotenv').config()

const { buildDailyEcommerceLedger } = require('../src/services/ecommerceLedger/dailyEcommerceLedgerService')

const REPORT_DATE = process.argv[2] || '2026-09-12'

const LEGACY = {
  sales: { opening: 2477667.6, movement: 8192.1, closing: 2485859.7, saleReturn: 804 },
  cashInHand: { opening: 1024.89, closing: 1024.89, movement: 0 },
  expenses: { opening: 1787182.99, movement: 10668.5, closing: 1797851.49 },
  purchasePayments: { opening: 541492.02, closing: 541492.02, movement: 0 },
  basmatPayable: { opening: 197106.32, movement: 10668.5, closing: 207774.82 },
  rak: { opening: 56285.38, closing: 56285.38, movement: 0 },
  nbd: { opening: 22967.96, closing: 22967.96, movement: 0 },
}

function d(a, b) {
  return Math.round((Number(a) - Number(b)) * 100) / 100
}

function row(name, legacy, sys) {
  const lo = legacy.opening
  const so = sys?.opening
  const lm = legacy.movement ?? 0
  const sm = sys?.netMovement ?? 0
  const lc = legacy.closing
  const sc = sys?.closing
  return {
    Section: name,
    LegacyOpening: lo,
    SystemOpening: so,
    DiffOpening: d(so, lo),
    LegacyMovement: lm,
    SystemMovement: sm,
    DiffMovement: d(sm, lm),
    LegacyClosing: lc,
    SystemClosing: sc,
    DiffClosing: d(sc, lc),
  }
}

async function main() {
  console.log(`Reconciling Daily Ecommerce Ledger for ${REPORT_DATE}\n`)
  const report = await buildDailyEcommerceLedger({ date: REPORT_DATE })
  const s = report.sections

  const table = [
    row('Sales', LEGACY.sales, s.sales),
    row('Cash in Hand', LEGACY.cashInHand, s.cashInHand),
    row('Expenses', LEGACY.expenses, s.expenses),
    row(
      'Purchase & Payments',
      LEGACY.purchasePayments,
      s.purchasePayments.configMissing
        ? { opening: null, closing: null, netMovement: null }
        : s.purchasePayments
    ),
    row('Basmat Payable', LEGACY.basmatPayable, s.basmatPayable),
    row('RAK Bank', LEGACY.rak, s.banks?.[0]),
    row('NBD Credit Card', LEGACY.nbd, s.creditCards?.[0]),
  ]

  console.log('=== Section reconciliation ===')
  console.table(table)

  console.log('\nSale return: legacy', LEGACY.sales.saleReturn, 'system', s.sales.saleReturn)
  console.log("Today's sale: legacy", LEGACY.sales.movement, 'system', s.sales.todaySale)

  const invoices = (s.sales.rows || []).filter((r) => String(r.reference || '').startsWith('INV-'))
  console.log('\n=== System invoices on day (no legacy invoice list provided) ===')
  console.table(
    invoices.map((r) => ({
      Invoice: r.reference,
      Description: r.description,
      SystemAmount: r.sale,
      Match: 'n/a (legacy invoice amounts not supplied)',
    }))
  )

  if (s.purchasePayments.configMissing) {
    console.log('\nPurchase & Payments: CONFIG MISSING — set DAILY_LEDGER_PURCHASE_PAYMENTS_ACCOUNT_ID')
  }
  for (const w of s.sales.warnings || []) console.log('Sales warning:', w)
  for (const w of s.expenses.warnings || []) console.log('Expense warning:', w)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

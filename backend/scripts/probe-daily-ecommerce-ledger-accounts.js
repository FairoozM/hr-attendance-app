#!/usr/bin/env node
'use strict'

/**
 * Read-only Zoho Books CoA probe for Daily Ecommerce Ledger account resolution.
 *
 * Usage: node scripts/probe-daily-ecommerce-ledger-accounts.js [YYYY-MM-DD]
 *
 * Dumps chart of accounts (with parent_account_id) and scores name matches for
 * legacy ledger sections. Optionally prints balances for high-scoring candidates.
 * No writes.
 */

require('dotenv').config()

const { zohoBooksJsonRequest } = require('../src/services/zohoApiClient')

const REPORT_DATE = process.argv[2] || '2026-09-12'
const BOOKS_V3 = '/books/v3'

const LEGACY_TARGETS = {
  salesOpening: 2477667.6,
  cashOpening: 1024.89,
  expenseOpening: 1787182.99,
  purchaseOpening: 541492.02,
  basmatOpening: 197106.32,
  rakOpening: 56285.38,
  nbdCcOpening: 22967.96,
}

const SECTION_NAME_HINTS = {
  sales: [/sales/i, /income/i, /revenue/i, /ecommerce.?sale/i],
  cashInHand: [/cash in hand/i, /^cash$/i, /petty cash/i, /cash on hand/i],
  expense: [/^expense/i, /expenses$/i, /total expense/i],
  fixedExpenses: [/fixed.?expense/i],
  flexibleExpenses: [/flexible.?expense/i],
  purchasePayments: [/purchase.?&.?payment/i, /purchase and payment/i, /purchases? & payments?/i],
  basmatPayable: [/basmat.?payable/i, /payable against cash/i, /basmat cash/i],
  banks: [/rak/i, /rakbank/i, /rak bank/i],
  creditCards: [/nbd/i, /credit.?card/i, /245/],
  basmatCashEcommerce: [/basmat cash for ecommerce/i],
}

function clean(v) {
  return v == null ? '' : String(v).trim()
}

function parseBalance(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function scoreName(name, patterns) {
  const n = clean(name)
  if (!n) return 0
  let score = 0
  for (const re of patterns) {
    if (re.test(n)) score += 10
  }
  return score
}

async function fetchAllChartOfAccounts() {
  const all = []
  let page = 1
  while (page <= 20) {
    const params = new URLSearchParams({
      showbalance: 'true',
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/chartofaccounts`,
      params,
      'GET',
      undefined,
      { source: 'probe_daily_ledger_coa', skipCache: true }
    )
    const batch = Array.isArray(json?.chartofaccounts)
      ? json.chartofaccounts
      : Array.isArray(json?.accounts)
        ? json.accounts
        : []
    all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all.map((a) => ({
    accountId: clean(a.account_id || a.id),
    accountName: clean(a.account_name || a.name),
    accountCode: clean(a.account_code || a.code),
    accountType: clean(a.account_type || a.type),
    parentAccountId: clean(a.parent_account_id || a.parent_id || ''),
    isActive: a.is_active !== false,
    currentBalance: parseBalance(a.current_balance ?? a.balance),
    closingBalance: parseBalance(a.closing_balance),
    raw: a,
  }))
}

function nearestAbs(target, accounts) {
  return accounts
    .filter((a) => a.currentBalance != null)
    .map((a) => ({
      ...a,
      diff: Math.abs(Math.abs(a.currentBalance) - Math.abs(target)),
      absBal: Math.abs(a.currentBalance),
    }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 8)
}

function findByHints(accounts, patterns) {
  return accounts
    .map((a) => ({ ...a, score: scoreName(a.accountName, patterns) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || a.accountName.localeCompare(b.accountName))
}

function printAccount(a, extra = '') {
  const bal = a.currentBalance != null ? a.currentBalance.toFixed(2) : 'n/a'
  console.log(
    `  ${a.accountCode || '—'} | ${a.accountId} | ${a.accountType} | bal=${bal} | ${a.accountName}${extra}`
  )
}

async function main() {
  console.log(`=== Daily Ecommerce Ledger CoA probe (as of balances; report date ${REPORT_DATE}) ===\n`)
  const accounts = await fetchAllChartOfAccounts()
  console.log(`Fetched ${accounts.length} chart of accounts rows.\n`)

  console.log('--- Name hint matches ---')
  for (const [key, patterns] of Object.entries(SECTION_NAME_HINTS)) {
    const hits = findByHints(accounts, patterns).slice(0, 12)
    console.log(`\n[${key}] (${hits.length} hits)`)
    for (const a of hits) printAccount(a, ` score=${a.score}`)
  }

  console.log('\n--- Nearest |balance| to legacy openings (current Zoho balance; may differ from historical) ---')
  for (const [key, target] of Object.entries(LEGACY_TARGETS)) {
    console.log(`\n[${key}] target=${target}`)
    for (const a of nearestAbs(target, accounts)) {
      printAccount(a, ` |diff|=${a.diff.toFixed(2)}`)
    }
  }

  const parents = accounts.filter((a) => !a.parentAccountId)
  const withParent = accounts.filter((a) => a.parentAccountId)
  console.log(`\nHierarchy: ${withParent.length} children, ${parents.length} without parent_account_id`)

  const fixed = findByHints(accounts, SECTION_NAME_HINTS.fixedExpenses)
  const flex = findByHints(accounts, SECTION_NAME_HINTS.flexibleExpenses)
  console.log('\n--- Fixed / Flexible parents ---')
  for (const a of fixed.slice(0, 5)) printAccount(a)
  for (const a of flex.slice(0, 5)) printAccount(a)

  // Emit a suggested JSON skeleton for config (IDs empty if ambiguous)
  const pick = (key) => findByHints(accounts, SECTION_NAME_HINTS[key])[0] || null
  const suggested = {
    reportDateProbed: REPORT_DATE,
    sales: pick('sales'),
    cashInHand: pick('cashInHand'),
    expense: pick('expense'),
    fixedExpensesParent: fixed[0] || null,
    flexibleExpensesParent: flex[0] || null,
    purchasePayments: pick('purchasePayments'),
    basmatPayableAgainstCash: pick('basmatPayable') || pick('basmatCashEcommerce'),
    banks: findByHints(accounts, SECTION_NAME_HINTS.banks).slice(0, 5),
    creditCards: findByHints(accounts, SECTION_NAME_HINTS.creditCards).slice(0, 5),
  }
  console.log('\n=== Suggested candidates (verify before committing IDs) ===')
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(suggested).map(([k, v]) => {
          if (Array.isArray(v)) {
            return [
              k,
              v.map((a) => ({
                accountId: a.accountId,
                accountCode: a.accountCode,
                accountName: a.accountName,
                accountType: a.accountType,
                currentBalance: a.currentBalance,
              })),
            ]
          }
          if (v && typeof v === 'object' && v.accountId) {
            return [
              k,
              {
                accountId: v.accountId,
                accountCode: v.accountCode,
                accountName: v.accountName,
                accountType: v.accountType,
                currentBalance: v.currentBalance,
              },
            ]
          }
          return [k, v]
        })
      ),
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error('Probe failed:', err.message || err)
  process.exitCode = 1
})

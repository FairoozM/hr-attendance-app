'use strict'

/**
 * Unit tests for Daily Ecommerce Ledger builder with Zoho reads mocked.
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const Module = require('module')

const READS = path.resolve(__dirname, '../src/services/ecommerceAccounting/zohoBooksReads.js')
const SERVICE = path.resolve(__dirname, '../src/services/ecommerceLedger/dailyEcommerceLedgerService.js')

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

function stubReads(stubs) {
  const original = Module._load
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain)
    if (resolved === READS) {
      return {
        fetchSalesByCustomerTotal: stubs.fetchSalesByCustomerTotal,
        fetchInvoicesForDay: stubs.fetchInvoicesForDay,
        fetchCreditNotesForDay: stubs.fetchCreditNotesForDay,
        fetchAccountDetail: stubs.fetchAccountDetail,
        fetchBankTransactionsSince: stubs.fetchBankTransactionsSince,
        fetchAccountTransactionNumbers:
          stubs.fetchAccountTransactionNumbers || (async () => new Map()),
        fetchExpenseNotesByAccount: stubs.fetchExpenseNotesByAccount || (async () => new Map()),
        fetchExpensesByCategory: stubs.fetchExpensesByCategory || (async () => []),
        fetchPnlExpenseAccountIds: stubs.fetchPnlExpenseAccountIds || (async () => new Set()),
      }
    }
    return original(request, parent, isMain)
  }
  return () => {
    Module._load = original
  }
}

describe('dailyEcommerceLedgerService (mocked Zoho)', () => {
  let restore

  afterEach(() => {
    if (restore) restore()
    restore = null
    delete require.cache[SERVICE]
    delete require.cache[READS]
  })

  it('builds sales day with invoices, return, and closing identity', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async (from, to) => {
        if (from === '2026-09-12' && to === '2026-09-12') return { salesWithTax: 8192.1 }
        return { salesWithTax: 2477667.6 }
      },
      fetchInvoicesForDay: async () => ({
        rows: [
          { invoice_number: 'INV-1', date: '2026-09-12', total: 5000, customer_name: 'Amazon' },
          { invoice_number: 'INV-2', date: '2026-09-12', total: 3996.1, customer_name: 'Noon' },
        ],
        truncated: false,
      }),
      fetchCreditNotesForDay: async () => ({
        rows: [{ creditnote_number: 'CN-1', date: '2026-09-12', total: 804, customer_name: 'Amazon' }],
        truncated: false,
      }),
      fetchAccountDetail: async () => ({
        account_name: 'Cash In Hand',
        account_code: '1011',
        account_type: 'cash',
        closing_balance: 1024.89,
      }),
      fetchBankTransactionsSince: async () => [],
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })

    assert.equal(report.dayName, 'Saturday')
    assert.equal(report.sections.sales.opening, 2477667.6)
    assert.equal(report.sections.sales.todaySale, 8192.1)
    assert.equal(report.sections.sales.saleReturn, 804)
    assert.equal(report.sections.sales.closing, 2485859.7)
    assert.ok(report.sections.sales.rows.some((r) => r.reference === 'INV-1'))
    assert.ok(report.sections.sales.rows.some((r) => r.isSalesReturn))
  })

  it('reports KSA invoices in AED, not their SAR face value', async () => {
    // Zoho posts AED (base currency) for a SAR invoice: 489 SAR @ 0.979 = 478.73.
    restore = stubReads({
      fetchSalesByCustomerTotal: async (from, to) => {
        if (from === to) return { salesWithTax: 578.73 }
        return { salesWithTax: 1000 }
      },
      fetchInvoicesForDay: async () => ({
        rows: [
          { invoice_number: 'INV-AED', date: '2026-09-16', total: 100, customer_name: 'Website' },
          {
            invoice_number: 'INV-043972',
            date: '2026-09-16',
            total: 489,
            bcy_total: 478.73,
            currency_code: 'SAR',
            exchange_rate: 0.979,
            customer_name: 'KSA-Amazon',
          },
        ],
        truncated: false,
      }),
      fetchCreditNotesForDay: async () => ({
        rows: [
          {
            creditnote_number: 'CN-SAR',
            date: '2026-09-16',
            total: 100,
            currency_code: 'SAR',
            exchange_rate: 0.979,
          },
        ],
        truncated: false,
      }),
      fetchAccountDetail: async () => ({
        account_name: 'Cash In Hand',
        account_type: 'cash',
        closing_balance: 0,
      }),
      fetchBankTransactionsSince: async () => [],
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-16' })
    const sales = report.sections.sales

    const ksa = sales.rows.find((r) => r.reference === 'INV-043972')
    assert.equal(ksa.sale, 478.73)
    assert.equal(ksa.currencyCode, 'SAR')
    assert.equal(ksa.originalAmount, 489)
    assert.equal(sales.rows.find((r) => r.reference === 'INV-AED').currencyCode, undefined)

    // Gross and the return fall out in AED, so the day reconciles with salesbycustomer.
    assert.equal(sales.grossInvoiceTotal, 578.73)
    assert.equal(sales.saleReturn, 97.9)
    assert.ok(sales.warnings.some((w) => w.includes('SAR invoices are shown in AED')))
  })

  it('handles zero-sale / no-activity day', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async (id) => ({
        account_name: id,
        account_code: 'X',
        account_type: 'bank',
        closing_balance: 100,
      }),
      fetchBankTransactionsSince: async () => [],
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-01-01' })
    assert.equal(report.sections.sales.opening, 0)
    assert.equal(report.sections.sales.closing, 0)
    assert.equal(report.sections.expenses.opening, 0)
    assert.equal(report.sections.cashInHand.opening, 100)
    assert.equal(report.sections.cashInHand.closing, 100)
  })

  it('expenses come from Expense Summary by Category, Fixed and Flexible combined', async () => {
    // Same source and totals as Daily Accounting Summary, without the split:
    // closing is the year-to-date total, today is the day, opening is the rest.
    const COMMISSION = '4265011000000708205' // Amazon Commission Exp (flexible)
    const SALARIES = '4265011000009042886' // Employees Salaries Expenses (fixed)
    const UNCLASSIFIED = '4265011000099999999'

    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({
        account_name: 'Cash',
        account_type: 'cash',
        closing_balance: 0,
      }),
      fetchBankTransactionsSince: async () => [],
      fetchPnlExpenseAccountIds: async () => new Set([COMMISSION, SALARIES, UNCLASSIFIED]),
      fetchExpensesByCategory: async (from, to) => {
        if (from === '2026-09-12' && to === '2026-09-12') {
          return [
            { accountId: COMMISSION, accountName: 'Amazon Commission Exp', amount: 4800 },
            { accountId: SALARIES, accountName: 'Employees Salaries Expenses', amount: 5868.5 },
          ]
        }
        return [
          { accountId: COMMISSION, accountName: 'Amazon Commission Exp', amount: 900000 },
          { accountId: SALARIES, accountName: 'Employees Salaries Expenses', amount: 898197.1 },
          { accountId: UNCLASSIFIED, accountName: 'Miscellaneous', amount: 500 },
        ]
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    const expenses = report.sections.expenses
    assert.equal(expenses.opening, 1787528.6)
    assert.equal(expenses.netMovement, 10668.5)
    assert.equal(expenses.closing, 1798197.1)
    assert.equal(expenses.rows.length, 2)
    assert.equal(expenses.rows[0].reference, SALARIES)
    assert.equal(expenses.rows[0].description, 'Employees Salaries Expenses')
    assert.equal(expenses.rows[0].debit, 5868.5)
    assert.equal(expenses.rows[1].balance, 1798197.1)
    assert.ok(expenses.warnings.some((w) => w.includes('Miscellaneous (500)')))
  })

  it('expense rows carry the notes typed on that account in Zoho expenses', async () => {
    const WAREHOUSE = '4265011000003071795'
    const PARKING = '4265011000020795054'
    const noteDates = []
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'Cash', account_type: 'cash', closing_balance: 0 }),
      fetchBankTransactionsSince: async () => [],
      fetchPnlExpenseAccountIds: async () => new Set([WAREHOUSE, PARKING]),
      fetchExpensesByCategory: async (from, to) => [
        { accountId: WAREHOUSE, accountName: 'Warehouse Expense', amount: from === to ? 158.56 : 1000 },
        { accountId: PARKING, accountName: 'Parking', amount: from === to ? 20 : 500 },
      ],
      fetchExpenseNotesByAccount: async (date) => {
        noteDates.push(date)
        return new Map([[WAREHOUSE, ['A4 Papers & Stationery for Warehouse', 'Stretch Film for Warehouse']]])
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-24' })
    const expenses = report.sections.expenses
    assert.ok(expenses.columns.includes('notes'))
    const warehouse = expenses.rows.find((r) => r.reference === WAREHOUSE)
    assert.equal(warehouse.notes, 'A4 Papers & Stationery for Warehouse; Stretch Film for Warehouse')
    assert.equal(expenses.rows.find((r) => r.reference === PARKING).notes, '')
    assert.deepEqual(noteDates, ['2026-09-24'])
  })

  it('keeps expense totals when the notes read fails', async () => {
    const PARKING = '4265011000020795054'
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'Cash', account_type: 'cash', closing_balance: 0 }),
      fetchBankTransactionsSince: async () => [],
      fetchPnlExpenseAccountIds: async () => new Set([PARKING]),
      fetchExpensesByCategory: async (from, to) => [
        { accountId: PARKING, accountName: 'Parking', amount: from === to ? 20 : 500 },
      ],
      fetchExpenseNotesByAccount: async () => {
        throw new Error('Zoho API HTTP 429')
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-24' })
    const expenses = report.sections.expenses
    assert.equal(expenses.opening, 480)
    assert.equal(expenses.closing, 500)
    assert.equal(expenses.rows[0].notes, '')
    assert.ok(expenses.warnings.some((w) => w.includes('Expense notes unavailable')))
  })

  it('credits the expense day row when a category nets negative', async () => {
    const COMMISSION = '4265011000000708205'
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({
        account_name: 'Cash',
        account_type: 'cash',
        closing_balance: 0,
      }),
      fetchBankTransactionsSince: async () => [],
      fetchPnlExpenseAccountIds: async () => new Set([COMMISSION]),
      fetchExpensesByCategory: async (from, to) => {
        const amount = from === to ? -250 : 1000
        return [{ accountId: COMMISSION, accountName: 'Amazon Commission Exp', amount }]
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    const expenses = report.sections.expenses
    assert.equal(expenses.opening, 1250)
    assert.equal(expenses.rows[0].credit, 250)
    assert.equal(expenses.rows[0].debit, 0)
    assert.equal(expenses.closing, 1000)
  })

  it('bank section reconstructs opening from later transactions', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({
        account_name: 'RAK BANK MAIN 5061',
        account_code: 'RAK001',
        account_type: 'bank',
        closing_balance: 29183.85,
      }),
      fetchBankTransactionsSince: async () => [
        { date: '2026-09-13', amount: 1000, debit_or_credit: 'credit', transaction_id: 't1', description: 'later' },
        { date: '2026-09-20', amount: 26101.53, debit_or_credit: 'credit', transaction_id: 't2', description: 'later2' },
      ],
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async () => ({ operatingExpense: 0 }),
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    const rak = report.sections.banks[0]
    assert.equal(rak.opening, 56285.38)
    assert.equal(rak.closing, 56285.38)
    assert.equal(rak.netMovement, 0)
  })

  it('basmat credit-normal increases on expense credits', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async (id) => {
        if (id === '4265011000000543429') {
          return {
            account_name: 'BASMAT CASH FOR ECOMMERCE',
            account_code: '1006',
            account_type: 'bank',
            closing_balance: 207774.82,
          }
        }
        return { account_name: 'X', account_type: 'cash', closing_balance: 0 }
      },
      fetchBankTransactionsSince: async (id) => {
        if (id !== '4265011000000543429') return []
        return [
          {
            date: '2026-09-12',
            amount: 4800,
            debit_or_credit: 'credit',
            transaction_id: 'e1',
            description: 'Abobacker',
          },
          {
            date: '2026-09-12',
            amount: 5868.5,
            debit_or_credit: 'credit',
            transaction_id: 'e2',
            description: 'Afsal',
          },
        ]
      },
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async () => ({ operatingExpense: 0 }),
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    const b = report.sections.basmatPayable
    assert.equal(b.opening, 197106.32)
    assert.equal(b.netMovement, 10668.5)
    assert.equal(b.closing, 207774.82)
  })

  it('bank-style rows carry the Zoho Transaction# for their transaction_id', async () => {
    const lookups = []
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'Cash In Hand', account_type: 'cash', closing_balance: 831.28 }),
      fetchBankTransactionsSince: async (id) => {
        if (id !== '4265011000000706735') return []
        return [
          { date: '2026-09-21', amount: 220, debit_or_credit: 'debit', transaction_id: 'p1', payee: 'Damage Reimbursement' },
          { date: '2026-09-21', amount: 6, debit_or_credit: 'credit', transaction_id: 'x1', reference_number: 'Sufra' },
        ]
      },
      fetchAccountTransactionNumbers: async (id, from, to) => {
        lookups.push([id, from, to])
        return new Map([['p1', 'INV-044034']])
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-21' })
    const cash = report.sections.cashInHand
    assert.ok(cash.columns.includes('transactionNumber'))
    assert.equal(cash.rows[0].transactionNumber, 'INV-044034')
    assert.equal(cash.rows[1].transactionNumber, '')
    assert.deepEqual(lookups, [['4265011000000706735', '2026-09-21', '2026-09-21']])
  })

  it('keeps bank balances when the Transaction# lookup fails', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'Cash In Hand', account_type: 'cash', closing_balance: 831.28 }),
      fetchBankTransactionsSince: async (id) => {
        if (id !== '4265011000000706735') return []
        return [{ date: '2026-09-21', amount: 220, debit_or_credit: 'debit', transaction_id: 'p1', payee: 'X' }]
      },
      fetchAccountTransactionNumbers: async () => {
        throw new Error('Zoho API HTTP 429')
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-21' })
    const cash = report.sections.cashInHand
    assert.equal(cash.opening, 611.28)
    assert.equal(cash.closing, 831.28)
    assert.equal(cash.rows[0].transactionNumber, '')
    assert.ok(cash.warnings.some((w) => w.includes('Transaction# unavailable')))
  })

  it('marks purchase section configMissing when unset', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'X', account_type: 'cash', closing_balance: 0 }),
      fetchBankTransactionsSince: async () => [],
    })
    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    assert.equal(report.sections.purchasePayments.configMissing, true)
  })

  it('rejects invalid dates', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'X', account_type: 'cash', closing_balance: 0 }),
      fetchBankTransactionsSince: async () => [],
    })
    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    await assert.rejects(() => buildDailyEcommerceLedger({ date: '12/09/2026' }), /YYYY-MM-DD/)
  })
})

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
        fetchAllBankTransactions: stubs.fetchAllBankTransactions,
        fetchExpensesForDay: stubs.fetchExpensesForDay,
        fetchOperatingExpenseTotal: stubs.fetchOperatingExpenseTotal,
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
      fetchAllBankTransactions: async () => [],
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async (from, to) => {
        if (from === to) return { operatingExpense: 0 }
        return { operatingExpense: 1000 }
      },
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
      fetchAllBankTransactions: async () => [],
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async () => ({ operatingExpense: 0 }),
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-01-01' })
    assert.equal(report.sections.sales.opening, 0)
    assert.equal(report.sections.sales.closing, 0)
    assert.equal(report.sections.expenses.opening, 0)
    assert.equal(report.sections.cashInHand.opening, 100)
    assert.equal(report.sections.cashInHand.closing, 100)
  })

  it('expense day rows and P&L closing identity', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({
        account_name: 'Cash',
        account_type: 'cash',
        closing_balance: 0,
      }),
      fetchAllBankTransactions: async () => [],
      fetchExpensesForDay: async () => [
        {
          expense_id: 'e1',
          date: '2026-09-12',
          total: 4800,
          description: 'Abobacker',
          account_name: 'Salaries',
        },
        {
          expense_id: 'e2',
          date: '2026-09-12',
          total: 5868.5,
          description: 'Afsal',
          account_name: 'Salaries',
        },
      ],
      fetchOperatingExpenseTotal: async (from, to) => {
        if (from === '2026-09-12' && to === '2026-09-12') return { operatingExpense: 10668.5 }
        return { operatingExpense: 1787528.6 }
      },
    })

    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    const report = await buildDailyEcommerceLedger({ date: '2026-09-12' })
    assert.equal(report.sections.expenses.opening, 1787528.6)
    assert.equal(report.sections.expenses.netMovement, 10668.5)
    assert.equal(report.sections.expenses.closing, 1798197.1)
    assert.equal(report.sections.expenses.rows.length, 2)
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
      fetchAllBankTransactions: async () => [
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
      fetchAllBankTransactions: async (id) => {
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

  it('marks purchase section configMissing when unset', async () => {
    restore = stubReads({
      fetchSalesByCustomerTotal: async () => ({ salesWithTax: 0 }),
      fetchInvoicesForDay: async () => ({ rows: [], truncated: false }),
      fetchCreditNotesForDay: async () => ({ rows: [], truncated: false }),
      fetchAccountDetail: async () => ({ account_name: 'X', account_type: 'cash', closing_balance: 0 }),
      fetchAllBankTransactions: async () => [],
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async () => ({ operatingExpense: 0 }),
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
      fetchAllBankTransactions: async () => [],
      fetchExpensesForDay: async () => [],
      fetchOperatingExpenseTotal: async () => ({ operatingExpense: 0 }),
    })
    const { buildDailyEcommerceLedger } = freshRequire(SERVICE)
    await assert.rejects(() => buildDailyEcommerceLedger({ date: '12/09/2026' }), /YYYY-MM-DD/)
  })
})

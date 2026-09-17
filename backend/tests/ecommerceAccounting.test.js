'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  applyAccountMovement,
  attachRunningBalances,
  calculateReturnSaleRatio,
  countDaysWithSales,
  dayOfYearFromYmd,
  getDescendantAccountIds,
  isDebitNormalAccount,
} = require('../src/services/ecommerceAccounting/accountNature')
const { classifyInvoiceCashCredit } = require('../src/services/ecommerceSummary/ecommerceSummaryService')
const { emptySection } = require('../src/services/ecommerceLedger/dailyEcommerceLedgerService')

describe('ecommerceAccounting helpers', () => {
  it('dayOfYearFromYmd matches legacy 15.09.2026 = 258', () => {
    assert.equal(dayOfYearFromYmd('2026-09-15'), 258)
  })

  it('leap year day of year', () => {
    assert.equal(dayOfYearFromYmd('2024-03-01'), 61)
  })

  it('applyAccountMovement respects debit-normal assets', () => {
    assert.equal(applyAccountMovement({ debit: 100, credit: 0 }, 'cash'), 100)
    assert.equal(applyAccountMovement({ debit: 0, credit: 40 }, 'cash'), -40)
  })

  it('applyAccountMovement respects credit-normal override (Basmat payable)', () => {
    assert.equal(
      applyAccountMovement({ amount: 4800, debitOrCredit: 'credit' }, 'bank', 'credit_normal'),
      4800
    )
    assert.equal(
      applyAccountMovement({ amount: 100, debitOrCredit: 'debit' }, 'bank', 'credit_normal'),
      -100
    )
  })

  it('attachRunningBalances is decimal-safe', () => {
    const rows = attachRunningBalances(10, [{ delta: 0.1 }, { delta: 0.2 }])
    assert.equal(rows[1].balance, 10.3)
  })

  it('calculateReturnSaleRatio never returns Infinity/NaN', () => {
    assert.equal(calculateReturnSaleRatio(10, 0), null)
    assert.equal(calculateReturnSaleRatio(null, null), null)
    assert.equal(calculateReturnSaleRatio(864, 7627.61), 11.33)
  })

  it('year ratio style: returns / net sales ≈ 11%', () => {
    const r = calculateReturnSaleRatio(276584.41, 2506931.56)
    assert.ok(r != null && Math.abs(r - 11.03) < 0.02)
  })

  it('countDaysWithSales counts non-zero days only', () => {
    const map = new Map([
      ['2026-09-01', 100],
      ['2026-09-02', 0],
      ['2026-09-03', 50],
      ['2026-09-04', 0],
      ['2026-09-05', 10],
    ])
    assert.equal(countDaysWithSales(map, '2026-09-01', '2026-09-05'), 3)
  })

  it('getDescendantAccountIds walks nested parents', () => {
    const accounts = [
      { accountId: 'p', parentAccountId: '' },
      { accountId: 'c1', parentAccountId: 'p' },
      { accountId: 'c2', parentAccountId: 'c1' },
      { accountId: 'x', parentAccountId: 'other' },
    ]
    const ids = getDescendantAccountIds(accounts, 'p')
    assert.deepEqual(ids.sort(), ['c1', 'c2', 'p'])
  })

  it('isDebitNormalAccount for expense vs liability', () => {
    assert.equal(isDebitNormalAccount('expense'), true)
    assert.equal(isDebitNormalAccount('other_current_liability'), false)
  })
})

describe('cash vs credit classification', () => {
  it('treats explicit cash payment_mode as cash', () => {
    assert.equal(classifyInvoiceCashCredit({ payment_mode: 'cash', status: 'paid', total: 10 }), 'cash')
  })

  it('defaults marketplace invoices without mode to credit', () => {
    assert.equal(classifyInvoiceCashCredit({ status: 'sent', total: 100 }), 'credit')
  })
})

describe('ledger section invariants', () => {
  it('emptySection closing identity', () => {
    const s = emptySection('Test', { key: 't' })
    assert.equal(s.closing, s.opening + (s.netMovement || 0))
  })

  it('closing = opening + signed movements (credit_normal)', async () => {
    // Pure arithmetic invariant without Zoho
    const opening = 197106.32
    const rows = [
      { delta: 4800 },
      { delta: 5868.5 },
    ]
    const withBal = attachRunningBalances(opening, rows)
    const closing = withBal[withBal.length - 1].balance
    assert.equal(closing, 207774.82)
  })
})

describe('sales day math (legacy 12.09.2026 shapes)', () => {
  it('closing sale = opening + today net sale', () => {
    const opening = 2477667.6
    const todaySale = 8192.1
    assert.equal(Number((opening + todaySale).toFixed(2)), 2485859.7)
  })
})

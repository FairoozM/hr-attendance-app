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
  invoiceTotalInCompanyCurrency,
  round2,
} = require('../src/services/ecommerceAccounting/accountNature')
const {
  classifyInvoiceCashCredit,
  sumDayCashCreditSales,
} = require('../src/services/ecommerceSummary/ecommerceSummaryService')
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

describe('invoice company-currency conversion (AED)', () => {
  it('leaves AED invoices unchanged when exchange_rate is 1', () => {
    assert.equal(
      invoiceTotalInCompanyCurrency({ total: 175, currency_code: 'AED', exchange_rate: 1 }),
      175
    )
  })

  it('converts SAR invoice total with Zoho exchange_rate (INV-044029 2026-09-18)', () => {
    // Proven: 949 SAR × 0.979 = 929.07 AED; raw 949 was the +19.93 Credit Sales bug.
    assert.equal(
      invoiceTotalInCompanyCurrency({
        invoice_number: 'INV-044029',
        total: 949,
        currency_code: 'SAR',
        exchange_rate: 0.979,
      }),
      929.07
    )
    assert.equal(round2(949 - 929.07), 19.93)
  })

  it('treats missing exchange_rate as 1', () => {
    assert.equal(invoiceTotalInCompanyCurrency({ total: 100 }), 100)
  })
})

describe('Day card cash/credit/return consistency', () => {
  it('Credit Sales uses AED so Cash+Credit−Return matches Total Sales (18 Sep 2026 shape)', () => {
    // Minimal fixture: AED invoices totaling 9694.92 company currency + one SAR invoice.
    // 9694.92 + 929.07 = 10623.99 gross; return 1401 → total 9222.99.
    const invoices = [
      { invoice_number: 'INV-AED', customer_name: 'Amazon', total: 4285.99, currency_code: 'AED', exchange_rate: 1, status: 'sent' },
      { invoice_number: 'INV-044029', customer_name: 'KSA-Amazon', total: 949, currency_code: 'SAR', exchange_rate: 0.979, status: 'sent' },
      { invoice_number: 'INV-N', customer_name: 'Noon', total: 3297.98, currency_code: 'AED', exchange_rate: 1, status: 'sent' },
      { invoice_number: 'INV-W', customer_name: 'Website', total: 695.85, currency_code: 'AED', exchange_rate: 1, status: 'sent' },
      { invoice_number: 'INV-B', customer_name: 'Burjman Shop - Web & App', total: 1240.1, currency_code: 'AED', exchange_rate: 1, status: 'overdue' },
      { invoice_number: 'INV-S', customer_name: 'Staff Ecommerce', total: 175, currency_code: 'AED', exchange_rate: 1, status: 'overdue' },
    ]
    // Adjust Amazon down so customer buckets match Zoho UI gross without double-counting:
    // UI Amazon 4285.99 already is the Amazon channel total; keep as above.
    const { cashSales, creditSales } = sumDayCashCreditSales(invoices)
    assert.equal(cashSales, 0)
    assert.equal(creditSales, 10623.99)

    const saleReturn = 1401
    const totalSales = round2(cashSales + creditSales - saleReturn)
    assert.equal(totalSales, 9222.99)
    // Bug shape: summing foreign total without FX made credit 10643.92 and credit−return 9242.92
    const buggyCredit = round2(invoices.reduce((s, inv) => s + Number(inv.total), 0))
    assert.equal(buggyCredit, 10643.92)
    assert.equal(round2(buggyCredit - saleReturn), 9242.92)
    assert.notEqual(creditSales, buggyCredit)
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

describe('Fixed/Flexible expense CoA hierarchy (2026-09-18 defect)', () => {
  const FIXED = '4265011000026584005'
  const FLEX = '4265011000026584011'

  /** Shape of live Zoho Expense CoA: nested marketplace under Flexible, rent under Fixed. */
  const fullExpenseCoa = [
    { accountId: FIXED, parentAccountId: '', accountName: 'Fixed Expense' },
    { accountId: FLEX, parentAccountId: '', accountName: 'Flexible Expense' },
    { accountId: 'rent', parentAccountId: FIXED, accountName: 'Rent Expense' },
    { accountId: 'office-rent', parentAccountId: 'rent', accountName: 'Office Rent Expense' },
    { accountId: 'it-support', parentAccountId: FIXED, accountName: 'IT Support & Data Link Expense' },
    { accountId: 'printing', parentAccountId: FIXED, accountName: 'Printing and Stationery' },
    { accountId: 'amazon', parentAccountId: FLEX, accountName: 'Amazon Expense' },
    { accountId: 'amazon-comm', parentAccountId: 'amazon', accountName: 'Amazon Commission Exp' },
    { accountId: 'noon', parentAccountId: FLEX, accountName: 'Noon Expense' },
    { accountId: 'noon-comm', parentAccountId: 'noon', accountName: '14% Noon Commission' },
    { accountId: 'salaries', parentAccountId: '', accountName: 'Salaries & Wages Expenses' },
  ]

  /**
   * showbalance=true + Active/non_zero CoA only kept a few Fixed children with
   * GL balance — the exact incomplete set that produced Fixed=1050, Flexible=0.
   */
  const buggyShowBalanceCoa = [
    { accountId: FIXED, parentAccountId: '', accountName: 'Fixed Expense' },
    { accountId: FLEX, parentAccountId: '', accountName: 'Flexible Expense' },
    { accountId: 'credit-card', parentAccountId: FIXED, accountName: 'Credit Card Charges' },
    { accountId: 'trade-license', parentAccountId: FIXED, accountName: 'Trade License Expense' },
    { accountId: 'consultancy', parentAccountId: FIXED, accountName: 'Paul & Hassan Consultancy Fee' },
    { accountId: 'vigil', parentAccountId: FIXED, accountName: 'Vigil Faulty Replacement Exp' },
    { accountId: 'alibaba', parentAccountId: FIXED, accountName: 'Ali Baba Expense' },
    { accountId: 'it-support', parentAccountId: FIXED, accountName: 'IT Support & Data Link Expense' },
    { accountId: 'printing', parentAccountId: FIXED, accountName: 'Printing and Stationery' },
    { accountId: 'zoho-exp', parentAccountId: FIXED, accountName: 'Zoho Accounting Solution Exp' },
    { accountId: 'ksa-noon', parentAccountId: FLEX, accountName: 'KSA-Noon Expense' },
    { accountId: 'ksa-noon-comm', parentAccountId: 'ksa-noon', accountName: 'KSA-Noon Commission Expense' },
  ]

  it('full Expense CoA walks nested Fixed/Flexible descendants', () => {
    const fixedIds = new Set(getDescendantAccountIds(fullExpenseCoa, FIXED))
    const flexIds = new Set(getDescendantAccountIds(fullExpenseCoa, FLEX))
    assert.ok(fixedIds.has('office-rent'))
    assert.ok(fixedIds.has('it-support'))
    assert.ok(flexIds.has('amazon-comm'))
    assert.ok(flexIds.has('noon-comm'))
    assert.equal(fixedIds.has('salaries'), false)
    assert.equal(flexIds.has('salaries'), false)
  })

  it('incomplete showbalance CoA misses marketplace Flexible children (Flexible→0 bug)', () => {
    const buggyFlex = new Set(getDescendantAccountIds(buggyShowBalanceCoa, FLEX))
    assert.equal(buggyFlex.has('amazon-comm'), false)
    assert.equal(buggyFlex.has('noon-comm'), false)
    assert.ok(buggyFlex.has('ksa-noon'))
    assert.ok(buggyFlex.has('ksa-noon-comm'))
    assert.equal(buggyFlex.size, 3) // parent + KSA-Noon + commission
  })

  it('P&L match on buggy ids yields only IT Support 500 + Printing 550 = 1050 Fixed', () => {
    const buggyFixed = new Set(getDescendantAccountIds(buggyShowBalanceCoa, FIXED))
    const buggyFlex = new Set(getDescendantAccountIds(buggyShowBalanceCoa, FLEX))
    const pnlRows = [
      { accountId: 'it-support', total: 500 },
      { accountId: 'printing', total: 550 },
      { accountId: 'amazon-comm', total: 161399.61 },
      { accountId: 'noon-comm', total: 91753.1 },
      { accountId: 'office-rent', total: 125687.44 },
      { accountId: 'salaries', total: 541505.87 },
    ]
    let fixed = 0
    let flex = 0
    for (const row of pnlRows) {
      if (buggyFixed.has(row.accountId)) fixed += row.total
      if (buggyFlex.has(row.accountId)) flex += row.total
    }
    assert.equal(round2(fixed), 1050)
    assert.equal(round2(flex), 0)

    const fullFixed = new Set(getDescendantAccountIds(fullExpenseCoa, FIXED))
    const fullFlex = new Set(getDescendantAccountIds(fullExpenseCoa, FLEX))
    fixed = 0
    flex = 0
    for (const row of pnlRows) {
      if (fullFixed.has(row.accountId)) fixed += row.total
      if (fullFlex.has(row.accountId)) flex += row.total
    }
    assert.equal(round2(fixed), 126737.44) // 500 + 550 + 125687.44
    assert.equal(round2(flex), 253152.71) // 161399.61 + 91753.1
  })

  it('opening + today = total; averages use day-of-year 261 and month 9', () => {
    const openingFixed = 357156.71
    const todayFixed = 0
    const totalFixed = 357156.71
    assert.equal(round2(openingFixed + todayFixed), totalFixed)
    assert.equal(round2(totalFixed / 261), 1368.42)
    assert.equal(round2(totalFixed / 9), 39684.08)

    const openingFlex = 840630.59
    const todayFlex = 0
    const totalFlex = 840630.59
    assert.equal(round2(openingFlex + todayFlex), totalFlex)
    assert.equal(round2(totalFlex / 261), 3220.81)
    assert.equal(round2(totalFlex / 9), 93403.4)
  })
})

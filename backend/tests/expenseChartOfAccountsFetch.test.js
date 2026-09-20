'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function stubModule(relativePath, exports) {
  const resolved = require.resolve(relativePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
  return () => {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

function freshModule(relativePath) {
  delete require.cache[require.resolve(relativePath)]
  return require(relativePath)
}

test('fetchExpenseChartOfAccountsRaw uses AccountType.Expense without showbalance', async () => {
  const calls = []
  const restore = stubModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async (path, searchParams) => {
      calls.push({
        path: String(path || ''),
        filter_by: searchParams?.get?.('filter_by') || null,
        showbalance: searchParams?.get?.('showbalance') || null,
        page: searchParams?.get?.('page') || null,
      })
      return {
        chartofaccounts: [
          {
            account_id: 'flex',
            account_name: 'Flexible Expense',
            account_type: 'expense',
            parent_account_id: '',
          },
          {
            account_id: 'amazon',
            account_name: 'Amazon Expense',
            account_type: 'expense',
            parent_account_id: 'flex',
          },
        ],
        page_context: { has_more_page: false },
      }
    },
  })
  try {
    // Also clear zohoBooksReads cache so it picks up the stub
    delete require.cache[require.resolve('../src/services/ecommerceAccounting/zohoBooksReads')]
    const { fetchExpenseChartOfAccountsRaw } = freshModule(
      '../src/services/ecommerceAccounting/zohoBooksReads'
    )
    const rows = await fetchExpenseChartOfAccountsRaw()
    assert.equal(calls.length, 1)
    assert.match(calls[0].path, /chartofaccounts/)
    assert.equal(calls[0].filter_by, 'AccountType.Expense')
    assert.equal(calls[0].showbalance, null)
    assert.equal(rows.length, 2)
    assert.equal(rows[1].parentAccountId, 'flex')
  } finally {
    restore()
    delete require.cache[require.resolve('../src/services/ecommerceAccounting/zohoBooksReads')]
  }
})

test('fetchExpenseTotalsSplit uses expensesbycategory amount without tax', async () => {
  const calls = []
  const restore = stubModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async (path, searchParams) => {
      calls.push({
        path: String(path || ''),
        from: searchParams?.get?.('from_date'),
        to: searchParams?.get?.('to_date'),
      })
      return {
        expense: [
          // Flexible child: amount without tax vs with tax must prefer without
          {
            account_id: 'flex-child',
            account_name: 'Amazon Commission Exp',
            amount: 100,
            amount_with_tax: 105,
          },
          {
            account_id: 'fixed-child',
            account_name: 'Office Rent Expense',
            amount: 200,
            amount_with_tax: 210,
          },
          // Noise row — not in either set
          {
            account_id: 'salaries',
            account_name: 'Salaries & Wages Expenses',
            amount: 541505.87,
            amount_with_tax: 541542.77,
          },
        ],
        page_context: { has_more_page: false },
      }
    },
  })
  try {
    delete require.cache[require.resolve('../src/services/ecommerceAccounting/zohoBooksReads')]
    const { fetchExpenseTotalsSplit } = freshModule(
      '../src/services/ecommerceAccounting/zohoBooksReads'
    )
    const split = await fetchExpenseTotalsSplit(
      '2026-01-01',
      '2026-09-18',
      new Set(['flex-child']),
      new Set(['fixed-child'])
    )
    assert.equal(calls.length, 1)
    assert.match(calls[0].path, /expensesbycategory/)
    assert.equal(split.primaryTotal, 100)
    assert.equal(split.secondaryTotal, 200)
    assert.notEqual(split.primaryTotal, 105)
    assert.notEqual(split.secondaryTotal, 210)
  } finally {
    restore()
    delete require.cache[require.resolve('../src/services/ecommerceAccounting/zohoBooksReads')]
  }
})

/**
 * Zoho Books Account Balance Watchlist — unit tests (mocked Zoho + store).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

test('mapAccountWithBalance maps id, name, code, type and balances', () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({ chartofaccounts: [] }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({
      hasToken: true,
      scopes: ['ZohoBooks.fullaccess.all'],
    }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { mapAccountWithBalance } = freshRequire('../src/services/zohoAccountWatchlistService')
  const mapped = mapAccountWithBalance({
    account_id: '42',
    account_name: 'Bank - AED',
    account_code: '1001',
    account_type: 'bank',
    current_balance: '1234.56',
    closing_balance: '1200.00',
  })
  assert.equal(mapped.accountId, '42')
  assert.equal(mapped.accountName, 'Bank - AED')
  assert.equal(mapped.accountCode, '1001')
  assert.equal(mapped.accountType, 'bank')
  assert.equal(mapped.currentBalance, 1234.56)
  assert.equal(mapped.closingBalance, 1200)
  assert.equal(mapped.balanceUnavailable, false)
})

test('mapAccountWithBalance flags missing balances', () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({ chartofaccounts: [] }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({ hasToken: true, scopes: ['ZohoBooks.fullaccess.all'] }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { mapAccountWithBalance } = freshRequire('../src/services/zohoAccountWatchlistService')
  const mapped = mapAccountWithBalance({
    account_id: '9',
    account_name: 'VAT Payable',
    account_code: '2100',
    account_type: 'other_current_liability',
  })
  assert.equal(mapped.currentBalance, null)
  assert.equal(mapped.closingBalance, null)
  assert.equal(mapped.balanceUnavailable, true)
})

test('listWatchlistWithBalances returns empty state without calling Zoho', async () => {
  let zohoCalled = false
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => {
      zohoCalled = true
      return { chartofaccounts: [] }
    },
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({ hasToken: true, scopes: ['ZohoBooks.fullaccess.all'] }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { listWatchlistWithBalances } = freshRequire('../src/services/zohoAccountWatchlistService')
  const result = await listWatchlistWithBalances()
  assert.equal(result.empty, true)
  assert.deepEqual(result.accounts, [])
  assert.ok(/No accounts added yet/i.test(result.message))
  assert.equal(zohoCalled, false)
})

test('listWatchlistWithBalances uses chart_of_account closing + future lines', async () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async (path, searchParams) => {
      const p = String(path || '')
      if (p.endsWith('/chartofaccounts') && searchParams?.get?.('showbalance') === 'true') {
        return {
          chartofaccounts: [
            {
              account_id: '101',
              account_name: 'Cash',
              account_code: '1000',
              account_type: 'cash',
              current_balance: 50,
            },
          ],
        }
      }
      if (p.includes('/chartofaccounts/101')) {
        return {
          chart_of_account: {
            account_id: '101',
            account_name: 'Cash',
            account_code: '1000',
            account_type: 'cash',
            closing_balance: 30,
            transactions: [
              {
                transaction_id: 'tx1',
                date: '2099-01-15',
                entity_type: 'journal',
                debit: 0,
                credit: 20,
                reference_number: 'Future credit',
              },
            ],
          },
        }
      }
      return { chartofaccounts: [] }
    },
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({
      hasToken: true,
      scopes: ['ZohoBooks.accountants.READ'],
    }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [
      {
        accountId: '101',
        accountName: 'Cash (saved)',
        accountCode: '1000',
        accountType: 'cash',
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        accountId: 'missing',
        accountName: 'Gone',
        accountCode: '0000',
        accountType: 'bank',
        sortOrder: 2,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { listWatchlistWithBalances } = freshRequire('../src/services/zohoAccountWatchlistService')
  const result = await listWatchlistWithBalances()
  assert.equal(result.empty, false)
  assert.equal(result.accounts.length, 2)
  assert.equal(result.accounts[0].accountId, '101')
  assert.equal(result.accounts[0].currentBalance, 50)
  assert.equal(result.accounts[0].fullBalance, 30)
  assert.equal(result.accounts[0].futureImpact, -20)
  assert.equal(result.accounts[0].futureTransactionCount, 1)
  assert.equal(result.accounts[0].notFoundInZoho, false)
  assert.equal(result.accounts[1].accountId, 'missing')
  assert.equal(result.accounts[1].notFoundInZoho, true)
  assert.equal(result.accounts[1].balanceUnavailable, true)
})

test('enrichAccountWithFullBalance reads capital closing + Jul 12 drawing', async () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({
      chart_of_account: {
        account_id: '4265011000013506001',
        account_name: 'Abdolrahim Mirzadeh Capital Account',
        account_code: '1700',
        account_type: 'equity',
        closing_balance: 32533.53,
        transactions: [
          {
            date: '2026-07-12',
            transaction_id: 't1',
            entity_type: 'transfer_fund',
            reference_number: 'BPV-0127 CHQ#808774 Cash to Abdolrahim capital',
            debit: 82210.68,
            credit: '',
          },
        ],
      },
    }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({ hasToken: true, scopes: ['ZohoBooks.fullaccess.all'] }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { enrichAccountWithFullBalance } = freshRequire('../src/services/zohoAccountWatchlistService')
  const enriched = await enrichAccountWithFullBalance(
    {
      accountId: '4265011000013506001',
      accountName: 'Abdolrahim Mirzadeh Capital Account',
      accountCode: '1700',
      accountType: 'equity',
      currentBalance: 114744.21,
    },
    { asOfDate: '2026-07-08' },
  )
  assert.equal(enriched.fullBalance, 32533.53)
  assert.equal(enriched.futureImpact, -82210.68)
  assert.equal(enriched.futureTransactionCount, 1)
  assert.match(enriched.futureTransactions[0].referenceNumber, /BPV-0127/)
})

test('transactionBalanceDelta treats equity credits as positive', () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({ chartofaccounts: [] }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({ hasToken: true, scopes: ['ZohoBooks.fullaccess.all'] }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })
  const { transactionBalanceDelta } = freshRequire('../src/services/zohoAccountWatchlistService')
  assert.equal(
    transactionBalanceDelta({ debit_amount: 82210.68, credit_amount: 0 }, 'equity'),
    -82210.68,
  )
  assert.equal(
    transactionBalanceDelta({ debit_amount: 0, credit_amount: 20 }, 'cash'),
    -20,
  )
})

test('addAccountToWatchlist rejects unknown Zoho account', async () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({ chartofaccounts: [] }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({
      hasToken: true,
      scopes: ['ZohoBooks.fullaccess.all'],
    }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { addAccountToWatchlist } = freshRequire('../src/services/zohoAccountWatchlistService')
  await assert.rejects(
    () => addAccountToWatchlist({ accountId: 'nope' }, 1),
    (err) => err.code === 'ACCOUNT_NOT_FOUND',
  )
})

test('assertZohoBooksAccess via listAllAccountsWithBalances fails on expired token', async () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async () => ({ chartofaccounts: [] }),
  })
  mockModule('../src/integrations/zoho/zohoOAuth', {
    getZohoTokenDiagnostics: async () => ({ hasToken: false, scopes: [] }),
  })
  mockModule('../src/services/zohoAccountWatchlistStore', {
    listWatchedAccounts: async () => [],
    getWatchedAccount: async () => null,
    addWatchedAccount: async () => ({}),
    removeWatchedAccount: async () => false,
  })

  const { listAllAccountsWithBalances } = freshRequire('../src/services/zohoAccountWatchlistService')
  await assert.rejects(
    () => listAllAccountsWithBalances(),
    (err) => err.code === 'ZOHO_TOKEN_EXPIRED',
  )
})

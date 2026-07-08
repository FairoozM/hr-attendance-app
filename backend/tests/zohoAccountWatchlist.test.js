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

test('listWatchlistWithBalances merges live balances for watched ids', async () => {
  mockModule('../src/services/zohoApiClient', {
    zohoBooksJsonRequest: async (_path, searchParams) => {
      assert.equal(searchParams.get('showbalance'), 'true')
      return {
        chartofaccounts: [
          {
            account_id: '101',
            account_name: 'Cash',
            account_code: '1000',
            account_type: 'cash',
            current_balance: 50,
            closing_balance: 40,
          },
          {
            account_id: '202',
            account_name: 'Other',
            account_code: '9999',
            account_type: 'expense',
            current_balance: 1,
            closing_balance: 1,
          },
        ],
      }
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
  assert.equal(result.accounts[0].closingBalance, 40)
  assert.equal(result.accounts[0].notFoundInZoho, false)
  assert.equal(result.accounts[1].accountId, 'missing')
  assert.equal(result.accounts[1].notFoundInZoho, true)
  assert.equal(result.accounts[1].balanceUnavailable, true)
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

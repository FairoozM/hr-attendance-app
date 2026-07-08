/**
 * Zoho Books Account Balance Watchlist — company-level shared list with live balances.
 * Uses showbalance=true; does not alter Amazon Payment Clearing chart-of-accounts cache.
 */

const { zohoBooksJsonRequest } = require('./zohoApiClient')
const { getZohoTokenDiagnostics } = require('../integrations/zoho/zohoOAuth')
const store = require('./zohoAccountWatchlistStore')

const BOOKS_V3 = '/books/v3'
const CHART_OF_ACCOUNTS_ENDPOINT = `${BOOKS_V3}/chartofaccounts`
const CHART_OF_ACCOUNTS_REQUIRED_SCOPE = 'ZohoBooks.accountants.READ'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function parseBalance(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapAccountWithBalance(account) {
  const accountId = clean(account?.account_id || account?.id)
  const currentBalance = parseBalance(
    account?.current_balance ?? account?.currentBalance ?? account?.balance,
  )
  const closingBalance = parseBalance(
    account?.closing_balance ?? account?.closingBalance ?? account?.closing_balance_formatted,
  )
  return {
    accountId,
    accountName: clean(account?.account_name || account?.name),
    accountCode: clean(account?.account_code || account?.code),
    accountType: clean(account?.account_type || account?.type),
    isActive: account?.is_active !== false,
    currentBalance,
    closingBalance,
    balanceUnavailable: currentBalance == null && closingBalance == null,
    currencyCode: clean(account?.currency_code || account?.currency_code_formatted || ''),
  }
}

function tokenHasChartOfAccountsScope(tokenDiagnostics) {
  const scopes = Array.isArray(tokenDiagnostics?.scopes) ? tokenDiagnostics.scopes : []
  return (
    scopes.includes(CHART_OF_ACCOUNTS_REQUIRED_SCOPE) ||
    scopes.includes('ZohoBooks.fullaccess.all') ||
    scopes.includes('ZohoBooks.FullAccess.all')
  )
}

/**
 * Fetch Zoho Books chart of accounts with balances (showbalance=true).
 * Independent of Amazon Payment Clearing's in-memory account cache.
 */
async function fetchChartOfAccountsWithBalances({ skipCache = true } = {}) {
  const params = new URLSearchParams()
  params.set('showbalance', 'true')

  const json = await zohoBooksJsonRequest(
    CHART_OF_ACCOUNTS_ENDPOINT,
    params,
    'GET',
    undefined,
    {
      source: 'zoho_account_watchlist',
      skipCache: skipCache !== false,
      cacheCategory: 'default',
    },
  )

  const raw = Array.isArray(json?.chartofaccounts)
    ? json.chartofaccounts
    : Array.isArray(json?.accounts)
      ? json.accounts
      : []

  return raw.map(mapAccountWithBalance).filter((account) => account.accountId)
}

async function assertZohoBooksAccess() {
  const tokenDiagnostics = await getZohoTokenDiagnostics().catch(() => null)
  if (tokenDiagnostics && tokenDiagnostics.hasToken === false) {
    const err = new Error(
      'Zoho Books access token is missing or expired. Re-authorize Zoho OAuth and try again.',
    )
    err.code = 'ZOHO_TOKEN_EXPIRED'
    err.status = 401
    throw err
  }
  if (tokenDiagnostics && !tokenHasChartOfAccountsScope(tokenDiagnostics)) {
    const err = new Error(
      `Zoho token is missing ${CHART_OF_ACCOUNTS_REQUIRED_SCOPE} (or ZohoBooks.fullaccess.all). Re-authorize with chart of accounts access.`,
    )
    err.code = 'ZOHO_SCOPE_MISSING'
    err.status = 403
    throw err
  }
}

/**
 * All chart of accounts with balances for the account picker.
 */
async function listAllAccountsWithBalances() {
  await assertZohoBooksAccess()
  const accounts = await fetchChartOfAccountsWithBalances({ skipCache: true })
  return {
    accounts,
    refreshedAt: new Date().toISOString(),
    count: accounts.length,
  }
}

/**
 * Watched accounts with latest balances from Zoho.
 * Empty watchlist returns success with accounts: [] (not an error).
 */
async function listWatchlistWithBalances() {
  const watched = await store.listWatchedAccounts()
  if (watched.length === 0) {
    return {
      accounts: [],
      empty: true,
      refreshedAt: new Date().toISOString(),
      message:
        'No accounts added yet. Add important Zoho Books accounts to monitor their balances here.',
    }
  }

  await assertZohoBooksAccess()
  const allAccounts = await fetchChartOfAccountsWithBalances({ skipCache: true })
  const byId = new Map(allAccounts.map((a) => [a.accountId, a]))
  const refreshedAt = new Date().toISOString()

  const accounts = watched.map((row) => {
    const live = byId.get(row.accountId)
    if (!live) {
      return {
        accountId: row.accountId,
        accountName: row.accountName,
        accountCode: row.accountCode,
        accountType: row.accountType,
        currentBalance: null,
        closingBalance: null,
        balanceUnavailable: true,
        notFoundInZoho: true,
        currencyCode: '',
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
        refreshedAt,
      }
    }
    return {
      ...live,
      accountName: live.accountName || row.accountName,
      accountCode: live.accountCode || row.accountCode,
      accountType: live.accountType || row.accountType,
      notFoundInZoho: false,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      refreshedAt,
    }
  })

  return {
    accounts,
    empty: false,
    refreshedAt,
    count: accounts.length,
  }
}

/**
 * Add an account to the shared company watchlist.
 * Validates the account exists in Zoho when possible.
 * @param {{ accountId?: string, account_id?: string }} body
 * @param {number|null} addedBy
 */
async function addAccountToWatchlist(body, addedBy = null) {
  const accountId = clean(body?.accountId || body?.account_id)
  if (!accountId) {
    const err = new Error('account_id is required')
    err.code = 'VALIDATION'
    err.status = 400
    throw err
  }

  const existing = await store.getWatchedAccount(accountId)
  if (existing) {
    return { account: existing, alreadyWatched: true }
  }

  await assertZohoBooksAccess()
  const allAccounts = await fetchChartOfAccountsWithBalances({ skipCache: true })
  const found = allAccounts.find((a) => a.accountId === accountId)
  if (!found) {
    const err = new Error(`Zoho Books account not found: ${accountId}`)
    err.code = 'ACCOUNT_NOT_FOUND'
    err.status = 404
    throw err
  }

  const saved = await store.addWatchedAccount({
    accountId: found.accountId,
    accountName: found.accountName,
    accountCode: found.accountCode,
    accountType: found.accountType,
    addedBy,
  })

  return {
    account: {
      ...saved,
      currentBalance: found.currentBalance,
      closingBalance: found.closingBalance,
      balanceUnavailable: found.balanceUnavailable,
      currencyCode: found.currencyCode,
      refreshedAt: new Date().toISOString(),
    },
    alreadyWatched: false,
  }
}

/**
 * @param {string} accountId
 */
async function removeAccountFromWatchlist(accountId) {
  const id = clean(accountId)
  if (!id) {
    const err = new Error('accountId is required')
    err.code = 'VALIDATION'
    err.status = 400
    throw err
  }
  const removed = await store.removeWatchedAccount(id)
  if (!removed) {
    const err = new Error(`Account is not on the watchlist: ${id}`)
    err.code = 'ACCOUNT_NOT_FOUND'
    err.status = 404
    throw err
  }
  return { removed: true, accountId: id }
}

module.exports = {
  CHART_OF_ACCOUNTS_ENDPOINT,
  CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
  mapAccountWithBalance,
  fetchChartOfAccountsWithBalances,
  listAllAccountsWithBalances,
  listWatchlistWithBalances,
  addAccountToWatchlist,
  removeAccountFromWatchlist,
}

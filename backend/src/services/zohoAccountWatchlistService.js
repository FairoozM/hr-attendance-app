/**
 * Zoho Books Account Balance Watchlist — company-level shared list with live balances.
 * Uses showbalance=true; does not alter Amazon Payment Clearing chart-of-accounts cache.
 *
 * Current balance = CoA list current_balance (as of today).
 * Full balance = includes future-dated transactions (via account detail closing_balance
 * and/or projected from future accounttransactions).
 */

const { zohoBooksJsonRequest } = require('./zohoApiClient')
const { getZohoTokenDiagnostics } = require('../integrations/zoho/zohoOAuth')
const store = require('./zohoAccountWatchlistStore')

const BOOKS_V3 = '/books/v3'
const CHART_OF_ACCOUNTS_ENDPOINT = `${BOOKS_V3}/chartofaccounts`
const ACCOUNT_TRANSACTIONS_ENDPOINT = `${BOOKS_V3}/chartofaccounts/accounttransactions`
const CHART_OF_ACCOUNTS_REQUIRED_SCOPE = 'ZohoBooks.accountants.READ'

/** Account types where debit increases the reported balance. */
const DEBIT_NORMAL_TYPES = new Set([
  'cash',
  'bank',
  'other_asset',
  'other_current_asset',
  'fixed_asset',
  'stock',
  'payment_clearing_account',
  'accounts_receivable',
  'expense',
  'cost_of_goods_sold',
  'other_expense',
])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function parseBalance(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const stripped = value.replace(/[^0-9.\-]/g, '')
    const n = Number(stripped)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function todayLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isDebitNormalAccount(accountType) {
  const t = clean(accountType).toLowerCase()
  if (!t) return true
  if (DEBIT_NORMAL_TYPES.has(t)) return true
  if (t.includes('asset') || t.includes('expense') || t === 'stock' || t === 'bank' || t === 'cash') {
    return true
  }
  return false
}

/**
 * Signed effect of one transaction on the account's displayed balance.
 * Debit-normal: debit +, credit −. Credit-normal (equity/liability/income): credit +, debit −.
 */
function transactionBalanceDelta(tx, accountType) {
  const debit =
    parseBalance(tx?.debit_amount ?? tx?.debitAmount) || 0
  const credit =
    parseBalance(tx?.credit_amount ?? tx?.creditAmount) || 0
  const side = clean(tx?.debit_or_credit ?? tx?.debitOrCredit).toLowerCase()
  const debitNormal = isDebitNormalAccount(accountType)

  if (debit > 0 || credit > 0) {
    if (debitNormal) return debit - credit
    return credit - debit
  }
  if (side === 'debit') return debitNormal ? Math.abs(debit || credit || 0) : -Math.abs(debit || credit || 0)
  if (side === 'credit') return debitNormal ? -Math.abs(credit || debit || 0) : Math.abs(credit || debit || 0)
  return 0
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
    fullBalance: closingBalance,
    futureImpact: null,
    futureTransactionCount: 0,
    futureTransactions: [],
    balanceUnavailable: currentBalance == null && closingBalance == null,
    currencyCode: clean(account?.currency_code || account?.currency_code_formatted || ''),
  }
}

function roundMoney(n) {
  return Math.round(n * 100) / 100
}

/**
 * Run async work over items with a fixed concurrency (avoids Zoho rate-limit stalls).
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  const out = new Array(list.length)
  let next = 0

  async function runOne() {
    while (next < list.length) {
      const i = next
      next += 1
      out[i] = await worker(list[i], i)
    }
  }

  const runners = Array.from({ length: Math.min(limit, list.length) }, () => runOne())
  await Promise.all(runners)
  return out
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Math.max(1000, Number(ms) || 15000)
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)
        err.code = 'WATCHLIST_ENRICH_TIMEOUT'
        reject(err)
      }, timeoutMs)
    }),
  ])
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

/**
 * Per-account Zoho detail — includes closing_balance and recent transaction lines.
 * Response uses `chart_of_account` (underscore), not `chartofaccount`.
 */
async function fetchAccountDetail(accountId) {
  const id = clean(accountId)
  if (!id) return null
  const json = await zohoBooksJsonRequest(
    `${CHART_OF_ACCOUNTS_ENDPOINT}/${encodeURIComponent(id)}`,
    new URLSearchParams(),
    'GET',
    undefined,
    {
      source: 'zoho_account_watchlist_detail',
      skipCache: true,
      cacheCategory: 'default',
    },
  )
  const account =
    json?.chart_of_account ||
    json?.chartofaccount ||
    json?.account ||
    (json?.account_id || json?.account_name ? json : null)
  if (!account || typeof account !== 'object') return null

  const mapped = mapAccountWithBalance({
    ...account,
    account_id: account.account_id || id,
    // Detail uses closing_balance; list uses current_balance.
    current_balance: account.current_balance ?? account.balance,
    closing_balance: account.closing_balance,
  })

  const rawTxs = Array.isArray(account.transactions) ? account.transactions : []
  const transactions = rawTxs.map((tx) =>
    mapTransactionRow({
      ...tx,
      transaction_date: tx.transaction_date || tx.date,
      transaction_type: tx.transaction_type || tx.entity_type || tx.entity_type_formatted,
      entry_number: tx.entry_number || tx.transaction_number || '',
      reference_number: tx.reference_number,
      description: tx.description || tx.reference_number || '',
      debit_amount: tx.debit_amount ?? tx.debit ?? tx.fcy_debit,
      credit_amount: tx.credit_amount ?? tx.credit ?? tx.fcy_credit,
      debit_or_credit: tx.debit_or_credit,
    }),
  )

  return {
    ...mapped,
    closingBalance: mapped.closingBalance,
    transactions,
  }
}

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  d.setDate(d.getDate() + Number(days || 0))
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mapTransactionRow(tx) {
  return {
    transactionId: clean(tx?.transaction_id || tx?.categorized_transaction_id),
    transactionDate: clean(tx?.transaction_date || tx?.date),
    transactionType: clean(tx?.transaction_type || tx?.transaction_type_formatted || tx?.entity_type),
    entryNumber: clean(tx?.entry_number || tx?.transaction_number),
    referenceNumber: clean(tx?.reference_number),
    description: clean(tx?.description),
    debitAmount: parseBalance(tx?.debit_amount ?? tx?.debit ?? tx?.fcy_debit),
    creditAmount: parseBalance(tx?.credit_amount ?? tx?.credit ?? tx?.fcy_credit),
    debitOrCredit: clean(tx?.debit_or_credit).toLowerCase(),
    raw: tx,
  }
}

/**
 * Future-dated transactions for an account (date strictly after asOfDate).
 * Prefer lines embedded on GET /chartofaccounts/{id} (has real debit/credit rows).
 * The list endpoint /accounttransactions only returns entity_type counts for this org.
 */
async function fetchFutureAccountTransactions(accountId, { asOfDate = todayLocalDate() } = {}) {
  const id = clean(accountId)
  if (!id) return []

  // Primary: account detail embeds recent transaction lines (including future-dated).
  try {
    const detail = await fetchAccountDetail(id)
    const fromDetail = (detail?.transactions || []).filter(
      (tx) => tx.transactionDate && tx.transactionDate > asOfDate,
    )
    if (fromDetail.length > 0) return fromDetail
  } catch (err) {
    console.warn(
      '[zoho-account-watchlist] account detail txs failed',
      id,
      err?.message || err,
    )
  }

  // Fallback: year window on accounttransactions (often only returns type counts — still try).
  const year = asOfDate.slice(0, 4)
  const startFrom = addDaysYmd(asOfDate, 1)
  const yearEnd = `${year}-12-31`
  const rangeEnd = yearEnd < startFrom ? addDaysYmd(asOfDate, 366) : yearEnd

  try {
    const raw = await fetchAccountTransactionsRaw(id, {
      date_start: `${year}-01-01`,
      date_end: rangeEnd,
    })
    return raw
      .map(mapTransactionRow)
      .filter((tx) => tx.transactionDate && tx.transactionDate > asOfDate)
  } catch (err) {
    console.warn(
      '[zoho-account-watchlist] accounttransactions fallback failed',
      id,
      err?.message || err,
    )
    return []
  }
}

/**
 * List account transactions from Zoho Books CoA endpoint.
 * Note: for some orgs this returns entity_type count summaries, not line items.
 */
async function fetchAccountTransactionsRaw(accountId, extraParams = {}) {
  const id = clean(accountId)
  if (!id) return []

  const params = new URLSearchParams()
  params.set('account_id', id)
  params.set('per_page', '200')
  params.set('sort_column', 'transaction_date')
  for (const [key, value] of Object.entries(extraParams || {})) {
    if (value != null && value !== '') params.set(key, String(value))
  }

  const json = await zohoBooksJsonRequest(
    ACCOUNT_TRANSACTIONS_ENDPOINT,
    params,
    'GET',
    undefined,
    {
      source: 'zoho_account_watchlist_future_txs',
      skipCache: true,
      cacheCategory: 'default',
    },
  )

  if (Array.isArray(json?.transactions)) return json.transactions
  if (Array.isArray(json?.accounttransactions)) return json.accounttransactions
  if (Array.isArray(json?.account_transactions)) return json.account_transactions
  // Zoho may return type-count summaries under transaction_list — those are not line items.
  if (Array.isArray(json?.transaction_list)) {
    const looksLikeLines = json.transaction_list.some(
      (row) => row && (row.transaction_date || row.date || row.debit != null || row.credit != null),
    )
    if (looksLikeLines) return json.transaction_list
  }
  return []
}

/**
 * Enrich one account with full balance (incl. future).
 * One GET /chartofaccounts/{id} returns closing_balance + recent transaction lines
 * (this org's /accounttransactions only returns entity_type counts).
 */
async function enrichAccountWithFullBalance(account, { asOfDate = todayLocalDate() } = {}) {
  if (!account?.accountId) return account

  let futureTransactions = []
  let enrichError = null
  let detailClosing = null

  try {
    const detail = await withTimeout(
      fetchAccountDetail(account.accountId),
      25_000,
      `account detail for ${account.accountId}`,
    )
    if (detail?.closingBalance != null) detailClosing = detail.closingBalance
    if (detail?.currencyCode && !account.currencyCode) {
      account = { ...account, currencyCode: detail.currencyCode }
    }
    futureTransactions = (detail?.transactions || []).filter((tx) => {
      const d = clean(tx.transactionDate)
      return d && d > asOfDate
    })
  } catch (err) {
    enrichError = err?.message || 'Failed to load full balance'
    console.warn(
      '[zoho-account-watchlist] account detail enrich failed for',
      account.accountId,
      enrichError,
    )
  }

  const futureImpactFromTxs = futureTransactions.reduce(
    (sum, tx) => sum + transactionBalanceDelta(tx, account.accountType),
    0,
  )
  const roundedImpact = roundMoney(futureImpactFromTxs)

  const currentBalance = account.currentBalance
  let fullBalance = null
  if (currentBalance != null && futureTransactions.length > 0) {
    fullBalance = roundMoney(currentBalance + roundedImpact)
  } else if (
    currentBalance != null &&
    detailClosing != null &&
    Math.abs(detailClosing - currentBalance) >= 0.005
  ) {
    fullBalance = detailClosing
  } else if (detailClosing != null && currentBalance == null) {
    fullBalance = detailClosing
  } else if (currentBalance != null) {
    fullBalance = currentBalance
  }

  // Prefer Zoho closing_balance when it disagrees with current (authoritative full figure).
  if (
    detailClosing != null &&
    currentBalance != null &&
    Math.abs(detailClosing - currentBalance) >= 0.005
  ) {
    fullBalance = detailClosing
  }

  let futureImpact = null
  if (currentBalance != null && fullBalance != null) {
    futureImpact = roundMoney(fullBalance - currentBalance)
  } else if (futureTransactions.length > 0) {
    futureImpact = roundedImpact
  }

  const summarizedFuture = futureTransactions
    .slice()
    .sort((a, b) => String(a.transactionDate).localeCompare(String(b.transactionDate)))
    .map((tx) => ({
      transactionId: tx.transactionId,
      transactionDate: tx.transactionDate,
      transactionType: tx.transactionType,
      entryNumber: tx.entryNumber,
      referenceNumber: tx.referenceNumber,
      description: tx.description || tx.referenceNumber,
      debitAmount: tx.debitAmount,
      creditAmount: tx.creditAmount,
      impact: roundMoney(transactionBalanceDelta(tx, account.accountType)),
    }))

  return {
    ...account,
    closingBalance: detailClosing ?? account.closingBalance,
    fullBalance,
    futureImpact,
    futureTransactionCount: summarizedFuture.length,
    futureTransactions: summarizedFuture,
    balanceUnavailable: currentBalance == null && fullBalance == null,
    enrichError: enrichError || undefined,
  }
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
  const asOfDate = todayLocalDate()

  const baseRows = watched.map((row) => {
    const live = byId.get(row.accountId)
    if (!live) {
      return {
        accountId: row.accountId,
        accountName: row.accountName,
        accountCode: row.accountCode,
        accountType: row.accountType,
        currentBalance: null,
        closingBalance: null,
        fullBalance: null,
        futureImpact: null,
        futureTransactionCount: 0,
        futureTransactions: [],
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

  // Enrich with limited concurrency. Soft deadline so CloudFront (~60s) never eats the request:
  // if future-tx calls are slow, return current balances immediately with a note.
  const deadlineMs = 45_000
  const startedAt = Date.now()
  const accounts = await mapWithConcurrency(baseRows, 2, async (row) => {
    if (row.notFoundInZoho) return { ...row, asOfDate }
    const remaining = deadlineMs - (Date.now() - startedAt)
    if (remaining < 3_000) {
      return {
        ...row,
        fullBalance: row.currentBalance,
        futureImpact: row.currentBalance != null ? 0 : null,
        futureTransactionCount: 0,
        futureTransactions: [],
        asOfDate,
        enrichError: 'Full balance skipped — refresh again to include future transactions',
      }
    }
    try {
      const enriched = await withTimeout(
        enrichAccountWithFullBalance(row, { asOfDate }),
        Math.min(35_000, remaining),
        `enrich ${row.accountId}`,
      )
      return { ...enriched, refreshedAt, asOfDate }
    } catch (err) {
      console.warn('[zoho-account-watchlist] enrich failed:', row.accountId, err?.message || err)
      return {
        ...row,
        fullBalance: row.currentBalance,
        futureImpact: row.currentBalance != null ? 0 : null,
        futureTransactionCount: 0,
        futureTransactions: [],
        asOfDate,
        enrichError: err?.message || 'Failed to load full balance',
      }
    }
  })

  return {
    accounts,
    empty: false,
    refreshedAt,
    asOfDate,
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
  ACCOUNT_TRANSACTIONS_ENDPOINT,
  CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
  mapAccountWithBalance,
  isDebitNormalAccount,
  transactionBalanceDelta,
  addDaysYmd,
  fetchChartOfAccountsWithBalances,
  fetchAccountDetail,
  fetchFutureAccountTransactions,
  enrichAccountWithFullBalance,
  listAllAccountsWithBalances,
  listWatchlistWithBalances,
  addAccountToWatchlist,
  removeAccountFromWatchlist,
}

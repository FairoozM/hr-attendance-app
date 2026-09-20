/**
 * Zoho Books read helpers for Ecommerce Ledger / Summary.
 */

const { zohoBooksJsonRequest } = require('../zohoApiClient')
const { fetchInvoices, fetchCreditNotes } = require('../../integrations/zoho/zohoBooksClient')
const { clean, toNumber, round2 } = require('./accountNature')

const BOOKS_V3 = '/books/v3'

function mapChartAccountRow(a) {
  return {
    accountId: clean(a.account_id || a.id),
    accountName: clean(a.account_name || a.name),
    accountCode: clean(a.account_code || a.code),
    accountType: clean(a.account_type || a.type),
    parentAccountId: clean(a.parent_account_id || a.parent_id || ''),
    isActive: a.is_active !== false,
    currentBalance: toNumber(a.current_balance ?? a.balance),
    closingBalance:
      a.closing_balance != null && a.closing_balance !== ''
        ? toNumber(a.closing_balance)
        : null,
    raw: a,
  }
}

/**
 * Paginate chart of accounts.
 * @param {{ filterBy?: string, showBalance?: boolean, source?: string }} [opts]
 */
async function fetchChartOfAccountsRaw(opts = {}) {
  const filterBy = clean(opts.filterBy)
  const showBalance = opts.showBalance === true
  const source = clean(opts.source) || 'ecommerce_accounting_coa'
  const all = []
  let page = 1
  while (page <= 30) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: '200',
    })
    if (filterBy) params.set('filter_by', filterBy)
    if (showBalance) params.set('showbalance', 'true')
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/chartofaccounts`,
      params,
      'GET',
      undefined,
      { source, skipCache: true }
    )
    const batch = Array.isArray(json?.chartofaccounts) ? json.chartofaccounts : []
    all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all.map(mapChartAccountRow)
}

/**
 * Full expense CoA for Fixed/Flexible hierarchy.
 *
 * Do NOT use showbalance=true here: Zoho then applies show_rows=non_zero and
 * AccountType.Active, which drops most zero-balance expense accounts (and their
 * parent links). Default Active list is similarly incomplete for expenses.
 * AccountType.Expense returns the real parent/child tree (nested under
 * Fixed Expense / Flexible Expense).
 */
async function fetchExpenseChartOfAccountsRaw() {
  return fetchChartOfAccountsRaw({
    filterBy: 'AccountType.Expense',
    showBalance: false,
    source: 'ecommerce_accounting_coa_expense',
  })
}

async function fetchAccountDetail(accountId) {
  const id = clean(accountId)
  if (!id) return null
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/chartofaccounts/${encodeURIComponent(id)}`,
    new URLSearchParams(),
    'GET',
    undefined,
    { source: 'ecommerce_accounting_account_detail', skipCache: true }
  )
  return json?.chart_of_account || json?.chartofaccount || null
}

/**
 * Sum sales_with_tax from Books salesbycustomer for [fromDate, toDate].
 * @param {string} fromDate
 * @param {string} toDate
 * @param {{ entityList?: string }} [opts] — e.g. `creditnote` to match Zoho UI with invoices filtered out
 */
async function fetchSalesByCustomerTotal(fromDate, toDate, opts = {}) {
  const entityList = clean(opts.entityList)
  const returnsOnly = entityList === 'creditnote'
  let page = 1
  let salesWithTax = 0
  let sales = 0
  const rows = []
  while (page <= 30) {
    const sp = new URLSearchParams({
      from_date: fromDate,
      to_date: toDate,
      page: String(page),
      per_page: '200',
    })
    if (entityList) sp.set('entity_list', entityList)
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/reports/salesbycustomer`,
      sp,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_salesbycustomer', skipCache: true }
    )
    const batch = Array.isArray(json?.sales) ? json.sales : []
    for (const row of batch) {
      const swt = toNumber(row.sales_with_tax)
      const s = toNumber(row.sales)
      // Credit-note-only report shows negatives in the Zoho UI; store as positive return amounts.
      salesWithTax += returnsOnly ? Math.abs(swt) : swt
      sales += returnsOnly ? Math.abs(s) : s
      rows.push(row)
    }
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return {
    salesWithTax: round2(salesWithTax),
    sales: round2(sales),
    rows,
    entityList: entityList || null,
  }
}

/** Sales-by-customer restricted to credit notes (Zoho “filter out invoices”). */
async function fetchSalesByCustomerReturnsTotal(fromDate, toDate) {
  return fetchSalesByCustomerTotal(fromDate, toDate, { entityList: 'creditnote' })
}

/**
 * Invoices for a single day — fetch range then filter client-side
 * (Zoho list date filters are unreliable / newest-first truncated).
 */
async function fetchInvoicesForDay(dateYmd) {
  const { rows, truncated } = await fetchInvoices(dateYmd, dateYmd)
  const dayRows = (rows || []).filter((r) => clean(r.date) === dateYmd)
  return { rows: dayRows, truncated, fetched: (rows || []).length }
}

async function fetchCreditNotesForDay(dateYmd) {
  const { rows, truncated } = await fetchCreditNotes(dateYmd, dateYmd)
  const dayRows = (rows || []).filter((r) => clean(r.date || r.creditnote_date) === dateYmd)
  return { rows: dayRows, truncated, fetched: (rows || []).length }
}

/**
 * Paginate bank transactions from newest, keeping only rows on/after sinceYmd.
 * Stops once a full page is older than sinceYmd (no need for full history).
 */
async function fetchBankTransactionsSince(accountId, sinceYmd) {
  const id = clean(accountId)
  const since = clean(sinceYmd)
  if (!id || !since) return []
  const kept = []
  let page = 1
  while (page <= 50) {
    const sp = new URLSearchParams({
      account_id: id,
      page: String(page),
      per_page: '200',
      filter_by: 'Status.All',
      sort_column: 'date',
      sort_order: 'D',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/banktransactions`,
      sp,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_bank_tx', skipCache: true }
    )
    const batch = Array.isArray(json?.banktransactions) ? json.banktransactions : []
    if (!batch.length) break

    let olderOnly = true
    for (const t of batch) {
      const d = clean(t.date)
      if (!d) continue
      if (d >= since) {
        kept.push(t)
        olderOnly = false
      }
    }
    if (olderOnly) break
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return kept
}

/** @deprecated prefer fetchBankTransactionsSince — kept for callers that need full history */
async function fetchAllBankTransactions(accountId) {
  return fetchBankTransactionsSince(accountId, '2000-01-01')
}

async function fetchExpensesForDay(dateYmd) {
  const all = []
  let page = 1
  while (page <= 20) {
    const sp = new URLSearchParams({
      date_start: dateYmd,
      date_end: dateYmd,
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/expenses`,
      sp,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_expenses', skipCache: true }
    )
    const batch = Array.isArray(json?.expenses) ? json.expenses : []
    all.push(...batch.filter((e) => clean(e.date) === dateYmd))
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all
}

/**
 * Operating Expense total from P&L for [fromDate, toDate].
 */
async function fetchOperatingExpenseTotal(fromDate, toDate) {
  const sp = new URLSearchParams({ from_date: fromDate, to_date: toDate })
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/reports/profitandloss`,
    sp,
    'GET',
    undefined,
    { source: 'ecommerce_accounting_pnl', skipCache: true }
  )
  let operating = null
  let nonOperating = null
  function walk(nodes) {
    for (const n of nodes || []) {
      if (n.name === 'Operating Expense' || n.total_label === 'Total Operating Expense') {
        operating = toNumber(n.total)
      }
      if (n.name === 'Non Operating Expense' || n.total_label === 'Total Non Operating Expense') {
        nonOperating = toNumber(n.total)
      }
      if (Array.isArray(n.account_transactions)) walk(n.account_transactions)
    }
  }
  walk(json?.profit_and_loss)
  return {
    operatingExpense: operating == null ? null : round2(operating),
    nonOperatingExpense: nonOperating == null ? null : round2(nonOperating),
    raw: json,
  }
}

/**
 * Zoho Expense Summary by Category rows for [fromDate, toDate].
 * API may include non-expense accounts; callers should filter by CoA as needed.
 */
async function fetchExpensesByCategory(fromDate, toDate) {
  const all = []
  let page = 1
  while (page <= 30) {
    const sp = new URLSearchParams({
      from_date: fromDate,
      to_date: toDate,
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/reports/expensesbycategory`,
      sp,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_expenses_by_category', skipCache: true }
    )
    const batch = Array.isArray(json?.expense) ? json.expense : []
    all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all
}

/**
 * Sum expense-category amounts for accounts in two id sets (Flexible vs Fixed).
 *
 * Uses Zoho `expensesbycategory` field `amount` (without tax) — same as the
 * UI "Expense Summary by Category → Amount" column — not `amount_with_tax`.
 */
async function fetchExpenseTotalsSplit(fromDate, toDate, primarySet, secondarySet) {
  const rows = await fetchExpensesByCategory(fromDate, toDate)
  const primary = primarySet instanceof Set ? primarySet : new Set(primarySet || [])
  const secondary = secondarySet instanceof Set ? secondarySet : new Set(secondarySet || [])
  let primaryTotal = 0
  let secondaryTotal = 0
  const primaryMatched = []
  const secondaryMatched = []
  for (const r of rows) {
    const id = clean(r.account_id)
    if (!id) continue
    // Without tax — matches Zoho Expense Summary by Category "Amount"
    const amt = toNumber(r.amount)
    if (primary.has(id)) {
      primaryTotal += amt
      primaryMatched.push({
        accountId: id,
        accountName: clean(r.account_name),
        accountCode: clean(r.account_code),
        total: round2(amt),
      })
    }
    if (secondary.has(id)) {
      secondaryTotal += amt
      secondaryMatched.push({
        accountId: id,
        accountName: clean(r.account_name),
        accountCode: clean(r.account_code),
        total: round2(amt),
      })
    }
  }
  return {
    primaryTotal: round2(primaryTotal),
    secondaryTotal: round2(secondaryTotal),
    primaryMatched,
    secondaryMatched,
    raw: { expense: rows },
  }
}

/**
 * Sum expense-category amounts (without tax) for accounts in accountIdSet.
 */
async function fetchExpenseTotalsByAccountIds(fromDate, toDate, accountIdSet) {
  const split = await fetchExpenseTotalsSplit(fromDate, toDate, accountIdSet, new Set())
  return { total: split.primaryTotal, matched: split.primaryMatched, raw: split.raw }
}

module.exports = {
  BOOKS_V3,
  fetchChartOfAccountsRaw,
  fetchExpenseChartOfAccountsRaw,
  fetchAccountDetail,
  fetchSalesByCustomerTotal,
  fetchSalesByCustomerReturnsTotal,
  fetchInvoicesForDay,
  fetchCreditNotesForDay,
  fetchAllBankTransactions,
  fetchBankTransactionsSince,
  fetchExpensesForDay,
  fetchOperatingExpenseTotal,
  fetchExpensesByCategory,
  fetchExpenseTotalsByAccountIds,
  fetchExpenseTotalsSplit,
  fetchInvoices,
  fetchCreditNotes,
}

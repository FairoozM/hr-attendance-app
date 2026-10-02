/**
 * Zoho Books read helpers for Ecommerce Ledger / Summary.
 */

const { zohoBooksJsonRequest } = require('../zohoApiClient')
const {
  fetchInvoices,
  fetchCreditNotes,
  fetchInvoicesByIds,
} = require('../../integrations/zoho/zohoBooksClient')
const { clean, toNumber, round2 } = require('./accountNature')
const { isBaseCurrencyRow } = require('./baseCurrency')

const BOOKS_V3 = '/books/v3'

async function fetchChartOfAccountsRaw() {
  const all = []
  let page = 1
  while (page <= 20) {
    const params = new URLSearchParams({
      showbalance: 'true',
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/chartofaccounts`,
      params,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_coa', skipCache: true }
    )
    const batch = Array.isArray(json?.chartofaccounts) ? json.chartofaccounts : []
    all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all.map((a) => ({
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
  }))
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
  return {
    rows: await hydrateInvoiceBaseTotals(dayRows),
    truncated,
    fetched: (rows || []).length,
  }
}

async function fetchCreditNotesForDay(dateYmd) {
  const { rows, truncated } = await fetchCreditNotes(dateYmd, dateYmd)
  const dayRows = (rows || []).filter((r) => clean(r.date || r.creditnote_date) === dateYmd)
  return {
    rows: await hydrateCreditNoteBaseTotals(dayRows),
    truncated,
    fetched: (rows || []).length,
  }
}

/**
 * Zoho list endpoints omit the bcy_* fields, so a SAR invoice arrives as SAR
 * only. Open the few foreign-currency documents to read the AED total Zoho
 * actually posted; on failure `baseAmount` still converts via exchange_rate.
 */
async function hydrateInvoiceBaseTotals(rows) {
  const foreign = (rows || []).filter((r) => !isBaseCurrencyRow(r) && clean(r.invoice_id))
  if (!foreign.length) return rows || []
  let details
  try {
    details = await fetchInvoicesByIds(
      foreign.map((r) => clean(r.invoice_id)),
      { concurrency: 4 }
    )
  } catch {
    return rows
  }
  return rows.map((row) => {
    const detail = details.get(clean(row.invoice_id))
    if (!detail || detail.bcy_total == null) return row
    return {
      ...row,
      bcy_total: detail.bcy_total,
      bcy_sub_total: detail.bcy_sub_total,
      exchange_rate: detail.exchange_rate ?? row.exchange_rate,
    }
  })
}

async function hydrateCreditNoteBaseTotals(rows) {
  const foreign = (rows || []).filter(
    (r) => !isBaseCurrencyRow(r) && clean(r.creditnote_id || r.credit_note_id)
  )
  if (!foreign.length) return rows || []
  const details = new Map()
  for (const row of foreign) {
    const id = clean(row.creditnote_id || row.credit_note_id)
    try {
      const json = await zohoBooksJsonRequest(
        `${BOOKS_V3}/creditnotes/${encodeURIComponent(id)}`,
        new URLSearchParams(),
        'GET',
        undefined,
        { source: 'ecommerce_accounting_credit_note_detail', skipCache: true }
      )
      const detail = json?.creditnote || json?.credit_note
      if (detail?.bcy_total != null) details.set(id, detail)
    } catch {
      // Leave it to exchange_rate conversion.
    }
  }
  if (!details.size) return rows
  return rows.map((row) => {
    const detail = details.get(clean(row.creditnote_id || row.credit_note_id))
    if (!detail) return row
    return {
      ...row,
      bcy_total: detail.bcy_total,
      exchange_rate: detail.exchange_rate ?? row.exchange_rate,
    }
  })
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

/**
 * Zoho "Account Transactions" report rows for one account, keyed by transaction_id
 * → entity_number (the Transaction# column in Zoho: invoice, payment or journal number).
 * The report ignores a plain account_id param; only the `rule` filter narrows it.
 */
async function fetchAccountTransactionNumbers(accountId, fromYmd, toYmd) {
  const id = clean(accountId)
  const from = clean(fromYmd)
  const to = clean(toYmd) || from
  const numbers = new Map()
  if (!id || !from) return numbers
  const rule = JSON.stringify({
    columns: [{ index: 1, field: 'account_id', value: [id], comparator: 'in', group: 'report' }],
    criteria_string: '1',
  })
  let page = 1
  while (page <= 20) {
    const sp = new URLSearchParams({
      from_date: from,
      to_date: to,
      rule,
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/reports/accounttransaction`,
      sp,
      'GET',
      undefined,
      { source: 'ecommerce_accounting_account_tx_numbers', skipCache: true }
    )
    const groups = Array.isArray(json?.account_transactions) ? json.account_transactions : []
    for (const group of groups) {
      const lines = Array.isArray(group?.account_transactions) ? group.account_transactions : []
      for (const line of lines) {
        const txId = clean(line?.transaction_id)
        if (!txId || clean(line?.account_id) !== id) continue
        const number = clean(line?.entity_number)
        if (number && !numbers.has(txId)) numbers.set(txId, number)
      }
    }
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return numbers
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
 * Zoho Books "Expense Summary by Category" (`reports/expensesbycategory`).
 * `amount` is exclusive of tax; `amount_with_tax` matches the report's Amount With Tax column.
 */
async function fetchExpensesByCategory(fromDate, toDate) {
  const rows = []
  let page = 1
  while (page <= 20) {
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
    for (const row of batch) {
      rows.push({
        accountId: clean(row.account_id),
        accountName: clean(row.account_name),
        amount: round2(toNumber(row.amount)),
        amountWithTax: round2(toNumber(row.amount_with_tax)),
      })
    }
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return rows
}

/**
 * Account ids Zoho reports under the P&L expense trees for a period.
 * Expense-by-Category also lists balance-sheet accounts (inventory, prepaid
 * rent, payables, VAT); this set is what separates real expenses from them.
 */
async function fetchPnlExpenseAccountIds(fromDate, toDate) {
  const sp = new URLSearchParams({ from_date: fromDate, to_date: toDate })
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/reports/profitandloss`,
    sp,
    'GET',
    undefined,
    { source: 'ecommerce_accounting_pnl_expense_ids', skipCache: true }
  )
  const ids = new Set()
  function walk(nodes, underExpense) {
    for (const n of nodes || []) {
      const label = clean(n.name || n.total_label)
      const inExpense = underExpense || /expense/i.test(label)
      const id = clean(n.account_id)
      if (inExpense && id) ids.add(id)
      if (Array.isArray(n.account_transactions)) walk(n.account_transactions, inExpense)
    }
  }
  walk(json?.profit_and_loss, false)
  return ids
}

/**
 * Sum Expense-by-Category tax-exclusive `amount` for accounts in idSet.
 * Input VAT is recoverable, so expense totals never use amount_with_tax.
 */
function sumExpensesByCategory(rows, idSet) {
  const set = idSet instanceof Set ? idSet : new Set(idSet || [])
  let total = 0
  const matched = []
  for (const row of rows || []) {
    if (!row.accountId || !set.has(row.accountId)) continue
    total += toNumber(row.amount)
    matched.push(row)
  }
  return { total: round2(total), matched }
}

/**
 * Sum P&L amounts for accounts whose id is in accountIdSet under expense trees.
 */
async function fetchExpenseTotalsByAccountIds(fromDate, toDate, accountIdSet) {
  const split = await fetchExpenseTotalsSplit(fromDate, toDate, accountIdSet, new Set())
  return { total: split.primaryTotal, matched: split.primaryMatched, raw: split.raw }
}

/**
 * One P&L fetch → totals for two account id sets (Fixed vs Flexible).
 * Avoids duplicate profitandloss calls for the same date range.
 */
async function fetchExpenseTotalsSplit(fromDate, toDate, primarySet, secondarySet) {
  const sp = new URLSearchParams({ from_date: fromDate, to_date: toDate })
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/reports/profitandloss`,
    sp,
    'GET',
    undefined,
    { source: 'ecommerce_accounting_pnl_accounts', skipCache: true }
  )
  const primary = primarySet instanceof Set ? primarySet : new Set(primarySet || [])
  const secondary = secondarySet instanceof Set ? secondarySet : new Set(secondarySet || [])
  let primaryTotal = 0
  let secondaryTotal = 0
  const primaryMatched = []
  const secondaryMatched = []
  function walk(nodes) {
    for (const n of nodes || []) {
      const id = clean(n.account_id)
      if (id) {
        const amt = toNumber(n.total)
        if (primary.has(id)) {
          primaryTotal += amt
          primaryMatched.push({
            accountId: id,
            accountName: clean(n.name),
            accountCode: clean(n.account_code),
            total: round2(amt),
          })
        }
        if (secondary.has(id)) {
          secondaryTotal += amt
          secondaryMatched.push({
            accountId: id,
            accountName: clean(n.name),
            accountCode: clean(n.account_code),
            total: round2(amt),
          })
        }
      }
      if (Array.isArray(n.account_transactions)) walk(n.account_transactions)
    }
  }
  walk(json?.profit_and_loss)
  return {
    primaryTotal: round2(primaryTotal),
    secondaryTotal: round2(secondaryTotal),
    primaryMatched,
    secondaryMatched,
    raw: json,
  }
}

module.exports = {
  BOOKS_V3,
  fetchChartOfAccountsRaw,
  fetchAccountDetail,
  fetchSalesByCustomerTotal,
  fetchSalesByCustomerReturnsTotal,
  fetchInvoicesForDay,
  fetchCreditNotesForDay,
  fetchAllBankTransactions,
  fetchBankTransactionsSince,
  fetchAccountTransactionNumbers,
  fetchExpensesForDay,
  fetchOperatingExpenseTotal,
  fetchExpenseTotalsByAccountIds,
  fetchExpenseTotalsSplit,
  fetchExpensesByCategory,
  fetchPnlExpenseAccountIds,
  sumExpensesByCategory,
  fetchInvoices,
  fetchCreditNotes,
}

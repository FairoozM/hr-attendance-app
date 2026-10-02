/**
 * Daily Ecommerce Ledger — Zoho Books backed opening/day/closing sections.
 */

const { dailyEcommerceLedgerAccounts: CFG } = require('../../config/dailyEcommerceLedgerAccounts')
const {
  assertYmd,
  previousYmd,
  yearStartYmd,
  dayNameFromYmd,
  applyAccountMovement,
  attachRunningBalances,
  clean,
  toNumber,
  round2,
} = require('../ecommerceAccounting/accountNature')
const {
  fetchSalesByCustomerTotal,
  fetchInvoicesForDay,
  fetchCreditNotesForDay,
  fetchAccountDetail,
  fetchBankTransactionsSince,
  fetchAccountTransactionNumbers,
  fetchExpenseNotesByAccount,
  fetchExpensesByCategory,
  fetchPnlExpenseAccountIds,
} = require('../ecommerceAccounting/zohoBooksReads')
const {
  buildExpenseGroupMap,
  classifyExpenseAccount,
} = require('../../config/ecommerceExpenseClassification')
const {
  BASE_CURRENCY_CODE,
  baseAmount,
  foreignCurrencyInfo,
} = require('../ecommerceAccounting/baseCurrency')

const BANK_STYLE_COLUMNS = ['reference', 'transactionNumber', 'description', 'debit', 'credit', 'balance']

function emptySection(title, extras = {}) {
  return {
    key: extras.key || title,
    title,
    opening: 0,
    closing: 0,
    netMovement: 0,
    rows: [],
    columns: extras.columns || BANK_STYLE_COLUMNS,
    configMissing: Boolean(extras.configMissing),
    warnings: extras.warnings || [],
    accountId: extras.accountId || '',
    accountName: extras.accountName || '',
    accountCode: extras.accountCode || '',
    ...extras,
  }
}

/**
 * Reconstruct opening/closing for a bank/cash/credit-card account as of reportDate.
 * Uses current Zoho closing balance minus signed movements after start-of-day.
 */
async function buildBankStyleSection({
  key,
  title,
  accountId,
  accountType = 'bank',
  balanceNature = null,
  reportDate,
}) {
  const id = clean(accountId)
  if (!id) {
    return emptySection(title, {
      key,
      configMissing: true,
      warnings: ['Account ID not configured'],
      columns: BANK_STYLE_COLUMNS,
    })
  }

  const detail = await fetchAccountDetail(id)
  const accountName = clean(detail?.account_name || detail?.name)
  const accountCode = clean(detail?.account_code || detail?.code)
  const type = clean(detail?.account_type || accountType)
  const rawClosing = toNumber(detail?.closing_balance ?? detail?.current_balance ?? detail?.balance)

  const txs = await fetchBankTransactionsSince(id, reportDate)
  const onDay = []
  const afterDay = []
  for (const t of txs) {
    const d = clean(t.date)
    if (!d) continue
    if (d === reportDate) onDay.push(t)
    else if (d > reportDate) afterDay.push(t)
  }

  const nature = balanceNature
  let afterSum = 0
  for (const t of afterDay) {
    afterSum += applyAccountMovement(
      {
        amount: t.amount,
        debitOrCredit: t.debit_or_credit,
      },
      type,
      nature
    )
  }
  const warnings = []
  let transactionNumbers = new Map()
  if (onDay.length) {
    try {
      transactionNumbers = await fetchAccountTransactionNumbers(id, reportDate, reportDate)
    } catch (err) {
      warnings.push(`Transaction# unavailable: ${clean(err?.message) || 'Zoho Account Transactions report failed'}`)
    }
  }

  let daySum = 0
  const dayRowsRaw = []
  for (const t of onDay) {
    const delta = applyAccountMovement(
      {
        amount: t.amount,
        debitOrCredit: t.debit_or_credit,
      },
      type,
      nature
    )
    daySum += delta
    const side = clean(t.debit_or_credit).toLowerCase()
    const amt = Math.abs(toNumber(t.amount))
    dayRowsRaw.push({
      reference: clean(t.transaction_id || t.imported_transaction_id || ''),
      transactionNumber: transactionNumbers.get(clean(t.transaction_id)) || '',
      description: clean(t.payee || t.description || t.reference_number || t.transaction_type || ''),
      debit: side === 'debit' ? amt : 0,
      credit: side === 'credit' ? amt : 0,
      sale: null,
      delta,
      transactionType: clean(t.transaction_type),
      date: clean(t.date),
      sourceTransactionId: clean(t.transaction_id),
    })
  }

  const opening = round2(rawClosing - afterSum - daySum)
  const closing = round2(rawClosing - afterSum)
  const rows = attachRunningBalances(opening, dayRowsRaw)

  return {
    key,
    title,
    opening,
    closing,
    netMovement: round2(daySum),
    rows,
    columns: BANK_STYLE_COLUMNS,
    configMissing: false,
    warnings,
    accountId: id,
    accountName: accountName || title,
    accountCode,
    accountType: type,
    balanceNature: nature || (type === 'cash' || type === 'bank' ? 'debit_normal' : null),
  }
}

async function buildSalesSection(reportDate) {
  const yearStart = yearStartYmd(reportDate)
  const before = previousYmd(reportDate)

  const [openingSales, daySales, invoices, creditNotes] = await Promise.all([
    before < yearStart
      ? Promise.resolve({ salesWithTax: 0 })
      : fetchSalesByCustomerTotal(yearStart, before),
    fetchSalesByCustomerTotal(reportDate, reportDate),
    fetchInvoicesForDay(reportDate),
    fetchCreditNotesForDay(reportDate),
  ])

  const opening = round2(openingSales.salesWithTax)
  const todaySaleNet = round2(daySales.salesWithTax)

  const invoiceRows = (invoices.rows || [])
    .slice()
    .sort((a, b) => clean(a.invoice_number).localeCompare(clean(b.invoice_number)))
    .map((inv) => {
      // AED, never the invoice currency — balances and Zoho reports are base currency.
      const sale = baseAmount(inv)
      const foreign = foreignCurrencyInfo(inv)
      return {
        reference: clean(inv.invoice_number),
        description: clean(inv.customer_name || inv.reference_number || ''),
        debit: 0,
        credit: 0,
        sale,
        delta: sale,
        invoiceId: clean(inv.invoice_id),
        paymentMode: clean(inv.payment_mode || inv.paymentMode || ''),
        status: clean(inv.status),
        date: clean(inv.date),
        ...(foreign ? { ...foreign, baseCurrencyCode: BASE_CURRENCY_CODE } : {}),
      }
    })

  const returnTotal = round2(
    (creditNotes.rows || []).reduce((s, cn) => s + baseAmount(cn), 0)
  )
  const grossInvoiceTotal = round2(invoiceRows.reduce((s, r) => s + toNumber(r.sale), 0))

  const rowsWithInvoices = attachRunningBalances(opening, invoiceRows)
  const afterInvoices = rowsWithInvoices.length
    ? rowsWithInvoices[rowsWithInvoices.length - 1].balance
    : opening

  const returnRow = {
    reference: 'SALES RETURN',
    description: (creditNotes.rows || [])
      .map((cn) => clean(cn.creditnote_number || cn.credit_note_number || cn.customer_name))
      .filter(Boolean)
      .join(', '),
    debit: 0,
    credit: returnTotal,
    sale: round2(-returnTotal),
    delta: round2(-returnTotal),
    isSalesReturn: true,
  }
  const afterReturn = round2(afterInvoices - returnTotal)

  const todaySaleRow = {
    reference: "TODAY'S SALE",
    description: 'Net daily sales (salesbycustomer sales_with_tax)',
    debit: 0,
    credit: 0,
    sale: todaySaleNet,
    delta: 0,
    isSummary: true,
    balance: afterReturn,
    runningBalance: afterReturn,
  }

  const closing = round2(opening + todaySaleNet)
  // Prefer identity Closing = Opening + Today's Sale (matches legacy / salesbycustomer).
  // Invoice−return may differ slightly from salesbycustomer if list truncated.
  const warnings = []
  if (invoices.truncated) {
    warnings.push('Invoice list may be truncated by Zoho page cap; day invoices filtered client-side.')
  }
  const convertedCodes = [...new Set(invoiceRows.map((r) => r.currencyCode).filter(Boolean))]
  if (convertedCodes.length) {
    warnings.push(
      `${convertedCodes.join(', ')} invoices are shown in ${BASE_CURRENCY_CODE} using each invoice's Zoho base-currency total.`
    )
  }
  const reconGross = round2(grossInvoiceTotal - returnTotal)
  if (Math.abs(reconGross - todaySaleNet) > 0.02) {
    warnings.push(
      `Invoice total − returns (${reconGross}) differs from salesbycustomer Today's Sale (${todaySaleNet}). Using salesbycustomer for closing.`
    )
  }

  return {
    key: 'sales',
    title: 'Sales',
    opening,
    closing,
    netMovement: todaySaleNet,
    todaySale: todaySaleNet,
    saleReturn: returnTotal,
    grossInvoiceTotal,
    rows: [...rowsWithInvoices, { ...returnRow, balance: afterReturn, runningBalance: afterReturn }, todaySaleRow],
    columns: ['reference', 'description', 'sale', 'balance'],
    configMissing: false,
    warnings,
    accountId: CFG.salesAccountId,
    accountName: CFG.salesAccountName,
    accountCode: CFG.salesAccountCode,
    creditNotes: (creditNotes.rows || []).map((cn) => ({
      reference: clean(cn.creditnote_number || cn.credit_note_number),
      total: baseAmount(cn),
      customerName: clean(cn.customer_name),
      creditNoteId: clean(cn.creditnote_id),
    })),
  }
}

/**
 * Total Expense-by-Category rows the way Daily Accounting Summary does —
 * tax-exclusive Amount, accounts classified Fixed or Flexible — but with both
 * groups added together, because this report carries one Expenses balance.
 *
 * Balance-sheet rows Zoho lists in that report (inventory, prepaid rent,
 * payables, VAT) never reach either total.
 */
function totalExpensesByCategory(rows, groupMap, expenseAccountIds) {
  let total = 0
  const included = []
  const excluded = []
  for (const row of rows || []) {
    const amount = toNumber(row.amount)
    const entry = {
      accountId: clean(row.accountId),
      accountName: clean(row.accountName),
      amount: round2(amount),
    }
    const group = classifyExpenseAccount(row, groupMap, expenseAccountIds)
    if (group === 'flexible' || group === 'fixed') {
      total += amount
      included.push(entry)
    } else if (expenseAccountIds.has(entry.accountId)) {
      excluded.push(entry)
    }
  }
  const byAmountDesc = (a, b) => Math.abs(b.amount) - Math.abs(a.amount)
  return {
    total: round2(total),
    included: included.sort(byAmountDesc),
    excluded: excluded.sort(byAmountDesc),
  }
}

/**
 * Expenses read from Zoho "Expense Summary by Category" — the same source as
 * Daily Accounting Summary, so the two reports show one expense figure. Closing
 * is the year-to-date total, today is the selected day, opening is the rest; the
 * day is listed category by category, with no Fixed/Flexible split.
 */
async function buildExpenseSection(reportDate) {
  const yearStart = yearStartYmd(reportDate)
  const warnings = []
  const [expenseAccountIds, categoryThrough, categoryToday, notesByAccount] = await Promise.all([
    fetchPnlExpenseAccountIds(yearStart, reportDate),
    fetchExpensesByCategory(yearStart, reportDate),
    fetchExpensesByCategory(reportDate, reportDate),
    fetchExpenseNotesByAccount(reportDate).catch((err) => {
      warnings.push(`Expense notes unavailable: ${clean(err?.message) || 'Zoho expenses read failed'}`)
      return new Map()
    }),
  ])

  const groupMap = buildExpenseGroupMap()
  const through = totalExpensesByCategory(categoryThrough, groupMap, expenseAccountIds)
  const today = totalExpensesByCategory(categoryToday, groupMap, expenseAccountIds)

  const closing = through.total
  const dayExpenseTotal = today.total
  const opening = round2(closing - dayExpenseTotal)

  const dayRowsRaw = today.included.map((row) => ({
    reference: row.accountId,
    description: row.accountName,
    notes: (notesByAccount.get(row.accountId) || []).join('; '),
    debit: row.amount > 0 ? row.amount : 0,
    credit: row.amount < 0 ? round2(-row.amount) : 0,
    sale: null,
    delta: row.amount,
    accountName: row.accountName,
  }))

  const rows = attachRunningBalances(opening, dayRowsRaw)
  if (through.excluded.length) {
    const names = through.excluded
      .slice(0, 5)
      .map((a) => `${a.accountName} (${a.amount})`)
      .join(', ')
    warnings.push(
      `${through.excluded.length} expense account(s) are neither Fixed nor Flexible and are excluded: ${names}.`
    )
  }
  warnings.push(
    'Expenses use Zoho Expense Summary by Category (tax-exclusive Amount), the same source as Daily Accounting Summary, with Fixed and Flexible added together.'
  )

  return {
    key: 'expenses',
    title: 'Expenses',
    opening,
    closing,
    netMovement: dayExpenseTotal,
    rows,
    columns: ['reference', 'description', 'notes', 'debit', 'credit', 'balance'],
    configMissing: false,
    warnings,
    accountId: '',
    accountName: 'Expense Summary by Category',
    accountCode: '',
    source: 'zoho_books_expenses_by_category',
    excludedAccounts: through.excluded,
  }
}

/**
 * @param {{ date?: string }} opts
 */
async function buildDailyEcommerceLedger(opts = {}) {
  const reportDate = assertYmd(opts.date || require('../ecommerceAccounting/accountNature').todayUaeYmd())
  const dayName = dayNameFromYmd(reportDate)

  const salesP = buildSalesSection(reportDate)
  const cashP = buildBankStyleSection({
    key: 'cashInHand',
    title: 'Cash in Hand',
    accountId: CFG.cashInHandAccountId,
    accountType: 'cash',
    reportDate,
  })
  const expensesP = buildExpenseSection(reportDate)
  const basmatP = buildBankStyleSection({
    key: 'basmatPayable',
    title: 'Basmat Payable Against Cash',
    accountId: CFG.basmatPayableAgainstCashAccountId,
    accountType: 'bank',
    balanceNature: CFG.basmatPayableBalanceNature || 'credit_normal',
    reportDate,
  })
  const purchaseP = CFG.purchasePaymentsAccountId
    ? buildBankStyleSection({
        key: 'purchasePayments',
        title: 'Purchase & Payments',
        accountId: CFG.purchasePaymentsAccountId,
        reportDate,
      })
    : Promise.resolve(
        emptySection('Purchase & Payments', {
          key: 'purchasePayments',
          configMissing: true,
          warnings: [
            'Purchase & Payments account ID not configured (DAILY_LEDGER_PURCHASE_PAYMENTS_ACCOUNT_ID). No Zoho account matched legacy opening 541,492.02 during probe.',
          ],
          columns: BANK_STYLE_COLUMNS,
        })
      )
  const banksP = Promise.all(
    (CFG.bankAccountIds || []).map((id) =>
      buildBankStyleSection({
        key: `bank:${id}`,
        title: 'Bank',
        accountId: id,
        accountType: 'bank',
        reportDate,
      })
    )
  )
  const cardsP = Promise.all(
    (CFG.creditCardAccountIds || []).map((id) =>
      buildBankStyleSection({
        key: `creditCard:${id}`,
        title: 'Credit Card',
        accountId: id,
        accountType: 'bank',
        reportDate,
      })
    )
  )

  const [sales, cashInHand, expenses, basmatPayable, purchasePayments, banks, creditCards] =
    await Promise.all([salesP, cashP, expensesP, basmatP, purchaseP, banksP, cardsP])

  if (basmatPayable.accountName) {
    basmatPayable.accountName =
      basmatPayable.accountName || CFG.basmatPayableAgainstCashAccountName
  }
  for (const b of banks) {
    if (b.accountName) b.title = b.accountName
  }
  for (const c of creditCards) {
    if (c.accountName) c.title = c.accountName
  }

  return {
    reportDate,
    dayName,
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Dubai',
    sections: {
      sales,
      cashInHand,
      expenses,
      purchasePayments,
      basmatPayable,
      banks,
      creditCards,
    },
    accountConfig: {
      salesAccountId: CFG.salesAccountId,
      cashInHandAccountId: CFG.cashInHandAccountId,
      basmatPayableAgainstCashAccountId: CFG.basmatPayableAgainstCashAccountId,
      purchasePaymentsAccountId: CFG.purchasePaymentsAccountId || null,
      bankAccountIds: CFG.bankAccountIds,
      creditCardAccountIds: CFG.creditCardAccountIds,
    },
  }
}

module.exports = {
  buildDailyEcommerceLedger,
  buildSalesSection,
  buildExpenseSection,
  totalExpensesByCategory,
  buildBankStyleSection,
  emptySection,
}

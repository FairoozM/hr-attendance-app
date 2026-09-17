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
  fetchAllBankTransactions,
  fetchExpensesForDay,
  fetchOperatingExpenseTotal,
} = require('../ecommerceAccounting/zohoBooksReads')

function emptySection(title, extras = {}) {
  return {
    key: extras.key || title,
    title,
    opening: 0,
    closing: 0,
    netMovement: 0,
    rows: [],
    columns: extras.columns || ['reference', 'description', 'debit', 'credit', 'balance'],
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
      columns: ['reference', 'description', 'debit', 'credit', 'balance'],
    })
  }

  const detail = await fetchAccountDetail(id)
  const accountName = clean(detail?.account_name || detail?.name)
  const accountCode = clean(detail?.account_code || detail?.code)
  const type = clean(detail?.account_type || accountType)
  const rawClosing = toNumber(detail?.closing_balance ?? detail?.current_balance ?? detail?.balance)

  const txs = await fetchAllBankTransactions(id)
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
    columns: ['reference', 'description', 'debit', 'credit', 'balance'],
    configMissing: false,
    warnings: [],
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
      const sale = round2(toNumber(inv.total))
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
      }
    })

  const returnTotal = round2(
    (creditNotes.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0)
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
      total: round2(toNumber(cn.total)),
      customerName: clean(cn.customer_name),
      creditNoteId: clean(cn.creditnote_id),
    })),
  }
}

async function buildExpenseSection(reportDate) {
  const yearStart = yearStartYmd(reportDate)
  const before = previousYmd(reportDate)
  const [openingPnL, dayPnL, expenses] = await Promise.all([
    before < yearStart
      ? Promise.resolve({ operatingExpense: 0 })
      : fetchOperatingExpenseTotal(yearStart, before),
    fetchOperatingExpenseTotal(reportDate, reportDate),
    fetchExpensesForDay(reportDate),
  ])

  const opening = round2(openingPnL.operatingExpense || 0)
  const dayExpenseTotal = round2(dayPnL.operatingExpense || 0)

  const dayRowsRaw = (expenses || []).map((e) => {
    const amt = round2(toNumber(e.total ?? e.amount))
    return {
      reference: clean(e.expense_id),
      description: clean(e.description || e.reference_number || e.account_name || ''),
      debit: amt,
      credit: 0,
      sale: null,
      delta: amt,
      accountName: clean(e.account_name),
      paidThrough: clean(e.paid_through_account_name),
      paidThroughAccountId: clean(e.paid_through_account_id),
      sourceTransactionId: clean(e.expense_id),
      date: clean(e.date),
    }
  })

  const rows = attachRunningBalances(opening, dayRowsRaw)
  const closing = round2(opening + dayExpenseTotal)
  const warnings = []
  const rowSum = round2(dayRowsRaw.reduce((s, r) => s + r.delta, 0))
  if (Math.abs(rowSum - dayExpenseTotal) > 0.02) {
    warnings.push(
      `Day expense rows sum (${rowSum}) differs from P&L Operating Expense day total (${dayExpenseTotal}). Closing uses P&L.`
    )
  }
  warnings.push(
    'Opening/closing expense use Zoho Books P&L Total Operating Expense (not Fixed/Flexible parents alone). Paper ledgers may exclude some P&L lines.'
  )

  return {
    key: 'expenses',
    title: 'Expenses',
    opening,
    closing,
    netMovement: dayExpenseTotal,
    rows,
    columns: ['reference', 'description', 'debit', 'credit', 'balance'],
    configMissing: false,
    warnings,
    accountId: '',
    accountName: 'Operating Expense (P&L)',
    accountCode: '',
    source: 'zoho_books_profitandloss_operating_expense',
  }
}

/**
 * @param {{ date?: string }} opts
 */
async function buildDailyEcommerceLedger(opts = {}) {
  const reportDate = assertYmd(opts.date || require('../ecommerceAccounting/accountNature').todayUaeYmd())
  const dayName = dayNameFromYmd(reportDate)

  const sales = await buildSalesSection(reportDate)
  const cashInHand = await buildBankStyleSection({
    key: 'cashInHand',
    title: 'Cash in Hand',
    accountId: CFG.cashInHandAccountId,
    accountType: 'cash',
    reportDate,
  })
  const expenses = await buildExpenseSection(reportDate)
  const basmatPayable = await buildBankStyleSection({
    key: 'basmatPayable',
    title: 'Basmat Payable Against Cash',
    accountId: CFG.basmatPayableAgainstCashAccountId,
    accountType: 'bank',
    balanceNature: CFG.basmatPayableBalanceNature || 'credit_normal',
    reportDate,
  })
  if (basmatPayable.accountName) {
    basmatPayable.accountName =
      basmatPayable.accountName || CFG.basmatPayableAgainstCashAccountName
  }

  let purchasePayments = emptySection('Purchase & Payments', {
    key: 'purchasePayments',
    configMissing: !CFG.purchasePaymentsAccountId,
    warnings: CFG.purchasePaymentsAccountId
      ? []
      : [
          'Purchase & Payments account ID not configured (DAILY_LEDGER_PURCHASE_PAYMENTS_ACCOUNT_ID). No Zoho account matched legacy opening 541,492.02 during probe.',
        ],
    columns: ['reference', 'description', 'debit', 'credit', 'balance'],
  })
  if (CFG.purchasePaymentsAccountId) {
    purchasePayments = await buildBankStyleSection({
      key: 'purchasePayments',
      title: 'Purchase & Payments',
      accountId: CFG.purchasePaymentsAccountId,
      reportDate,
    })
  }

  const banks = []
  for (const id of CFG.bankAccountIds || []) {
    banks.push(
      await buildBankStyleSection({
        key: `bank:${id}`,
        title: 'Bank',
        accountId: id,
        accountType: 'bank',
        reportDate,
      })
    )
  }
  for (const b of banks) {
    if (b.accountName) b.title = b.accountName
  }

  const creditCards = []
  for (const id of CFG.creditCardAccountIds || []) {
    creditCards.push(
      await buildBankStyleSection({
        key: `creditCard:${id}`,
        title: 'Credit Card',
        accountId: id,
        accountType: 'bank',
        reportDate,
      })
    )
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
  buildBankStyleSection,
  emptySection,
}

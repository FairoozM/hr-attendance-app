/**
 * Management Ecommerce Summary — DAY / MONTH / YEAR / expenses / returns / ratios.
 * Sales from Zoho Books salesbycustomer; returns from salesbycustomer entity_list=creditnote
 * (matches Zoho UI with invoices filtered out). Expenses from Fixed/Flexible CoA parents.
 */

const { dailyEcommerceLedgerAccounts: CFG } = require('../../config/dailyEcommerceLedgerAccounts')
const {
  assertYmd,
  previousYmd,
  yearStartYmd,
  monthStartYmd,
  dayOfYearFromYmd,
  monthNumberFromYmd,
  dayNameFromYmd,
  todayUaeYmd,
  calculateReturnSaleRatio,
  getDescendantAccountIds,
  clean,
  toNumber,
  round2,
} = require('../ecommerceAccounting/accountNature')
const {
  fetchSalesByCustomerTotal,
  fetchSalesByCustomerReturnsTotal,
  fetchInvoicesForDay,
  fetchChartOfAccountsRaw,
  fetchExpensesByCategory,
  sumExpensesByCategory,
} = require('../ecommerceAccounting/zohoBooksReads')

/**
 * Classify invoice as cash vs credit from Zoho fields when present.
 * Cash: payment_mode hints cash/bank same-day paid; Credit: unpaid/overdue/sent AR, or unknown.
 */
function classifyInvoiceCashCredit(inv) {
  const mode = clean(inv.payment_mode || inv.paymentMode).toLowerCase()
  const status = clean(inv.status).toLowerCase()
  const balance = toNumber(inv.balance ?? inv.balance_due)
  if (mode.includes('cash')) return 'cash'
  if (status === 'paid' && (mode.includes('cash') || mode === '')) {
    if (mode.includes('cash')) return 'cash'
  }
  if (mode.includes('cash')) return 'cash'
  if (balance <= 0.001 && status === 'paid' && /cash|petty/i.test(mode)) return 'cash'
  return 'credit'
}

/** Calendar days from month-start through reportDate (inclusive), min 1. */
function calendarDaysThroughMonth(reportDate) {
  assertYmd(reportDate)
  return Math.max(1, Number(reportDate.slice(8, 10)) || 1)
}

/**
 * @param {{ date?: string }} opts
 */
async function buildEcommerceSummaryReport(opts = {}) {
  const reportDate = assertYmd(opts.date || todayUaeYmd())
  const dayName = dayNameFromYmd(reportDate)
  const totalDays = dayOfYearFromYmd(reportDate)
  const monthNumber = monthNumberFromYmd(reportDate)
  const yearStart = yearStartYmd(reportDate)
  const monthStart = monthStartYmd(reportDate)
  const before = previousYmd(reportDate)

  // Phase 1 — period sales aggregates (one at a time)
  const daySales = await fetchSalesByCustomerTotal(reportDate, reportDate)
  const monthOpeningSales =
    before >= monthStart
      ? await fetchSalesByCustomerTotal(monthStart, before)
      : { salesWithTax: 0 }
  const yearOpeningSales =
    before >= yearStart ? await fetchSalesByCustomerTotal(yearStart, before) : { salesWithTax: 0 }
  const yearToDateSales = await fetchSalesByCustomerTotal(yearStart, reportDate)
  const monthToDateSales = await fetchSalesByCustomerTotal(monthStart, reportDate)

  // Phase 2 — day invoice detail (cash vs credit); returns come from salesbycustomer below
  const dayInvoices = await fetchInvoicesForDay(reportDate)

  let cashSales = 0
  let creditSales = 0
  const invoiceDetails = []
  for (const inv of dayInvoices.rows || []) {
    const total = round2(toNumber(inv.total))
    const kind = classifyInvoiceCashCredit(inv)
    if (kind === 'cash') cashSales += total
    else creditSales += total
    invoiceDetails.push({
      invoiceNumber: clean(inv.invoice_number),
      customerName: clean(inv.customer_name),
      total,
      paymentMode: clean(inv.payment_mode || inv.paymentMode),
      status: clean(inv.status),
      classification: kind,
    })
  }
  cashSales = round2(cashSales)
  creditSales = round2(creditSales)

  const hasPaymentMode = invoiceDetails.some((r) => r.paymentMode)

  // Phase 3 — returns via salesbycustomer entity_list=creditnote (Zoho UI: invoices filtered out)
  const dayReturns = await fetchSalesByCustomerReturnsTotal(reportDate, reportDate)
  const openingReturns =
    before >= yearStart
      ? await fetchSalesByCustomerReturnsTotal(yearStart, before)
      : { salesWithTax: 0 }
  const totalReturns = await fetchSalesByCustomerReturnsTotal(yearStart, reportDate)
  const monthReturnsSbc = await fetchSalesByCustomerReturnsTotal(monthStart, reportDate)

  const saleReturn = round2(dayReturns.salesWithTax)
  const openingSaleReturn = round2(openingReturns.salesWithTax)
  const totalSaleReturn = round2(totalReturns.salesWithTax)
  const monthReturns = round2(monthReturnsSbc.salesWithTax)
  const todaySaleReturn = saleReturn

  const dayGrossFromInvoices = round2(cashSales + creditSales)
  const todaySalesGross =
    dayGrossFromInvoices > 0 ? dayGrossFromInvoices : round2(daySales.salesWithTax + saleReturn)
  const dayTotalSales = round2(daySales.salesWithTax)

  const monthOpening = round2(monthOpeningSales.salesWithTax)
  const monthTotal = round2(monthToDateSales.salesWithTax)
  const yearOpening = round2(yearOpeningSales.salesWithTax)
  const yearTotal = round2(yearToDateSales.salesWithTax)

  // Calendar days — avoids 16–31 salesbycustomer calls that caused 429 + long builds
  const monthDaysWithSales = calendarDaysThroughMonth(reportDate)
  const monthAvgPerDay = round2(monthTotal / monthDaysWithSales)

  const yearAvgPerDay = totalDays > 0 ? round2(yearTotal / totalDays) : null
  const yearAvgPerMonth = monthNumber > 0 ? round2(yearTotal / monthNumber) : null

  // Phase 4 — Fixed/Flexible from Expense Summary by Category (amount with tax)
  const chartAccounts = await fetchChartOfAccountsRaw()
  const fixedIds = getDescendantAccountIds(chartAccounts, CFG.fixedExpensesParentAccountId)
  const flexIds = getDescendantAccountIds(chartAccounts, CFG.flexibleExpensesParentAccountId)
  const fixedSet = new Set(fixedIds)
  const flexSet = new Set(flexIds)

  const categoryThrough = await fetchExpensesByCategory(yearStart, reportDate)
  const categoryToday = await fetchExpensesByCategory(reportDate, reportDate)
  const flexThrough = sumExpensesByCategory(categoryThrough, flexSet)
  const fixedThrough = sumExpensesByCategory(categoryThrough, fixedSet)
  const flexToday = sumExpensesByCategory(categoryToday, flexSet)
  const fixedToday = sumExpensesByCategory(categoryToday, fixedSet)

  const totalFlexible = round2(flexThrough.total)
  const totalFixed = round2(fixedThrough.total)
  const todayFlexible = round2(flexToday.total)
  const todayFixed = round2(fixedToday.total)
  const openingFlexible = round2(totalFlexible - todayFlexible)
  const openingFixed = round2(totalFixed - todayFixed)

  const warnings = []
  if (!hasPaymentMode) {
    warnings.push(
      'Zoho invoice list did not expose payment_mode for this day; Cash Sales may be 0 and all invoice totals classified as Credit Sales.'
    )
  }
  if (flexIds.length <= 1 && fixedIds.length <= 1) {
    warnings.push(
      'Fixed Expense / Flexible Expense parents have no child accounts in the Zoho chart of accounts, so Expense by Category totals for those groups are empty.'
    )
  }
  warnings.push(
    'Month Avg Sale / Day divides by calendar days in the month through this date (not distinct days-with-sales), to avoid Zoho rate limits.'
  )
  warnings.push(
    'Fixed and Flexible expenses are Amount With Tax from Zoho Expense Summary by Category, limited to each parent account and its chart-of-accounts children.'
  )

  const monthGrossApprox = round2(monthTotal + monthReturns)

  const dayRatio = calculateReturnSaleRatio(saleReturn, todaySalesGross || dayGrossFromInvoices)
  const monthRatio = calculateReturnSaleRatio(monthReturns, monthGrossApprox || monthTotal)
  const yearRatio = calculateReturnSaleRatio(totalSaleReturn, yearTotal)

  return {
    reportDate,
    dayName,
    totalDays,
    monthNumber,
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Dubai',
    warnings,
    day: {
      cashSales,
      creditSales,
      grossSales: todaySalesGross,
      saleReturn,
      totalSales: dayTotalSales,
      invoiceDetails,
    },
    month: {
      openingSales: monthOpening,
      todaySales: todaySalesGross,
      todaySaleReturn: saleReturn,
      totalSales: monthTotal,
      averageSalePerDay: monthAvgPerDay,
      daysWithSalesDenominator: monthDaysWithSales,
    },
    year: {
      openingSales: yearOpening,
      todaySales: todaySalesGross,
      todaySaleReturn: saleReturn,
      totalSales: yearTotal,
      averageSalePerDay: yearAvgPerDay,
      averageSalePerMonth: yearAvgPerMonth,
    },
    expenses: {
      openingFlexible,
      openingFixed,
      todayFlexible,
      todayFixed,
      totalFlexible,
      totalFixed,
      averageFlexiblePerDay: totalDays > 0 ? round2(totalFlexible / totalDays) : null,
      averageFlexiblePerMonth: monthNumber > 0 ? round2(totalFlexible / monthNumber) : null,
      averageFixedPerDay: totalDays > 0 ? round2(totalFixed / totalDays) : null,
      averageFixedPerMonth: monthNumber > 0 ? round2(totalFixed / monthNumber) : null,
      fixedParentAccountId: CFG.fixedExpensesParentAccountId,
      flexibleParentAccountId: CFG.flexibleExpensesParentAccountId,
      fixedDescendantCount: fixedIds.length,
      flexibleDescendantCount: flexIds.length,
    },
    returns: {
      opening: openingSaleReturn,
      today: todaySaleReturn,
      total: totalSaleReturn,
      averagePerDay: totalDays > 0 ? round2(totalSaleReturn / totalDays) : null,
      averagePerMonth: monthNumber > 0 ? round2(totalSaleReturn / monthNumber) : null,
    },
    ratios: {
      day: dayRatio,
      month: monthRatio,
      year: yearRatio,
      dayDisplay: dayRatio == null ? null : Math.round(dayRatio),
      monthDisplay: monthRatio == null ? null : Math.round(monthRatio),
      yearDisplay: yearRatio == null ? null : Math.round(yearRatio),
    },
    limitations: {
      cashCredit:
        'Cash vs Credit uses Zoho invoice payment_mode when present; otherwise invoices default to Credit Sales.',
      fixedFlexible:
        'Fixed/Flexible totals are Zoho Expense Summary by Category amount_with_tax for the Fixed Expense and Flexible Expense accounts and their chart-of-accounts children. Categories outside those parents (for example Amazon Commission) are not included.',
      monthAvgDenominator:
        'Month Avg Sale / Day uses calendar days through the selected date (avoids per-day Zoho report calls).',
      saleReturns:
        'Sale returns use Zoho Sales by Customer with entity_list=creditnote (same as filtering out invoices in the Zoho UI), sales_with_tax absolute.',
    },
  }
}

module.exports = {
  buildEcommerceSummaryReport,
  classifyInvoiceCashCredit,
  calendarDaysThroughMonth,
}

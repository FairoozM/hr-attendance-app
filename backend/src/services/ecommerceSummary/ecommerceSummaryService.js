/**
 * Management Ecommerce Summary — DAY / MONTH / YEAR / expenses / returns / ratios.
 * Sales from Zoho Books salesbycustomer + invoices/credit notes; expenses from Fixed/Flexible CoA parents.
 *
 * Call pattern is intentionally serial / low-concurrency: parallel Zoho bursts hit HTTP 429.
 * Month avg uses calendar days in the month through the report date (not one salesbycustomer
 * call per day) so the build stays inside reasonable wall time under job polling.
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
  fetchInvoicesForDay,
  fetchCreditNotesForDay,
  fetchCreditNotes,
  fetchChartOfAccountsRaw,
  fetchExpenseTotalsSplit,
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

  // Phase 2 — day invoice / CN detail
  const dayInvoices = await fetchInvoicesForDay(reportDate)
  const dayCreditNotes = await fetchCreditNotesForDay(reportDate)

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
  const saleReturn = round2((dayCreditNotes.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0))
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

  // Phase 3 — returns: one YTD credit-note pull
  const yearCn = await fetchCreditNotes(yearStart, reportDate)
  let openingSaleReturn = 0
  let totalSaleReturn = 0
  let monthReturns = 0
  for (const cn of yearCn.rows || []) {
    const d = clean(cn.date || cn.creditnote_date)
    const amt = toNumber(cn.total)
    if (!d || d > reportDate || d < yearStart) continue
    totalSaleReturn += amt
    if (d < reportDate) openingSaleReturn += amt
    if (d >= monthStart && d <= reportDate) monthReturns += amt
  }
  openingSaleReturn = round2(openingSaleReturn)
  totalSaleReturn = round2(totalSaleReturn)
  monthReturns = round2(monthReturns)
  const todaySaleReturn = saleReturn

  // Phase 4 — CoA + Fixed/Flexible (3 P&L ranges)
  const chartAccounts = await fetchChartOfAccountsRaw()
  const fixedIds = getDescendantAccountIds(chartAccounts, CFG.fixedExpensesParentAccountId)
  const flexIds = getDescendantAccountIds(chartAccounts, CFG.flexibleExpensesParentAccountId)
  const fixedSet = new Set(fixedIds)
  const flexSet = new Set(flexIds)

  const throughSplit = await fetchExpenseTotalsSplit(yearStart, reportDate, flexSet, fixedSet)
  const openingSplit =
    before >= yearStart
      ? await fetchExpenseTotalsSplit(yearStart, before, flexSet, fixedSet)
      : { primaryTotal: 0, secondaryTotal: 0 }
  const todaySplit = await fetchExpenseTotalsSplit(reportDate, reportDate, flexSet, fixedSet)

  const warnings = []
  if (!hasPaymentMode) {
    warnings.push(
      'Zoho invoice list did not expose payment_mode for this day; Cash Sales may be 0 and all invoice totals classified as Credit Sales.'
    )
  }
  if (Math.abs(throughSplit.primaryTotal) < 0.01 && Math.abs(throughSplit.secondaryTotal) < 0.01) {
    warnings.push(
      'Fixed/Flexible parent descendants have little/no P&L amount (Zoho hierarchy may not nest all expense accounts under those parents). Totals reflect matched descendant accounts only.'
    )
  }
  warnings.push(
    'Month Avg Sale / Day divides by calendar days in the month through this date (not distinct days-with-sales), to avoid Zoho rate limits.'
  )

  const totalFlexible = round2(throughSplit.primaryTotal)
  const totalFixed = round2(throughSplit.secondaryTotal)
  const openingFlexible = round2(openingSplit.primaryTotal)
  const openingFixed = round2(openingSplit.secondaryTotal)
  const todayFlexible = round2(todaySplit.primaryTotal)
  const todayFixed = round2(todaySplit.secondaryTotal)

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
        'Fixed/Flexible totals sum P&L lines for Zoho parent + descendants only (not all Operating Expense accounts).',
      monthAvgDenominator:
        'Month Avg Sale / Day uses calendar days through the selected date (avoids per-day Zoho report calls).',
    },
  }
}

module.exports = {
  buildEcommerceSummaryReport,
  classifyInvoiceCashCredit,
  calendarDaysThroughMonth,
}

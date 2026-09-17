/**
 * Management Ecommerce Summary — DAY / MONTH / YEAR / expenses / returns / ratios.
 * Sales from Zoho Books salesbycustomer + invoices/credit notes; expenses from Fixed/Flexible CoA parents.
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
  countDaysWithSales,
  calculateReturnSaleRatio,
  getDescendantAccountIds,
  clean,
  toNumber,
  round2,
  addDaysYmd,
} = require('../ecommerceAccounting/accountNature')
const {
  fetchSalesByCustomerTotal,
  fetchInvoicesForDay,
  fetchCreditNotesForDay,
  fetchCreditNotes,
  fetchChartOfAccountsRaw,
  fetchExpenseTotalsByAccountIds,
  fetchOperatingExpenseTotal,
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
    // Paid without explicit mode — treat as cash only when mode says cash; else credit settlement.
    if (mode.includes('cash')) return 'cash'
  }
  if (mode.includes('cash')) return 'cash'
  if (balance <= 0.001 && status === 'paid' && /cash|petty/i.test(mode)) return 'cash'
  return 'credit'
}

async function sumSalesByDay(fromYmd, toYmd) {
  const map = new Map()
  let cur = fromYmd
  // Cap concurrent days — use monthly salesbycustomer per day only when range small;
  // for month avg we need days-with-sales: fetch whole month once then we need daily.
  // salesbycustomer is period aggregate only — walk day by day (bounded by month length ≤ 31).
  while (cur <= toYmd) {
    const { salesWithTax } = await fetchSalesByCustomerTotal(cur, cur)
    map.set(cur, salesWithTax)
    cur = addDaysYmd(cur, 1)
  }
  return map
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

  const [
    dayInvoices,
    dayCreditNotes,
    daySales,
    monthOpeningSales,
    yearOpeningSales,
    yearToDateSales,
    monthToDateSales,
    chartAccounts,
  ] = await Promise.all([
    fetchInvoicesForDay(reportDate),
    fetchCreditNotesForDay(reportDate),
    fetchSalesByCustomerTotal(reportDate, reportDate),
    before >= monthStart ? fetchSalesByCustomerTotal(monthStart, before) : Promise.resolve({ salesWithTax: 0 }),
    before >= yearStart ? fetchSalesByCustomerTotal(yearStart, before) : Promise.resolve({ salesWithTax: 0 }),
    fetchSalesByCustomerTotal(yearStart, reportDate),
    fetchSalesByCustomerTotal(monthStart, reportDate),
    fetchChartOfAccountsRaw(),
  ])

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

  // If Zoho list has no payment_mode and everything classified credit, keep limitation note.
  const hasPaymentMode = invoiceDetails.some((r) => r.paymentMode)
  const saleReturn = round2((dayCreditNotes.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0))
  const dayGrossFromInvoices = round2(cashSales + creditSales)
  const dayNetFromInvoices = round2(dayGrossFromInvoices - saleReturn)
  const todaySalesGross = dayGrossFromInvoices > 0 ? dayGrossFromInvoices : round2(daySales.salesWithTax + saleReturn)
  const dayTotalSales = round2(daySales.salesWithTax)

  const monthOpening = round2(monthOpeningSales.salesWithTax)
  const monthTotal = round2(monthToDateSales.salesWithTax)
  const yearOpening = round2(yearOpeningSales.salesWithTax)
  const yearTotal = round2(yearToDateSales.salesWithTax)

  // Days-with-sales for month average (choice A)
  const monthDaily = await sumSalesByDay(monthStart, reportDate)
  const monthDaysWithSales = countDaysWithSales(monthDaily, monthStart, reportDate) || 1
  const monthAvgPerDay = round2(monthTotal / monthDaysWithSales)

  const yearAvgPerDay = totalDays > 0 ? round2(yearTotal / totalDays) : null
  const yearAvgPerMonth = monthNumber > 0 ? round2(yearTotal / monthNumber) : null

  // Returns YTD
  const [yearReturnsBefore, yearReturnsThrough] = await Promise.all([
    before >= yearStart
      ? fetchCreditNotes(yearStart, before).then((r) =>
          round2((r.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0))
        )
      : Promise.resolve(0),
    fetchCreditNotes(yearStart, reportDate).then((r) =>
      round2((r.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0))
    ),
  ])
  const openingSaleReturn = yearReturnsBefore
  const totalSaleReturn = yearReturnsThrough
  const todaySaleReturn = saleReturn

  // Fixed / Flexible via parent descendants on P&L
  const fixedIds = getDescendantAccountIds(chartAccounts, CFG.fixedExpensesParentAccountId)
  const flexIds = getDescendantAccountIds(chartAccounts, CFG.flexibleExpensesParentAccountId)
  const fixedSet = new Set(fixedIds)
  const flexSet = new Set(flexIds)

  const [flexOpening, flexThrough, fixedOpening, fixedThrough, flexToday, fixedToday] =
    await Promise.all([
      before >= yearStart
        ? fetchExpenseTotalsByAccountIds(yearStart, before, flexSet)
        : Promise.resolve({ total: 0, matched: [] }),
      fetchExpenseTotalsByAccountIds(yearStart, reportDate, flexSet),
      before >= yearStart
        ? fetchExpenseTotalsByAccountIds(yearStart, before, fixedSet)
        : Promise.resolve({ total: 0, matched: [] }),
      fetchExpenseTotalsByAccountIds(yearStart, reportDate, fixedSet),
      fetchExpenseTotalsByAccountIds(reportDate, reportDate, flexSet),
      fetchExpenseTotalsByAccountIds(reportDate, reportDate, fixedSet),
    ])

  // Fallback: if Fixed/Flexible P&L children sum ~0, use Operating Expense split note
  const warnings = []
  if (!hasPaymentMode) {
    warnings.push(
      'Zoho invoice list did not expose payment_mode for this day; Cash Sales may be 0 and all invoice totals classified as Credit Sales.'
    )
  }
  if (Math.abs(flexThrough.total) < 0.01 && Math.abs(fixedThrough.total) < 0.01) {
    warnings.push(
      'Fixed/Flexible parent descendants have little/no P&L amount (Zoho hierarchy may not nest all expense accounts under those parents). Totals reflect matched descendant accounts only.'
    )
  }

  const totalFlexible = round2(flexThrough.total)
  const totalFixed = round2(fixedThrough.total)
  const openingFlexible = round2(flexOpening.total)
  const openingFixed = round2(fixedOpening.total)
  const todayFlexible = round2(flexToday.total)
  const todayFixed = round2(fixedToday.total)

  // Month returns for ratio: need month return total
  const monthReturns = await fetchCreditNotes(monthStart, reportDate).then((r) =>
    round2((r.rows || []).reduce((s, cn) => s + toNumber(cn.total), 0))
  )
  const monthGrossApprox = round2(monthTotal + monthReturns)

  const dayRatio = calculateReturnSaleRatio(saleReturn, todaySalesGross || dayGrossFromInvoices)
  const monthRatio = calculateReturnSaleRatio(monthReturns, monthGrossApprox || monthTotal)
  // Year: legacy 11% = returns / net year total
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
      /** percent points for UI */
      dayDisplay: dayRatio == null ? null : Math.round(dayRatio),
      monthDisplay: monthRatio == null ? null : Math.round(monthRatio),
      yearDisplay: yearRatio == null ? null : Math.round(yearRatio),
    },
    limitations: {
      cashCredit:
        'Cash vs Credit uses Zoho invoice payment_mode when present; otherwise invoices default to Credit Sales.',
      fixedFlexible:
        'Fixed/Flexible totals sum P&L lines for Zoho parent + descendants only (not all Operating Expense accounts).',
      monthAvgDenominator: 'Month Avg Sale / Day uses count of days-with-sales in the month through the selected date.',
    },
  }
}

module.exports = {
  buildEcommerceSummaryReport,
  classifyInvoiceCashCredit,
}

/**
 * Excel export for Daily Accounting Details.
 * Summary sheet with every section's opening / movement / closing, then one
 * sheet per section holding its rows between Opening and Closing lines.
 */

import * as XLSX from 'xlsx'
import type { LedgerRow, LedgerSectionData } from './LedgerSection'

export type LedgerExportReport = {
  reportDate: string
  dayName?: string
  generatedAt?: string
  sections: {
    sales: LedgerSectionData
    cashInHand: LedgerSectionData
    expenses: LedgerSectionData
    purchasePayments: LedgerSectionData
    basmatPayable: LedgerSectionData
    banks: LedgerSectionData[]
    creditCards: LedgerSectionData[]
  }
}

const MAX_SHEET_NAME = 31

/** Zoho's base currency; every ledger balance is posted in it. */
const BASE_CURRENCY = 'AED'

export function ledgerExportFilename(reportDate: string) {
  return `daily-accounting-details-${reportDate}.xlsx`
}

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
export function toSheetName(title: string, used: Set<string>) {
  const base = (title || 'Sheet').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, MAX_SHEET_NAME)
  let name = base || 'Sheet'
  let suffix = 2
  while (used.has(name.toLowerCase())) {
    const tail = ` (${suffix})`
    name = `${base.slice(0, MAX_SHEET_NAME - tail.length)}${tail}`
    suffix += 1
  }
  used.add(name.toLowerCase())
  return name
}

function movementOf(section: LedgerSectionData) {
  return section.netMovement ?? section.closing - section.opening
}

export function orderedSections(report: LedgerExportReport): LedgerSectionData[] {
  const s = report.sections
  return [
    s.sales,
    s.cashInHand,
    s.expenses,
    s.purchasePayments,
    s.basmatPayable,
    ...(s.banks || []),
    ...(s.creditCards || []),
  ].filter((section): section is LedgerSectionData => Boolean(section) && !section.configMissing)
}

export function buildSummaryRows(report: LedgerExportReport) {
  return orderedSections(report).map((section) => ({
    Section: section.title,
    'Account Code': section.accountCode || '',
    'Account Name': section.accountName || '',
    [`Opening (${BASE_CURRENCY})`]: section.opening ?? 0,
    [`Movement (${BASE_CURRENCY})`]: movementOf(section),
    [`Closing (${BASE_CURRENCY})`]: section.closing ?? 0,
  }))
}

/**
 * Rows as a sheet matrix so Opening / Closing lines keep the on-screen layout.
 *
 * Every amount is AED: Zoho's base currency, and what the opening and closing
 * balances are built from. Foreign-currency documents (KSA invoices are SAR)
 * keep their original figure in trailing columns for reference only.
 */
export function buildSectionSheetRows(section: LedgerSectionData) {
  const cols = section.columns || ['reference', 'description', 'debit', 'credit', 'balance']
  const useSale = cols.includes('sale')
  const useTxnNumber = cols.includes('transactionNumber')
  const useNotes = cols.includes('notes')
  const rows = section.rows || []
  const showCurrency = rows.some((row) => row.currencyCode)

  const core = ['Reference']
  if (useTxnNumber) core.push('Transaction#')
  core.push('Description')
  if (useNotes) core.push('Notes')
  if (useSale) core.push(`Sale (${BASE_CURRENCY})`)
  if (cols.includes('debit')) core.push(`DR (${BASE_CURRENCY})`)
  if (cols.includes('credit')) core.push(`CR (${BASE_CURRENCY})`)
  core.push(`Balance (${BASE_CURRENCY})`)

  const header = showCurrency ? [...core, 'Doc Currency', 'Doc Amount'] : core
  const balanceIndex = core.length - 1
  const line = (label: string, balance: number) => {
    const cells: (string | number)[] = new Array(core.length).fill('')
    cells[0] = label
    cells[balanceIndex] = balance ?? 0
    return cells
  }

  const body = rows.map((row: LedgerRow) => {
    const cells: (string | number)[] = [row.reference || '']
    if (useTxnNumber) cells.push(row.transactionNumber || '')
    cells.push(row.description || '')
    if (useNotes) cells.push(row.notes || '')
    if (useSale) cells.push(row.sale ?? 0)
    if (cols.includes('debit')) cells.push(row.debit ?? 0)
    if (cols.includes('credit')) cells.push(row.credit ?? 0)
    cells.push(row.balance ?? row.runningBalance ?? 0)
    if (showCurrency) {
      cells.push(row.currencyCode || '')
      cells.push(row.currencyCode ? (row.originalAmount ?? '') : '')
    }
    return cells
  })

  return [header, line('Opening', section.opening), ...body, line('Closing', section.closing)]
}

export function exportDailyEcommerceLedgerXlsx(report: LedgerExportReport) {
  const sections = orderedSections(report)
  if (!sections.length) return false

  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()

  const meta = [
    ['Daily Accounting Details'],
    ['Date', report.reportDate],
    ['Day', report.dayName || ''],
    ['Generated', report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''],
    [''],
  ]
  const summary = XLSX.utils.aoa_to_sheet(meta)
  XLSX.utils.sheet_add_json(summary, buildSummaryRows(report), { origin: -1 })
  summary['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(workbook, summary, toSheetName('Summary', used))

  for (const section of sections) {
    const sheet = XLSX.utils.aoa_to_sheet(buildSectionSheetRows(section))
    sheet['!cols'] = [
      { wch: 18 },
      { wch: 40 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 13 },
      { wch: 14 },
    ]
    XLSX.utils.book_append_sheet(workbook, sheet, toSheetName(section.title, used))
  }

  XLSX.writeFile(workbook, ledgerExportFilename(report.reportDate))
  return true
}

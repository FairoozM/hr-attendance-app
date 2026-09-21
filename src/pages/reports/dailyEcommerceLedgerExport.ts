/**
 * Excel export for the Daily Ecommerce Ledger.
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

export function ledgerExportFilename(reportDate: string) {
  return `daily-ecommerce-ledger-${reportDate}.xlsx`
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
    Opening: section.opening ?? 0,
    Movement: movementOf(section),
    Closing: section.closing ?? 0,
  }))
}

/** Rows as a sheet matrix so Opening / Closing lines keep the on-screen layout. */
export function buildSectionSheetRows(section: LedgerSectionData) {
  const cols = section.columns || ['reference', 'description', 'debit', 'credit', 'balance']
  const useSale = cols.includes('sale')
  const header = ['Reference', 'Description']
  if (useSale) header.push('Sale')
  if (cols.includes('debit')) header.push('DR')
  if (cols.includes('credit')) header.push('CR')
  header.push('Balance')

  const blanks = header.length - 3
  const line = (label: string, balance: number) => [
    label,
    '',
    ...Array.from({ length: blanks }, () => ''),
    balance ?? 0,
  ]

  const body = (section.rows || []).map((row: LedgerRow) => {
    const cells: (string | number)[] = [row.reference || '', row.description || '']
    if (useSale) cells.push(row.sale ?? 0)
    if (cols.includes('debit')) cells.push(row.debit ?? 0)
    if (cols.includes('credit')) cells.push(row.credit ?? 0)
    cells.push(row.balance ?? row.runningBalance ?? 0)
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
    ['Daily Ecommerce Ledger'],
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
    sheet['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(workbook, sheet, toSheetName(section.title, used))
  }

  XLSX.writeFile(workbook, ledgerExportFilename(report.reportDate))
  return true
}

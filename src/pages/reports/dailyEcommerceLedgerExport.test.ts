import { describe, expect, it } from 'vitest'
import {
  buildSectionSheetRows,
  buildSummaryRows,
  ledgerExportFilename,
  orderedSections,
  toSheetName,
  type LedgerExportReport,
} from './dailyEcommerceLedgerExport'

function makeReport(): LedgerExportReport {
  return {
    reportDate: '2026-09-16',
    dayName: 'Wednesday',
    generatedAt: '2026-09-16T18:00:00.000Z',
    sections: {
      sales: {
        key: 'sales',
        title: 'Sales',
        accountCode: '1645',
        accountName: 'Sales',
        opening: 2506931.56,
        closing: 2512617.22,
        netMovement: 5685.66,
        columns: ['reference', 'description', 'sale', 'balance'],
        rows: [
          { reference: 'INV-043963', description: 'Amazon', sale: 79, balance: 2507010.56 },
          { reference: 'CN-0012', description: 'Return', sale: -10, balance: 2507000.56, isSalesReturn: true },
        ],
      },
      cashInHand: { key: 'cash', title: 'Cash In Hand', opening: 100, closing: 150, rows: [] },
      expenses: { key: 'exp', title: 'Expenses', opening: 0, closing: 0, rows: [] },
      purchasePayments: {
        key: 'pp',
        title: 'Purchase Payments',
        opening: 0,
        closing: 0,
        configMissing: true,
      },
      basmatPayable: { key: 'basmat', title: 'BASMAT CASH FOR ECOMMERCE', opening: 5, closing: 5 },
      banks: [{ key: 'bank-1', title: 'Bank', opening: 10, closing: 20, netMovement: 10 }],
      creditCards: [{ key: 'cc-1', title: 'Credit Card', opening: 0, closing: -30 }],
    },
  }
}

describe('ledgerExportFilename', () => {
  it('stamps the report date', () => {
    expect(ledgerExportFilename('2026-09-16')).toBe('daily-ecommerce-ledger-2026-09-16.xlsx')
  })
})

describe('toSheetName', () => {
  it('strips characters Excel rejects and caps length at 31', () => {
    const used = new Set<string>()
    expect(toSheetName('Bank / Card [AED]: main', used)).toBe('Bank - Card -AED-- main')
    expect(toSheetName('x'.repeat(40), used)).toHaveLength(31)
  })

  it('de-duplicates repeated titles', () => {
    const used = new Set<string>()
    expect(toSheetName('Bank', used)).toBe('Bank')
    expect(toSheetName('Bank', used)).toBe('Bank (2)')
    expect(toSheetName('Bank', used)).toBe('Bank (3)')
  })
})

describe('orderedSections', () => {
  it('keeps ledger order and drops unconfigured sections', () => {
    expect(orderedSections(makeReport()).map((s) => s.title)).toEqual([
      'Sales',
      'Cash In Hand',
      'Expenses',
      'BASMAT CASH FOR ECOMMERCE',
      'Bank',
      'Credit Card',
    ])
  })
})

describe('buildSummaryRows', () => {
  it('derives movement when the section omits it', () => {
    const rows = buildSummaryRows(makeReport())
    expect(rows[0]).toEqual({
      Section: 'Sales',
      'Account Code': '1645',
      'Account Name': 'Sales',
      Opening: 2506931.56,
      Movement: 5685.66,
      Closing: 2512617.22,
    })
    expect(rows[1].Movement).toBe(50)
    expect(rows[rows.length - 1].Movement).toBe(-30)
  })
})

describe('buildSectionSheetRows', () => {
  it('wraps rows with Opening and Closing lines under the Sale column', () => {
    const report = makeReport()
    const rows = buildSectionSheetRows(report.sections.sales)
    expect(rows[0]).toEqual(['Reference', 'Description', 'Sale', 'Balance'])
    expect(rows[1]).toEqual(['Opening', '', '', 2506931.56])
    expect(rows[2]).toEqual(['INV-043963', 'Amazon', 79, 2507010.56])
    expect(rows[rows.length - 1]).toEqual(['Closing', '', '', 2512617.22])
  })

  it('uses DR / CR columns when the section has no Sale column', () => {
    const section = {
      title: 'Cash In Hand',
      opening: 100,
      closing: 150,
      rows: [{ reference: 'JV-1', description: 'Deposit', debit: 50, credit: null, balance: 150 }],
    }
    const rows = buildSectionSheetRows(section)
    expect(rows[0]).toEqual(['Reference', 'Description', 'DR', 'CR', 'Balance'])
    expect(rows[1]).toEqual(['Opening', '', '', '', 100])
    expect(rows[2]).toEqual(['JV-1', 'Deposit', 50, 0, 150])
  })
})

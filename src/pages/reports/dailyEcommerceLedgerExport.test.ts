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
          {
            reference: 'INV-043972',
            description: 'KSA-Amazon',
            sale: 478.73,
            balance: 2507489.29,
            currencyCode: 'SAR',
            originalAmount: 489,
            exchangeRate: 0.979,
          },
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
    expect(ledgerExportFilename('2026-09-16')).toBe('daily-accounting-details-2026-09-16.xlsx')
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
      'Opening (AED)': 2506931.56,
      'Movement (AED)': 5685.66,
      'Closing (AED)': 2512617.22,
    })
    expect(rows[1]['Movement (AED)']).toBe(50)
    expect(rows[rows.length - 1]['Movement (AED)']).toBe(-30)
  })
})

describe('buildSectionSheetRows', () => {
  it('wraps rows with Opening and Closing lines under the Sale column', () => {
    const report = makeReport()
    const rows = buildSectionSheetRows(report.sections.sales)
    expect(rows[0].slice(0, 4)).toEqual([
      'Reference',
      'Description',
      'Sale (AED)',
      'Balance (AED)',
    ])
    expect(rows[1]).toEqual(['Opening', '', '', 2506931.56])
    expect(rows[2].slice(0, 4)).toEqual(['INV-043963', 'Amazon', 79, 2507010.56])
    expect(rows[rows.length - 1]).toEqual(['Closing', '', '', 2512617.22])
  })

  it('exports the AED amount for a SAR invoice, keeping SAR for reference only', () => {
    const rows = buildSectionSheetRows(makeReport().sections.sales)
    expect(rows[0]).toEqual([
      'Reference',
      'Description',
      'Sale (AED)',
      'Balance (AED)',
      'Doc Currency',
      'Doc Amount',
    ])
    // The Sale column must never carry the 489 SAR face value.
    expect(rows[3]).toEqual(['INV-043972', 'KSA-Amazon', 478.73, 2507489.29, 'SAR', 489])
    // AED documents leave the reference columns empty rather than claiming AED amounts.
    expect(rows[2]).toEqual(['INV-043963', 'Amazon', 79, 2507010.56, '', ''])
  })

  it('omits the currency columns when every row is already AED', () => {
    const rows = buildSectionSheetRows({
      title: 'Cash In Hand',
      opening: 100,
      closing: 150,
      rows: [{ reference: 'JV-1', description: 'Deposit', debit: 50, credit: null, balance: 150 }],
    })
    expect(rows[0]).toEqual([
      'Reference',
      'Description',
      'DR (AED)',
      'CR (AED)',
      'Balance (AED)',
    ])
    expect(rows[1]).toEqual(['Opening', '', '', '', 100])
    expect(rows[2]).toEqual(['JV-1', 'Deposit', 50, 0, 150])
  })

  it('adds a Transaction# column when the section carries it', () => {
    const rows = buildSectionSheetRows({
      title: 'Cash In Hand',
      opening: 611.28,
      closing: 831.28,
      columns: ['reference', 'transactionNumber', 'description', 'debit', 'credit', 'balance'],
      rows: [
        {
          reference: '4265011000042381037',
          transactionNumber: 'INV-044034',
          description: 'Damage Reimbursement',
          debit: 220,
          credit: 0,
          balance: 831.28,
        },
      ],
    })
    expect(rows[0]).toEqual([
      'Reference',
      'Transaction#',
      'Description',
      'DR (AED)',
      'CR (AED)',
      'Balance (AED)',
    ])
    expect(rows[1]).toEqual(['Opening', '', '', '', '', 611.28])
    expect(rows[2]).toEqual(['4265011000042381037', 'INV-044034', 'Damage Reimbursement', 220, 0, 831.28])
  })

  it('adds a Notes column for the Expenses section', () => {
    const rows = buildSectionSheetRows({
      title: 'Expenses',
      opening: 1000,
      closing: 1166.49,
      columns: ['reference', 'description', 'notes', 'debit', 'credit', 'balance'],
      rows: [
        {
          reference: '4265011000003071795',
          description: 'Warehouse Expense',
          notes: 'A4 Papers & Stationery for Warehouse; Stretch Film for Warehouse',
          debit: 166.49,
          credit: 0,
          balance: 1166.49,
        },
      ],
    })
    expect(rows[0]).toEqual([
      'Reference',
      'Description',
      'Notes',
      'DR (AED)',
      'CR (AED)',
      'Balance (AED)',
    ])
    expect(rows[1]).toEqual(['Opening', '', '', '', '', 1000])
    expect(rows[2]).toEqual([
      '4265011000003071795',
      'Warehouse Expense',
      'A4 Papers & Stationery for Warehouse; Stretch Film for Warehouse',
      166.49,
      0,
      1166.49,
    ])
  })
})

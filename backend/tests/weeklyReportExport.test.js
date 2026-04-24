/**
 * Unit tests for weekly report Excel export and shared totals helper.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { sumReportGrandTotals } = require('../src/utils/weeklyReportTotals')
const { buildBusinessTableXlsxBuffer } = require('../src/utils/businessTableXlsx')
const {
  buildWeeklyReportXlsxBuffer,
  getExportDownloadFilename,
  getExportSheetTitleForGroup,
} = require('../src/services/weeklyReportXlsxService')

test('sumReportGrandTotals matches display summation of Zoho rows', () => {
  const items = [
    {
      opening_stock: 100,
      purchase_amount: 10,
      returned_to_wholesale: 1,
      closing_stock: 109,
      sales_amount: 0,
    },
    {
      opening_stock: 50.5,
      purchase_amount: 5,
      returned_to_wholesale: 0,
      closing_stock: 45,
      sales_amount: 10,
    },
  ]
  const t = sumReportGrandTotals(items)
  assert.deepEqual(t, {
    opening_stock: 150.5,
    purchase_amount: 15,
    returned_to_wholesale: 1,
    closing_stock: 154,
    sales_amount: 10,
  })
})

test('sumReportGrandTotals: null rows are skipped; others still sum', () => {
  const t = sumReportGrandTotals([
    { opening_stock: 1, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
    { opening_stock: null, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
  ])
  assert.equal(t.opening_stock, 1)
  assert.equal(t.purchase_amount, 0)
})

test('sumReportGrandTotals: all null in a column → total null', () => {
  const t = sumReportGrandTotals([
    { opening_stock: null, purchase_amount: null, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
  ])
  assert.equal(t.opening_stock, null)
  assert.equal(t.purchase_amount, null)
})

test('getExportDownloadFilename uses documented slug for slow / other', () => {
  assert.equal(
    getExportDownloadFilename('slow_moving', '2026-01-01', '2026-01-07'),
    'weekly-slow-moving-report-2026-01-01-to-2026-01-07.xlsx',
  )
  assert.equal(
    getExportDownloadFilename('other_family', '2026-12-20', '2026-12-27'),
    'weekly-other-family-report-2026-12-20-to-2026-12-27.xlsx',
  )
  assert.equal(
    getExportDownloadFilename('custom_key', '2025-01-01', '2025-01-01'),
    'weekly-custom-key-report-2025-01-01-to-2025-01-01.xlsx',
  )
})

test('buildBusinessTableXlsxBuffer: rejects empty column list', async () => {
  await assert.rejects(
    () =>
      buildBusinessTableXlsxBuffer({
        sheetTitle: 'X',
        fromDate: '2026-01-01',
        toDate: '2026-01-02',
        items: [],
        totals: { n: 0 },
        columns: [],
      }),
    /at least one column/,
  )
})

test('buildBusinessTableXlsxBuffer: two-column layout round-trips in ExcelJS', async () => {
  const buf = await buildBusinessTableXlsxBuffer({
    sheetTitle: 'MIN',
    fromDate: '2026-01-01',
    toDate: '2026-01-01',
    items: [{ code: 'a', n: 5 }],
    totals: { n: 5 },
    columns: [
      {
        header: 'Code',
        width: 10,
        type: 'rowText',
        getValue: (r) => r.code,
        grandTotalText: 'T',
      },
      { header: 'N', width: 8, type: 'sum', key: 'n' },
    ],
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const s = wb.getWorksheet('Report')
  assert.equal(String(s.getCell('A1').value), 'MIN')
  assert.equal(String(s.getCell('A4').value), 'Code')
  assert.equal(String(s.getCell('A5').value), 'a')
  assert.equal(Number(s.getCell('B5').value), 5)
  assert.equal(String(s.getCell('A6').value), 'T')
  assert.equal(Number(s.getCell('B6').value), 5)
})

test('getExportSheetTitleForGroup uses ECOMMERCE… titles for known groups', () => {
  assert.equal(
    getExportSheetTitleForGroup('slow_moving'),
    'ECOMMERCE SLOW MOVING SALES REPORT',
  )
  assert.equal(
    getExportSheetTitleForGroup('other_family'),
    'ECOMMERCE OTHER FAMILY SALES REPORT',
  )
})

test('buildWeeklyReportXlsxBuffer: populated report opens in ExcelJS with title + data + total', async () => {
  const items = [
    {
      family: 'ZDS',
      opening_stock: 1,
      purchase_amount: 0,
      returned_to_wholesale: 0,
      closing_stock: 2,
      sales_amount: 3,
    },
  ]
  const totals = sumReportGrandTotals(items)
  const buf = await buildWeeklyReportXlsxBuffer({
    sheetTitle: getExportSheetTitleForGroup('slow_moving'),
    fromDate: '2026-04-14',
    toDate: '2026-04-20',
    items,
    totals,
  })
  assert.ok(Buffer.isBuffer(buf))
  assert.ok(buf.length > 2000)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheet = wb.getWorksheet('Report')
  assert.ok(sheet)
  assert.equal(
    String(sheet.getCell('A1').value),
    'ECOMMERCE SLOW MOVING SALES REPORT',
  )
  // Period line uses en-GB-style labels (e.g. 14 Apr 2026), not raw YYYY-MM-DD
  const period = String(sheet.getCell('A2').value)
  assert.match(period, /Period:/i)
  assert.match(period, /14.*Apr.*2026/i)
  assert.match(period, /20.*Apr.*2026/i)
  assert.equal(String(sheet.getCell('A4').value), 'SR. NO')
  assert.equal(String(sheet.getCell('B4').value), 'FAMILY')
  assert.equal(String(sheet.getCell('B5').value), 'ZDS')
  const gt = String(sheet.getCell('B6').value)
  assert.equal(gt, 'Grand Total')
  assert.equal(Number(sheet.getCell('G5').value), 3) // Sales Amount
})

test('buildWeeklyReportXlsxBuffer: empty data still has header + zero grand total', async () => {
  const items = []
  const totals = sumReportGrandTotals(items)
  const buf = await buildWeeklyReportXlsxBuffer({
    sheetTitle: getExportSheetTitleForGroup('other_family'),
    fromDate: '2026-01-01',
    toDate: '2026-01-07',
    items,
    totals,
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheet = wb.getWorksheet('Report')
  assert.equal(String(sheet.getCell('A1').value), 'ECOMMERCE OTHER FAMILY SALES REPORT')
  assert.equal(String(sheet.getCell('B5').value), 'Grand Total')
  assert.equal(Number(sheet.getCell('C5').value), 0) // Opening Stock
})

test('buildWeeklyReportXlsxBuffer: _zoho metadata on items does not affect columns', async () => {
  const items = [
    {
      family: 'F',
      opening_stock: 0,
      purchase_amount: 0,
      returned_to_wholesale: 0,
      closing_stock: 5,
      sales_amount: 0,
      _zoho: { from_date: '2026-01-01', to_date: '2026-01-07', family: 'F' },
    },
  ]
  const buf = await buildWeeklyReportXlsxBuffer({
    sheetTitle: 'ECOMMERCE SLOW MOVING SALES REPORT',
    fromDate: '2026-01-01',
    toDate: '2026-01-07',
    items,
    totals: sumReportGrandTotals(items),
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.equal(String(wb.getWorksheet('Report').getCell('B5').value), 'F')
  assert.equal(Number(wb.getWorksheet('Report').getCell('D5').value), 5) // closing_stock
})

test('buildWeeklyReportXlsxBuffer: special characters in item name round-trip', async () => {
  const weird = 'Test "Quote" <tag> & 陶'
  const items = [
    {
      family: weird,
      opening_stock: 0,
      purchase_amount: 0,
      returned_to_wholesale: 0,
      closing_stock: 0,
      sales_amount: 0,
    },
  ]
  const buf = await buildWeeklyReportXlsxBuffer({
    sheetTitle: 'ECOMMERCE SLOW MOVING SALES REPORT',
    fromDate: '2026-01-01',
    toDate: '2026-01-01',
    items,
    totals: sumReportGrandTotals(items),
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const v = String(wb.getWorksheet('Report').getCell('B5').value)
  assert.equal(v, weird) // FAMILY cell
})

test('buildWeeklyReportXlsxBuffer: many rows are written', async () => {
  const n = 1200
  const items = Array.from({ length: n }, (_, i) => ({
    family: `F-${i}`,
    opening_stock: 1,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    closing_stock: 1,
    sales_amount: 0,
  }))
  const totals = sumReportGrandTotals(items)
  const t0 = Date.now()
  const buf = await buildWeeklyReportXlsxBuffer({
    sheetTitle: 'ECOMMERCE SLOW MOVING SALES REPORT',
    fromDate: '2026-01-01',
    toDate: '2026-01-02',
    items,
    totals,
  })
  const ms = Date.now() - t0
  assert.ok(buf.length > 15_000, 'buffer should be non-trivial for 1200 rows')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheet = wb.getWorksheet('Report')
  assert.equal(String(sheet.getCell('B5').value), 'F-0')
  assert.equal(String(sheet.getCell('B' + (5 + n - 1)).value), `F-${n - 1}`)
  if (ms > 120_000) assert.fail(`export took ${ms}ms (unreasonably slow)`)
})

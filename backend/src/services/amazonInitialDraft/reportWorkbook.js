'use strict'

/**
 * Builds the companion report workbook.
 *
 * This is a brand-new workbook, so ExcelJS is appropriate here. The prohibition on
 * ExcelJS applies only to the Amazon workbook, which it cannot load at all; nothing in
 * this file reads or writes the upload.
 */

const ExcelJS = require('exceljs')

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width || 20 }))

  const headerRow = sheet.getRow(1)
  headerRow.font = HEADER_FONT
  headerRow.fill = HEADER_FILL
  headerRow.alignment = { vertical: 'middle' }

  for (const row of rows) sheet.addRow(row)

  if (rows.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  }
  return sheet
}

function buildReportWorkbook(result, { filename, generatedAt = new Date(), catalogConnection = null } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'HR & BI — Amazon UAE Initial Draft Generator'
  workbook.created = generatedAt

  const summarySheet = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] })
  summarySheet.columns = [
    { header: 'Item', key: 'item', width: 42 },
    { header: 'Value', key: 'value', width: 78 },
  ]
  const summaryHeader = summarySheet.getRow(1)
  summaryHeader.font = HEADER_FONT
  summaryHeader.fill = HEADER_FILL

  const s = result.summary
  const summaryRows = [
    ['Status', result.notice],
    ['Source workbook', filename || s.fileName],
    ['Generated at (UTC)', generatedAt.toISOString()],
    ['Template sheet', s.sheetName],
    ['Technical header row', s.headerRow],
    ['First data row', `${s.firstDataRow} (detected from ${s.firstDataRowBasis})`],
    ['Seller SKU column', s.skuColumn],
    ['Template columns detected', s.templateColumns],
    ['Data rows in sheet', s.dataRowsInSheet],
    ['Rows containing a SKU', s.rowsWithSku],
    ['Matched SKUs', s.matched],
    ['— of which matched only by ignoring letter case', s.matchedIgnoringCase || 0],
    ['Unmatched SKUs', s.unmatched],
    ['Ambiguous SKUs (not written)', s.ambiguous],
    ['Rows with a SKU duplicated in the upload', s.duplicateSkuRows],
    ['Cells populated', s.populatedCells],
    ['Existing values preserved (identical)', s.preservedCells],
    ['Conflicts preserved (never overwritten)', s.conflictCells],
    ['Mapped cells left blank (no data)', s.missingCells],
    ['Cells left untouched (not applicable / blacked out)', s.notApplicableCells || 0],
    ['Zoho barcode → Amazon GTIN rows reviewed', s.gtinTransformationCount || 0],
    ['Website features with no template column', s.surplusListValueCount || 0],
    ['Template columns with no universal mapping', s.ignoredColumnCount],
    ['Additional attribute slots left untouched', s.additionalSlotColumnCount],
    ['Columns never written by policy', s.neverWriteColumnCount],
    ['Product subtype / product type', 'Never read, inferred, defaulted or validated. Preserved exactly as uploaded.'],
    ['Images', 'Not included. Upload product images separately.'],
    ['Price and quantity', 'Never populated.'],
    ['Brand / manufacturer', 'Written as fixed constants, not fetched from the catalog.'],
  ]

  if (catalogConnection) {
    summaryRows.push(
      ['Catalog database', `${catalogConnection.database || 'n/a'} @ ${catalogConnection.host || 'n/a'}`],
      ['Catalog access', `${catalogConnection.applicationName || ''} — read-only session`.trim()]
    )
  }

  for (const [item, value] of summaryRows) summarySheet.addRow({ item, value })
  summarySheet.getColumn('value').alignment = { wrapText: true, vertical: 'top' }

  addSheet(
    workbook,
    'Matched SKUs',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Matched on', key: 'matchSource', width: 12 },
      { header: 'Matched by', key: 'matchKind', width: 18 },
      { header: 'Catalog item code', key: 'catalogItemCode', width: 26 },
      { header: 'Product name', key: 'productName', width: 60 },
      { header: 'Populated', key: 'populated', width: 11 },
      { header: 'Preserved', key: 'preserved', width: 11 },
      { header: 'Conflicts', key: 'conflicts', width: 11 },
      { header: 'Missing', key: 'missing', width: 11 },
      { header: 'Not applicable', key: 'notApplicable', width: 14 },
      { header: 'Duplicate SKU in upload', key: 'duplicate', width: 22 },
    ],
    result.rows
      .filter((row) => row.status === 'matched')
      .map((row) => ({
        rowNumber: row.rowNumber,
        sku: row.sku,
        matchSource: row.matchSource,
        matchKind: row.matchKind === 'case-insensitive' ? 'letter case ignored' : 'exact',
        catalogItemCode: row.catalogItemCode,
        productName: row.productName,
        populated: row.counts.populated,
        preserved: row.counts.preserved,
        conflicts: row.counts.conflicts,
        missing: row.counts.missing,
        notApplicable: row.counts.notApplicable || 0,
        duplicate: row.duplicateSkuInUpload ? 'YES' : '',
      }))
  )

  addSheet(
    workbook,
    'Unmatched SKUs',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Reason', key: 'reason', width: 34 },
      { header: 'Near matches in catalog', key: 'candidates', width: 80 },
    ],
    result.rows
      .filter((row) => row.status === 'unmatched' || row.status === 'ambiguous')
      .map((row) => ({
        rowNumber: row.rowNumber,
        sku: row.sku,
        status: row.status,
        reason: row.reason,
        candidates: (row.candidates || [])
          .map((c) => `${c.matchSource} #${c.variantId || c.productId} ${c.itemCode} — ${c.productName}`)
          .join(' | '),
      }))
  )

  addSheet(
    workbook,
    'Populated fields',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 28 },
      { header: 'Technical header', key: 'technicalHeader', width: 66 },
      { header: 'Value written', key: 'value', width: 60 },
      { header: 'Source', key: 'source', width: 40 },
      { header: 'Constant', key: 'isConstant', width: 11 },
    ],
    result.populated.map((entry) => ({ ...entry, isConstant: entry.isConstant ? 'YES' : '' }))
  )

  addSheet(
    workbook,
    'Preserved conflicts',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 28 },
      { header: 'Technical header', key: 'technicalHeader', width: 66 },
      { header: 'Value kept in workbook', key: 'existingValue', width: 50 },
      { header: 'Database value (not written)', key: 'databaseValue', width: 50 },
      { header: 'Source', key: 'source', width: 40 },
    ],
    result.conflicts
  )

  addSheet(
    workbook,
    'Preserved existing values',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 28 },
      { header: 'Technical header', key: 'technicalHeader', width: 66 },
      { header: 'Existing value', key: 'existingValue', width: 50 },
      { header: 'Reason', key: 'reason', width: 26 },
    ],
    result.preservedIdentical
  )

  addSheet(
    workbook,
    'Missing database values',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 28 },
      { header: 'Technical header', key: 'technicalHeader', width: 66 },
      { header: 'Reason', key: 'reason', width: 30 },
      { header: 'Unusable stored value', key: 'rawValue', width: 54 },
    ],
    result.missingValues
  )

  addSheet(
    workbook,
    'Not applicable cells',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 28 },
      { header: 'Technical header', key: 'technicalHeader', width: 66 },
      { header: 'Why not written', key: 'reason', width: 34 },
      { header: 'Existing value kept', key: 'existingValue', width: 40 },
    ],
    result.notApplicable || []
  )

  addSheet(
    workbook,
    'Zoho barcode to GTIN',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Matched Zoho item', key: 'matchedZohoItem', width: 26 },
      { header: 'Original Zoho barcode', key: 'originalZohoBarcode', width: 22 },
      { header: 'Final Amazon GTIN', key: 'finalAmazonGtin', width: 22 },
      { header: 'Leading zero added', key: 'leadingZeroAdded', width: 18 },
      { header: 'GTIN length', key: 'gtinLength', width: 12 },
      { header: 'Check-digit status', key: 'checkDigitStatus', width: 18 },
      { header: 'Duplicate status', key: 'duplicateStatus', width: 16 },
      { header: 'Population status', key: 'populationStatus', width: 34 },
      { header: 'Warning/conflict', key: 'warningOrConflict', width: 60 },
    ],
    result.gtinTransformations || []
  )

  addSheet(
    workbook,
    'Features beyond template',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Feature', key: 'field', width: 22 },
      { header: 'Value (not written)', key: 'value', width: 100 },
      { header: 'Why', key: 'note', width: 70 },
    ],
    result.surplusListValues || []
  )

  addSheet(
    workbook,
    'Unmapped template columns',
    [
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Group', key: 'group', width: 26 },
      { header: 'Field', key: 'displayLabel', width: 34 },
      { header: 'Technical header', key: 'technicalHeader', width: 76 },
      { header: 'Note', key: 'note', width: 70 },
    ],
    [...result.ignoredColumns, ...result.additionalSlotColumns]
  )

  addSheet(
    workbook,
    'Never-written columns',
    [
      { header: 'Col', key: 'column', width: 7 },
      { header: 'Field', key: 'displayLabel', width: 34 },
      { header: 'Technical header', key: 'technicalHeader', width: 76 },
      { header: 'Policy', key: 'reason', width: 30 },
    ],
    result.neverWriteColumns
  )

  addSheet(
    workbook,
    'Report-only backend fields',
    [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'Seller SKU', key: 'sku', width: 26 },
      { header: 'Backend field', key: 'field', width: 44 },
      { header: 'Value', key: 'value', width: 90 },
      { header: 'Why it is not written', key: 'note', width: 70 },
    ],
    result.reportOnlyFields
  )

  return workbook
}

async function buildReportBuffer(result, options = {}) {
  const workbook = buildReportWorkbook(result, options)
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

module.exports = {
  buildReportBuffer,
  buildReportWorkbook,
}

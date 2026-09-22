'use strict'

const ExcelJS = require('exceljs')

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A5F' },
}
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
const THIN = { style: 'thin', color: { argb: 'FF94A3B8' } }

/**
 * @param {import('exceljs').Worksheet} sheet
 * @param {string[]} headers
 * @param {number[]} widths
 */
function styleHeader(sheet, headers, widths) {
  sheet.addRow(headers)
  const row = sheet.getRow(1)
  row.height = 22
  headers.forEach((_, i) => {
    const cell = row.getCell(i + 1)
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
  })
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  }
}

/**
 * @param {import('exceljs').Worksheet} sheet
 * @param {unknown[]} values
 */
function addDataRow(sheet, values) {
  const row = sheet.addRow(values.map((v) => (v == null ? '' : v)))
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'top', wrapText: true }
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
  })
}

/**
 * @param {object} payload
 */
async function buildKitchenExtractionWorkbook(payload) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'hr-attendance-app Amazon UAE kitchen extraction'
  workbook.created = new Date()

  const kitchenRows = payload.kitchenRows || []
  const allRows = payload.allRows || []
  const attributeRows = payload.attributeRows || []
  const variationRows = payload.variationRows || []
  const failedRows = payload.failedRows || []
  const methodology = payload.methodology || {}

  {
    const sheet = workbook.addWorksheet('Kitchen Product Types')
    styleHeader(
      sheet,
      [
        'Product Type',
        'Display Name',
        'Kitchen Section',
        'Confidence',
        'Classification Source',
        'Classification Reason',
        'Required Attribute Count',
        'Variation Supported',
        'Variation Themes',
        'Item Type Keywords',
        'Recommended Browse Nodes',
        'Schema Version',
        'Retrieval Status',
        'Retrieved At',
        'Error',
      ],
      [28, 28, 28, 12, 28, 48, 12, 12, 36, 28, 48, 28, 14, 22, 36]
    )
    for (const r of kitchenRows) {
      addDataRow(sheet, [
        r.productType,
        r.displayName,
        r.kitchenSection,
        r.confidence,
        r.classificationSource,
        r.classificationReason,
        r.requiredAttributeCount,
        r.variationSupported,
        r.variationThemes,
        r.itemTypeKeywords,
        r.recommendedBrowseNodes,
        r.schemaVersion,
        r.retrievalStatus,
        r.retrievedAt,
        r.error,
      ])
    }
  }

  {
    const sheet = workbook.addWorksheet('All UAE Product Types')
    styleHeader(
      sheet,
      [
        'Product Type',
        'Display Name',
        'Is Kitchen',
        'Kitchen Section',
        'Confidence',
        'Classification Source',
        'Classification Reason',
        'Definition Status',
      ],
      [28, 28, 12, 28, 12, 28, 48, 16]
    )
    for (const r of allRows) {
      addDataRow(sheet, [
        r.productType,
        r.displayName,
        r.isKitchen,
        r.kitchenSection,
        r.confidence,
        r.classificationSource,
        r.classificationReason,
        r.definitionStatus,
      ])
    }
  }

  {
    const sheet = workbook.addWorksheet('Required Attributes')
    styleHeader(
      sheet,
      [
        'Product Type',
        'Display Name',
        'Attribute Name',
        'Attribute Display Name',
        'Requirement Type',
        'Data Type',
        'Allowed Values',
        'Unit Values',
        'Attribute Description',
      ],
      [28, 28, 28, 28, 22, 14, 40, 24, 48]
    )
    for (const r of attributeRows) {
      addDataRow(sheet, [
        r.productType,
        r.displayName,
        r.attributeName,
        r.attributeDisplayName,
        r.requirementType,
        r.dataType,
        r.allowedValues,
        r.unitValues,
        r.attributeDescription,
      ])
    }
  }

  {
    const sheet = workbook.addWorksheet('Variation Themes')
    styleHeader(
      sheet,
      ['Product Type', 'Display Name', 'Variation Theme', 'Parent Supported', 'Child Supported'],
      [28, 28, 36, 16, 16]
    )
    for (const r of variationRows) {
      addDataRow(sheet, [
        r.productType,
        r.displayName,
        r.variationTheme,
        r.parentSupported,
        r.childSupported,
      ])
    }
  }

  {
    const sheet = workbook.addWorksheet('Failed Requests')
    styleHeader(
      sheet,
      ['Product Type', 'Request URL or operation', 'HTTP Status', 'Attempt Count', 'Error', 'Last Attempt'],
      [28, 48, 12, 12, 48, 22]
    )
    for (const r of failedRows) {
      addDataRow(sheet, [
        r.productType,
        r.request,
        r.httpStatus,
        r.attemptCount,
        r.error,
        r.lastAttempt,
      ])
    }
  }

  {
    const sheet = workbook.addWorksheet('Methodology')
    styleHeader(sheet, ['Field', 'Value'], [36, 80])
    const rows = [
      ['Marketplace', methodology.marketplace],
      ['Marketplace ID', methodology.marketplaceId],
      ['Endpoint region', methodology.endpointRegion],
      ['Base URL', methodology.baseUrl],
      ['Locale', methodology.locale],
      ['Extraction date', methodology.extractionDate],
      ['API operations used', methodology.apiOperations],
      ['Keywords parameter used', methodology.keywordsUsed],
      ['Total UAE product types', methodology.totalUaeProductTypes],
      ['Kitchen product-type count', methodology.kitchenCount],
      ['Successful definitions', methodology.successfulDefinitions],
      ['Failed definitions', methodology.failedDefinitions],
      ['Exact classifications', methodology.exactClassifications],
      ['Inferred classifications', methodology.inferredClassifications],
      ['Official category-to-product-type API mapping', methodology.officialMappingAvailable],
      ['Classification limitations', methodology.classificationLimitations],
      ['Output workbook', methodology.workbookPath],
      ['Raw product types JSON', methodology.allProductTypesJsonPath],
      ['Definitions cache directory', methodology.definitionsDir],
    ]
    for (const [field, value] of rows) {
      addDataRow(sheet, [field, value == null ? '' : value])
    }
  }

  return workbook
}

/**
 * @param {object} payload
 * @param {string} filePath
 */
async function writeKitchenExtractionWorkbook(payload, filePath) {
  const workbook = await buildKitchenExtractionWorkbook(payload)
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

module.exports = {
  buildKitchenExtractionWorkbook,
  writeKitchenExtractionWorkbook,
}

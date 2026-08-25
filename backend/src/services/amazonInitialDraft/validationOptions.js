'use strict'

/**
 * Resolves the exact dropdown values a template cell will accept.
 *
 * Amazon stores accepted options on a hidden "Dropdown Lists" sheet and points each
 * data-validation at them through a defined name. Many validations use INDIRECT keyed
 * off the product-type cell the seller already typed; this module follows that lookup
 * the way Excel would, without inventing options of its own. When the row has no product
 * type, a consensus across every product-type-prefixed name for the same attribute is
 * used only when every list agrees on the same exact strings.
 */

const opc = require('./opcPackage')
const { parseDefinedNames } = require('./cellApplicability')
const {
  columnLettersToIndex,
  parseSharedStrings,
  readSheetCells,
} = require('./worksheetXml')

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseDataValidations(sheetXml) {
  const validations = []
  if (!sheetXml) return validations

  for (const match of sheetXml.matchAll(/<dataValidation\b([^>]*)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const attrs = match[1]
    const inner = match[2] || ''
    const type = /\btype="([^"]*)"/.exec(attrs)
    const sqref = /\bsqref="([^"]*)"/.exec(attrs)
    const formula = /<formula1>([\s\S]*?)<\/formula1>/.exec(inner)
    if (!type || type[1] !== 'list' || !sqref || !formula) continue
    validations.push({
      sqref: sqref[1],
      formula: decodeXmlEntities(formula[1]),
    })
  }

  return validations
}

function sqrefCoversCell(sqref, columnIndex, rowNumber) {
  return String(sqref || '')
    .split(/\s+/)
    .some((range) => {
      const match = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(range)
      if (!match) return false
      const fromCol = columnLettersToIndex(match[1])
      const toCol = match[3] ? columnLettersToIndex(match[3]) : fromCol
      const fromRow = Number(match[2])
      const toRow = match[4] ? Number(match[4]) : fromRow
      return (
        columnIndex >= Math.min(fromCol, toCol) &&
        columnIndex <= Math.max(fromCol, toCol) &&
        rowNumber >= Math.min(fromRow, toRow) &&
        rowNumber <= Math.max(fromRow, toRow)
      )
    })
}

function parseSheetRef(formula) {
  const match = /^(?:'([^']+)'|([A-Za-z0-9_]+))!\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/.exec(
    String(formula || '').trim()
  )
  if (!match) return null
  return {
    sheetName: match[1] || match[2],
    fromCol: columnLettersToIndex(match[3]),
    fromRow: Number(match[4]),
    toCol: match[5] ? columnLettersToIndex(match[5]) : columnLettersToIndex(match[3]),
    toRow: match[6] ? Number(match[6]) : Number(match[4]),
  }
}

/**
 * Amazon's standard INDIRECT validation resolves to
 * `<sanitizedProductType><attributeSuffix>`.
 */
function resolveIndirectName(formula, productTypeValue) {
  const match = /^INDIRECT\(([\s\S]+)\)$/i.exec(String(formula || '').trim())
  if (!match) return null

  const literalMatch = /"([^"]+)"\s*$/.exec(match[1])
  if (!literalMatch) return null
  const suffix = literalMatch[1]

  const productType = String(productTypeValue || '').trim()
  if (!productType) return null

  let sanitized = productType.replace(/-/g, '_').replace(/ /g, '')
  if (/^\d/.test(sanitized)) sanitized = `_${sanitized}`
  return `${sanitized}${suffix}`
}

function loadSheetCells(pkg, partName, sharedStrings) {
  const entry = opc.findEntry(pkg, partName)
  if (!entry) return new Map()
  const xml = opc.readEntryContent(entry).toString('utf8')
  return readSheetCells(xml, sharedStrings)
}

function readRangeValues(rowsByNumber, range) {
  const values = []
  for (let row = range.fromRow; row <= range.toRow; row += 1) {
    for (let column = range.fromCol; column <= range.toCol; column += 1) {
      const cell = rowsByNumber.get(row)?.get(column)
      const text = cell ? String(cell.value || '').trim() : ''
      if (text) values.push(text)
    }
  }
  return values
}

function buildValidationContext(workbook) {
  const pkg = workbook.package
  const workbookEntry = opc.findEntry(pkg, 'xl/workbook.xml')
  const workbookXml = workbookEntry ? opc.readEntryContent(workbookEntry).toString('utf8') : ''
  const namedFormulas = parseDefinedNames(workbookXml)
  const validations = parseDataValidations(workbook.sheetXml)

  const sharedStringsEntry = opc.findEntry(pkg, 'xl/sharedStrings.xml')
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(opc.readEntryContent(sharedStringsEntry).toString('utf8'))
    : workbook.sharedStrings || []

  const sheetCellsCache = new Map()
  const getSheetCells = (sheetName) => {
    if (sheetCellsCache.has(sheetName)) return sheetCellsCache.get(sheetName)
    const sheet = workbook.sheets.find((entry) => entry.name === sheetName)
    if (!sheet) {
      sheetCellsCache.set(sheetName, null)
      return null
    }
    const cells = loadSheetCells(pkg, sheet.partName, sharedStrings)
    sheetCellsCache.set(sheetName, cells)
    return cells
  }

  const productTypeColumn = workbook.columns.find(
    (column) =>
      /(^|\.)product_type(\.|$)/i.test(column.normalizedKey) || /feed_product_type/i.test(column.normalizedKey)
  )

  return {
    namedFormulas,
    validations,
    getSheetCells,
    productTypeColumn,
    templateSheetName: workbook.sheet.name,
  }
}

function optionsFromNamedRange(context, name) {
  const formula = context.namedFormulas.get(name)
  if (!formula) return null
  if (/^(AND|OR|NOT|IF)\(/i.test(formula.trim())) return null
  const range = parseSheetRef(formula)
  if (!range) return null
  const cells = context.getSheetCells(range.sheetName)
  if (!cells) return null
  return readRangeValues(cells, range)
}

function consensusOptionsForSuffix(context, suffix) {
  if (!suffix) return null
  const lists = []
  for (const [name, formula] of context.namedFormulas) {
    if (!name.endsWith(suffix)) continue
    if (/^(form_rg|only_enf|req|Applicable|PTList)/i.test(name)) continue
    if (/^(AND|OR|NOT|IF)\(/i.test(String(formula).trim())) continue
    const options = optionsFromNamedRange(context, name)
    if (options && options.length) lists.push(options)
  }
  if (!lists.length) return null
  const first = lists[0]
  const same = lists.every(
    (list) => list.length === first.length && list.every((value, index) => value === first[index])
  )
  return same ? first : null
}

function extractIndirectSuffix(formula) {
  const match = /^INDIRECT\(([\s\S]+)\)$/i.exec(String(formula || '').trim())
  if (!match) return null
  const literalMatch = /"([^"]+)"\s*$/.exec(match[1])
  return literalMatch ? literalMatch[1] : null
}

function resolveValidationOptions(context, column, row) {
  const validation = context.validations.find((entry) =>
    sqrefCoversCell(entry.sqref, column.column, row.rowNumber)
  )
  if (!validation) {
    return { options: null, reason: 'no-list-validation', source: null }
  }

  const formula = validation.formula.trim()

  if (formula.startsWith('"') && formula.endsWith('"') && !formula.includes('INDIRECT')) {
    const inner = formula.slice(1, -1)
    return {
      options: inner
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
      reason: null,
      source: 'literal-list',
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(formula)) {
    const options = optionsFromNamedRange(context, formula)
    if (options && options.length) return { options, reason: null, source: `named:${formula}` }
    return { options: null, reason: 'named-range-empty', source: formula }
  }

  const directRange = parseSheetRef(formula)
  if (directRange) {
    const cells = context.getSheetCells(directRange.sheetName)
    if (!cells) return { options: null, reason: 'dropdown-sheet-missing', source: null }
    const options = readRangeValues(cells, directRange)
    return options.length
      ? { options, reason: null, source: 'sheet-range' }
      : { options: null, reason: 'dropdown-range-empty', source: null }
  }

  if (/^INDIRECT\(/i.test(formula)) {
    const productTypeColumn = context.productTypeColumn
    const productTypeValue = productTypeColumn
      ? String(row.cells.get(productTypeColumn.column)?.value || '').trim()
      : ''
    const resolvedName = resolveIndirectName(formula, productTypeValue)
    if (resolvedName) {
      const options = optionsFromNamedRange(context, resolvedName)
      if (options && options.length) {
        return { options, reason: null, source: `indirect:${resolvedName}` }
      }
      // The seller set a product type, but this attribute has no dropdown for it.
      // That is Amazon's signal the cell is not used for this configuration.
      return { options: null, reason: 'validation-options-unresolved', source: resolvedName }
    }

    // No product type on the row: only write when every product-type-prefixed list
    // for this attribute agrees on the same exact options.
    const suffix = extractIndirectSuffix(formula)
    const consensus = consensusOptionsForSuffix(context, suffix)
    if (consensus && consensus.length) {
      return { options: consensus, reason: null, source: 'consensus-across-product-types' }
    }

    return { options: null, reason: 'product-type-required-for-validation', source: null }
  }

  return { options: null, reason: 'unsupported-validation-formula', source: null }
}

function pickAcceptedOption(options, preferredLabels) {
  if (!options || !options.length || !preferredLabels || !preferredLabels.length) return null
  const normalizedOptions = options.map((option) => ({
    option,
    key: String(option).trim().toLowerCase(),
  }))

  for (const label of preferredLabels) {
    const key = String(label).trim().toLowerCase()
    const exact = normalizedOptions.find((entry) => entry.key === key)
    if (exact) return exact.option
  }

  for (const label of preferredLabels) {
    const key = String(label).trim().toLowerCase().replace(/fulfilment/g, 'fulfillment')
    const hits = normalizedOptions.filter((entry) => {
      const candidate = entry.key.replace(/fulfilment/g, 'fulfillment')
      return candidate.includes(key) || key.includes(candidate)
    })
    if (hits.length === 1) return hits[0].option
  }

  return null
}

module.exports = {
  buildValidationContext,
  pickAcceptedOption,
  resolveIndirectName,
  resolveValidationOptions,
  parseDataValidations,
  sqrefCoversCell,
}

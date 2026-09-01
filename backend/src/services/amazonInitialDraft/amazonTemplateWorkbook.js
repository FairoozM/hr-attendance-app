'use strict'

/**
 * Structural reader for an uploaded Amazon flat-file template.
 *
 * Everything here is derived from the workbook that arrived at runtime. There is no
 * product-type or subtype dimension anywhere in this module: the sheet is found by
 * looking for a technical-header row that declares a SKU column, and the columns are
 * whatever that row happens to contain. A template for a different subtype parses
 * identically.
 */

const opc = require('./opcPackage')
const {
  columnIndexToLetters,
  parseCellReference,
  parseSharedStrings,
  readSheetCells,
} = require('./worksheetXml')

const WORKBOOK_PART = 'xl/workbook.xml'
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels'
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml'

/** Rows scanned when probing a sheet for its technical-header row. */
const HEADER_PROBE_ROWS = 30

/**
 * Technical headers are machine names: no spaces, optional `[qualifier=value]` groups,
 * an optional `#N` occurrence index and an optional dotted field path.
 */
const TECHNICAL_HEADER_SHAPE = /^(?:::)?[a-z][a-z0-9_]*(?:\[[a-z0-9_]+=[^\]]*\])*(?:#\d+)?(?:\.[a-z0-9_]+)*$/i

/**
 * Normalised keys that identify the seller-SKU column across Amazon template generations.
 * A bare `sku` is deliberately absent: it collides with the human-readable label row.
 */
const SKU_HEADER_KEYS = new Set([
  'contribution_sku.value',
  'contribution_sku',
  'item_sku.value',
  'item_sku',
  'seller_sku.value',
  'seller_sku',
])

/**
 * Strips marketplace/language qualifiers and occurrence indexes, keeping the attribute
 * name and its dotted field path. Matching on this rather than the literal header keeps
 * the mapping stable when Amazon changes a marketplace id, language tag or index.
 *
 *   item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.length.unit
 *     -> item_package_dimensions.length.unit
 */
function normalizeTechnicalHeader(header) {
  return String(header || '')
    .trim()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#\d+/g, '')
    .toLowerCase()
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const relationships = new Map()
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attributes = match[1]
    const id = /\bId="([^"]*)"/.exec(attributes)
    const target = /\bTarget="([^"]*)"/.exec(attributes)
    const type = /\bType="([^"]*)"/.exec(attributes)
    if (id && target && type && /\/worksheet$/.test(type[1])) {
      const normalized = target[1].replace(/^\/?xl\//, '').replace(/^\//, '')
      relationships.set(id[1], `xl/${normalized}`)
    }
  }

  const sheets = []
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/>/g)) {
    const attributes = match[1]
    const name = /\bname="([^"]*)"/.exec(attributes)
    const relationshipId = /\br:id="([^"]*)"/.exec(attributes)
    const state = /\bstate="([^"]*)"/.exec(attributes)
    if (!name || !relationshipId) continue
    const partName = relationships.get(relationshipId[1])
    if (!partName) continue
    sheets.push({
      name: name[1],
      state: state ? state[1] : 'visible',
      relationshipId: relationshipId[1],
      partName,
    })
  }
  return sheets
}

/** `<pane ySplit="7" topLeftCell="A8"/>` — in Amazon's own templates this is the header block. */
function readFrozenTopLeftRow(sheetXml) {
  const pane = /<pane\b([^>]*?)\/>/.exec(sheetXml)
  if (!pane) return null
  if (!/\bstate="frozen"/.test(pane[1])) return null
  const topLeft = /\btopLeftCell="([^"]*)"/.exec(pane[1])
  if (!topLeft) return null
  const reference = parseCellReference(topLeft[1])
  return reference ? reference.row : null
}

/**
 * Picks the technical-header row: the row with the most machine-name cells that also
 * declares a SKU column. Density plus the SKU column, never a subtype column.
 */
function detectHeaderRow(rowsByNumber) {
  let best = null

  for (const [rowNumber, cells] of rowsByNumber) {
    let technicalCount = 0
    let skuColumn = null

    for (const cell of cells.values()) {
      const value = String(cell.value || '').trim()
      if (!value || /\s/.test(value)) continue
      if (!TECHNICAL_HEADER_SHAPE.test(value)) continue
      technicalCount += 1
      const normalized = normalizeTechnicalHeader(value)
      if (skuColumn === null && SKU_HEADER_KEYS.has(normalized)) skuColumn = cell.column
    }

    if (skuColumn === null || technicalCount < 3) continue
    if (!best || technicalCount > best.technicalCount) {
      best = { rowNumber, technicalCount, skuColumn }
    }
  }

  return best
}

/**
 * Builds the column table from the detected header row, carrying forward the sparse
 * group labels above it so the report can say where a column lives in Amazon's layout.
 */
function buildColumns(rowsByNumber, headerRowNumber) {
  const headerCells = rowsByNumber.get(headerRowNumber) || new Map()
  const labelCells = rowsByNumber.get(headerRowNumber - 1) || new Map()
  const groupCells = rowsByNumber.get(headerRowNumber - 2) || new Map()

  const maxColumn = Math.max(0, ...[...headerCells.keys()])
  const columns = []
  let currentGroup = ''

  for (let column = 1; column <= maxColumn; column += 1) {
    const groupCell = groupCells.get(column)
    if (groupCell && String(groupCell.value || '').trim()) currentGroup = String(groupCell.value).trim()

    const headerCell = headerCells.get(column)
    const technicalHeader = headerCell ? String(headerCell.value || '').trim() : ''
    if (!technicalHeader) continue

    const labelCell = labelCells.get(column)
    columns.push({
      column,
      letters: columnIndexToLetters(column),
      technicalHeader,
      normalizedKey: normalizeTechnicalHeader(technicalHeader),
      displayLabel: labelCell ? String(labelCell.value || '').trim() : '',
      groupLabel: currentGroup,
    })
  }

  return columns
}

/**
 * Finds the first data row structurally.
 *
 * This deliberately errs towards treating a row as data. Skipping a genuine seller row
 * would silently drop their SKU, whereas keeping Amazon's example row costs nothing worse
 * than one reported unmatched SKU. So only rows that can be identified structurally are
 * skipped:
 *
 *   - a banner row: one populated cell holding a sentence rather than a SKU
 *   - a row whose SKU cell carries a different style from the sheet's data rows, which
 *     is how Amazon distinguishes its example row from the rows you fill in
 */
function scanFirstDataRow(rowsByNumber, headerRowNumber, skuColumn) {
  const candidates = [...rowsByNumber.keys()].filter((rowNumber) => rowNumber > headerRowNumber).sort((a, b) => a - b)
  if (!candidates.length) return { firstDataRow: headerRowNumber + 1, basis: 'no-rows-below-header' }

  const skuCellStyle = (rowNumber) => {
    const cell = (rowsByNumber.get(rowNumber) || new Map()).get(skuColumn)
    return cell && cell.style !== null && cell.style !== undefined ? String(cell.style) : ''
  }

  // The style shared by most rows below the header is the data-row style; annotation
  // rows are few and styled differently.
  const styleCounts = new Map()
  for (const rowNumber of candidates) {
    const style = skuCellStyle(rowNumber)
    styleCounts.set(style, (styleCounts.get(style) || 0) + 1)
  }
  const [dataStyle] = [...styleCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const isBannerRow = (rowNumber) => {
    const cells = rowsByNumber.get(rowNumber) || new Map()
    const populated = [...cells.values()].filter((cell) => String(cell.value || '').trim() !== '')
    if (populated.length !== 1) return false
    const text = String(populated[0].value || '').trim()
    return text.length > 40 && /\s/.test(text)
  }

  let firstDataRow = candidates[0]
  for (const rowNumber of candidates) {
    if (isBannerRow(rowNumber) || skuCellStyle(rowNumber) !== dataStyle) {
      firstDataRow = rowNumber + 1
      continue
    }
    firstDataRow = rowNumber
    break
  }

  return { firstDataRow, basis: 'annotation-scan' }
}

/**
 * Finds the first data row.
 *
 * Amazon declares the end of its header block with a frozen pane, so that wins whenever
 * it agrees with the sheet. It is only a declaration about the *header*, though: a seller
 * can freeze the pane anywhere while working, and a pane sitting below their listings
 * would otherwise discard every row above it — no images, no attributes, silently.
 *
 * So the pane never moves the start row past a row that carries a SKU.
 */
function detectFirstDataRow(sheetXml, rowsByNumber, headerRowNumber, skuColumn) {
  const scan = scanFirstDataRow(rowsByNumber, headerRowNumber, skuColumn)
  const frozenRow = readFrozenTopLeftRow(sheetXml)
  if (!frozenRow || frozenRow <= headerRowNumber) return scan

  const skuAt = (rowNumber) => {
    const cell = (rowsByNumber.get(rowNumber) || new Map()).get(skuColumn)
    return cell ? String(cell.value || '').trim() : ''
  }

  if (scan.firstDataRow < frozenRow && skuAt(scan.firstDataRow)) {
    return { firstDataRow: scan.firstDataRow, basis: 'sku-rows-above-frozen-pane' }
  }
  return { firstDataRow: frozenRow, basis: 'frozen-pane' }
}

/**
 * Opens an uploaded workbook and returns its structure. The package is kept so the
 * draft can be produced by patching these exact bytes.
 */
function openTemplateWorkbook(buffer) {
  let pkg
  try {
    pkg = opc.readPackage(buffer)
  } catch (err) {
    // A package that will not parse is a problem with the upload, not with the server.
    throw invalidUpload(err.message)
  }

  const workbookEntry = opc.findEntry(pkg, WORKBOOK_PART)
  const relsEntry = opc.findEntry(pkg, WORKBOOK_RELS_PART)
  if (!workbookEntry || !relsEntry) {
    throw invalidUpload('The file is not a valid Excel workbook (missing workbook part).')
  }

  const workbookXml = opc.readEntryContent(workbookEntry).toString('utf8')
  const relsXml = opc.readEntryContent(relsEntry).toString('utf8')
  const sheets = parseWorkbookSheets(workbookXml, relsXml)
  if (!sheets.length) throw invalidUpload('The workbook contains no worksheets.')

  const sharedStringsEntry = opc.findEntry(pkg, SHARED_STRINGS_PART)
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(opc.readEntryContent(sharedStringsEntry).toString('utf8'))
    : []

  const candidates = [...sheets].sort((a, b) => {
    const visibility = (a.state === 'visible' ? 0 : 1) - (b.state === 'visible' ? 0 : 1)
    return visibility
  })

  let resolved = null
  for (const sheet of candidates) {
    const entry = opc.findEntry(pkg, sheet.partName)
    if (!entry) continue
    const sheetXml = opc.readEntryContent(entry).toString('utf8')
    const probeRows = readSheetCells(sheetXml, sharedStrings, { maxRow: HEADER_PROBE_ROWS })
    const header = detectHeaderRow(probeRows)
    if (!header) continue
    if (!resolved || header.technicalCount > resolved.header.technicalCount) {
      resolved = { sheet, sheetXml, header }
    }
  }

  if (!resolved) {
    throw invalidUpload(
      'No Amazon template sheet found. The workbook has no technical-header row declaring a SKU column.'
    )
  }

  const { sheet, sheetXml, header } = resolved
  const allRows = readSheetCells(sheetXml, sharedStrings)
  const columns = buildColumns(allRows, header.rowNumber)
  const skuColumn = header.skuColumn
  const { firstDataRow, basis } = detectFirstDataRow(sheetXml, allRows, header.rowNumber, skuColumn)

  const dataRows = []
  for (const [rowNumber, cells] of [...allRows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber < firstDataRow) continue
    const skuCell = cells.get(skuColumn)
    dataRows.push({
      rowNumber,
      sku: skuCell ? String(skuCell.value || '').trim() : '',
      cells,
    })
  }

  return {
    package: pkg,
    sharedStrings,
    sheet,
    sheetXml,
    sheets,
    headerRow: header.rowNumber,
    firstDataRow,
    firstDataRowBasis: basis,
    skuColumn,
    skuColumnLetters: columnIndexToLetters(skuColumn),
    columns,
    dataRows,
  }
}

function invalidUpload(message) {
  const error = new Error(message)
  error.code = 'INVALID_TEMPLATE'
  return error
}

module.exports = {
  HEADER_PROBE_ROWS,
  SKU_HEADER_KEYS,
  TECHNICAL_HEADER_SHAPE,
  buildColumns,
  detectFirstDataRow,
  detectHeaderRow,
  normalizeTechnicalHeader,
  openTemplateWorkbook,
  parseWorkbookSheets,
  readFrozenTopLeftRow,
}

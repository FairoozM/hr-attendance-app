'use strict'

/**
 * Surgical reader/writer for a single SpreadsheetML worksheet part.
 *
 * Cells are edited by rewriting only the `<c>` elements that are actually populated,
 * leaving the rest of the part — validations, conditional formatting, merges, panes,
 * extension lists, and every attribute of every untouched row and cell — as the bytes
 * that arrived in the upload. Values are written as numbers or inline strings so
 * `xl/sharedStrings.xml` is never modified and shared-string indexes cannot drift.
 */

const CELL_PATTERN = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
const ROW_OPEN_PATTERN = /<row\b([^>]*?)(\/>|>)/g

function columnLettersToIndex(letters) {
  let index = 0
  const upper = String(letters).toUpperCase()
  for (let i = 0; i < upper.length; i += 1) {
    index = index * 26 + (upper.charCodeAt(i) - 64)
  }
  return index
}

function columnIndexToLetters(index) {
  let remaining = Number(index)
  let letters = ''
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26
    letters = String.fromCharCode(65 + modulo) + letters
    remaining = Math.floor((remaining - modulo) / 26)
  }
  return letters
}

function parseCellReference(ref) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(String(ref || ''))
  if (!match) return null
  return { column: columnLettersToIndex(match[1]), row: Number(match[2]) }
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeXmlText(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
}

function readAttribute(attributes, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)
  return match ? match[1] : null
}

/** Concatenates the text of every `<t>` run, which is how Excel stores rich text. */
function collectTextRuns(xml) {
  const parts = []
  const pattern = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g
  let match = pattern.exec(xml)
  while (match) {
    parts.push(decodeXmlText(match[1] || ''))
    match = pattern.exec(xml)
  }
  return parts.join('')
}

/** Shared strings as a positional array; `<si>` order is the index space. */
function parseSharedStrings(xml) {
  if (!xml) return []
  const strings = []
  const pattern = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g
  let match = pattern.exec(xml)
  while (match) {
    strings.push(collectTextRuns(match[1] || ''))
    match = pattern.exec(xml)
  }
  return strings
}

function cellValue(attributes, inner, sharedStrings) {
  const type = readAttribute(attributes, 't')

  if (type === 'inlineStr') return collectTextRuns(inner || '')
  if (type === 'e') {
    const errorMatch = /<v>([\s\S]*?)<\/v>/.exec(inner || '')
    return errorMatch ? decodeXmlText(errorMatch[1]) : ''
  }

  const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(inner || '')
  if (!valueMatch) return ''
  const raw = decodeXmlText(valueMatch[1])

  if (type === 's') {
    const index = Number(raw)
    return Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : ''
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  return raw
}

/**
 * Reads the populated cells of a worksheet into `Map<rowNumber, Map<columnIndex, cell>>`.
 * Only cells present in the XML appear; absent cells are simply blank.
 *
 * `maxRow` keeps header probing cheap on sheets such as `Dropdown Lists`, which hold
 * six figures of cells that this feature never needs to look at.
 */
function readSheetCells(sheetXml, sharedStrings = [], { maxRow = Infinity } = {}) {
  const rows = new Map()
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g

  let rowMatch = rowPattern.exec(sheetXml)
  while (rowMatch) {
    const rowNumber = Number(readAttribute(rowMatch[1], 'r'))
    const inner = rowMatch[2] || ''
    if (Number.isInteger(rowNumber) && rowNumber > maxRow) {
      rowMatch = rowPattern.exec(sheetXml)
      continue
    }
    if (Number.isInteger(rowNumber) && rowNumber > 0) {
      const cells = new Map()
      CELL_PATTERN.lastIndex = 0
      let cellMatch = CELL_PATTERN.exec(inner)
      while (cellMatch) {
        const attributes = cellMatch[1]
        const cellInner = cellMatch[3] || ''
        const reference = parseCellReference(readAttribute(attributes, 'r'))
        if (reference) {
          cells.set(reference.column, {
            reference: readAttribute(attributes, 'r'),
            column: reference.column,
            row: reference.row,
            type: readAttribute(attributes, 't'),
            style: readAttribute(attributes, 's'),
            hasFormula: /<f\b/.test(cellInner),
            value: cellValue(attributes, cellInner, sharedStrings),
          })
        }
        cellMatch = CELL_PATTERN.exec(inner)
      }
      rows.set(rowNumber, cells)
    }
    rowMatch = rowPattern.exec(sheetXml)
  }

  return rows
}

function buildCellXml({ reference, style, value, numeric }) {
  const styleAttribute = style === null || style === undefined ? '' : ` s="${style}"`
  if (numeric) {
    return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`
  }
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`
}

function splitRowCells(inner) {
  const cells = []
  CELL_PATTERN.lastIndex = 0
  let match = CELL_PATTERN.exec(inner)
  while (match) {
    const reference = parseCellReference(readAttribute(match[1], 'r'))
    cells.push({
      raw: match[0],
      attributes: match[1],
      column: reference ? reference.column : Number.MAX_SAFE_INTEGER,
      style: readAttribute(match[1], 's'),
      hasFormula: /<f\b/.test(match[3] || ''),
    })
    match = CELL_PATTERN.exec(inner)
  }
  return cells
}

/** Widens `spans="a:b"` so it still covers every cell the row now holds. */
function widenSpans(attributes, columns) {
  const spans = readAttribute(attributes, 'spans')
  if (!spans) return attributes
  const [from, to] = spans.split(':').map(Number)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return attributes
  const low = Math.min(from, ...columns)
  const high = Math.max(to, ...columns)
  if (low === from && high === to) return attributes
  return attributes.replace(/\bspans="[^"]*"/, `spans="${low}:${high}"`)
}

function widenDimension(sheetXml, maxRow, maxColumn) {
  return sheetXml.replace(/<dimension ref="([^"]+)"\s*\/>/, (whole, ref) => {
    const [start, end] = ref.split(':')
    const from = parseCellReference(start)
    const to = parseCellReference(end || start)
    if (!from || !to) return whole
    const row = Math.max(to.row, maxRow)
    const column = Math.max(to.column, maxColumn)
    if (row === to.row && column === to.column) return whole
    return `<dimension ref="${start}:${columnIndexToLetters(column)}${row}"/>`
  })
}

/**
 * Applies cell writes to a worksheet part.
 *
 * @param {string} sheetXml the worksheet part as it arrived in the upload
 * @param {Array<{row:number,column:number,value:string,numeric?:boolean}>} writes
 * @returns {{xml: string, written: Array, skipped: Array}}
 */
function applyCellWrites(sheetXml, writes) {
  if (!writes.length) return { xml: sheetXml, written: [], skipped: [] }

  const byRow = new Map()
  for (const write of writes) {
    if (!byRow.has(write.row)) byRow.set(write.row, [])
    byRow.get(write.row).push(write)
  }

  const written = []
  const skipped = []
  let xml = sheetXml

  for (const [rowNumber, rowWrites] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const rowPattern = new RegExp(`<row\\b([^>]*?\\br="${rowNumber}"[^>]*?)(?:/>|>([\\s\\S]*?)</row>)`)
    const rowMatch = rowPattern.exec(xml)
    if (!rowMatch) {
      for (const write of rowWrites) skipped.push({ ...write, reason: 'row-missing' })
      continue
    }

    const attributes = rowMatch[1]
    const inner = rowMatch[2] || ''
    const cells = splitRowCells(inner)
    const byColumn = new Map(cells.map((cell) => [cell.column, cell]))

    for (const write of rowWrites.sort((a, b) => a.column - b.column)) {
      const reference = `${columnIndexToLetters(write.column)}${rowNumber}`
      const existing = byColumn.get(write.column)

      if (existing && existing.hasFormula) {
        skipped.push({ ...write, reason: 'formula-cell' })
        continue
      }

      const replacement = {
        raw: buildCellXml({
          reference,
          style: existing ? existing.style : null,
          value: write.value,
          numeric: Boolean(write.numeric),
        }),
        column: write.column,
        attributes: existing ? existing.attributes : '',
        style: existing ? existing.style : null,
        hasFormula: false,
      }
      byColumn.set(write.column, replacement)
      written.push({ ...write, reference })
    }

    const rebuiltInner = [...byColumn.values()].sort((a, b) => a.column - b.column).map((cell) => cell.raw).join('')
    const rebuiltAttributes = widenSpans(attributes, [...byColumn.keys()])
    xml = xml.slice(0, rowMatch.index) + `<row${rebuiltAttributes}>${rebuiltInner}</row>` + xml.slice(rowMatch.index + rowMatch[0].length)
  }

  if (written.length) {
    xml = widenDimension(
      xml,
      Math.max(...written.map((write) => write.row)),
      Math.max(...written.map((write) => write.column))
    )
  }

  return { xml, written, skipped }
}

module.exports = {
  ROW_OPEN_PATTERN,
  applyCellWrites,
  columnIndexToLetters,
  columnLettersToIndex,
  decodeXmlText,
  escapeXmlText,
  parseCellReference,
  parseSharedStrings,
  readSheetCells,
}

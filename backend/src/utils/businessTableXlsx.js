/**
 * Reusable Excel (ExcelJS) "business table" layout: title band, period, spacer,
 * bordered header + data + grand total, zebra, freeze pane.
 * Pass a column schema so new report types only define headers + how each row is filled.
 *
 * @example
 * buildBusinessTableXlsxBuffer({
 *   sheetTitle: '…',
 *   fromDate, toDate,
 *   items, totals,
 *   columns: [
 *     { header: 'SR. NO', width: 7.5, type: 'index' },
 *     { header: 'ITEM', width: 40, type: 'rowText', getValue, grandTotalText: 'Grand Total' },
 *     { header: 'Qty', width: 12, type: 'sum', key: 'qty' },
 *   ],
 * })
 */

const ExcelJS = require('exceljs')

/**
 * Run `tasks` (array of zero-arg async functions) with at most `limit` running at once.
 * Returns results in the same order as `tasks`.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} limit
 * @returns {Promise<any[]>}
 */
async function promiseConcurrent(tasks, limit) {
  if (!tasks.length) return []
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      // eslint-disable-next-line no-await-in-loop
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

const THIN = { style: 'thin', color: { argb: 'FF7F7F7F' } }
const MEDIUM = { style: 'medium', color: { argb: 'FF4A5568' } }

const FILL_TITLE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
const FILL_DATE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E0' } }
const FILL_GT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2F7' } }
const FILL_ZEBRA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFCFE' } }

const DEFAULT_NUM_FMT = '#,##0.##;[Red]-#,##0.##'
const FROZEN_TITLE_ROWS = 4 // title, date, spacer, header

const HEADER_ROW = 4
const dataStart = () => HEADER_ROW + 1

/** 1 → A, 26 → Z, 27 → AA (for merge range strings) */
function colLetter1Based(n) {
  let s = ''
  let c = n
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

/**
 * "14 Apr 2026" in en-GB for the period line
 * @param {string} iso YYYY-MM-DD
 * @returns {string}
 */
function formatDateLabel(iso) {
  const d = new Date(`${iso}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function applyTableBorders(sheet, fromRow, toRow, fromCol, toCol) {
  for (let r = fromRow; r <= toRow; r += 1) {
    const row = sheet.getRow(r)
    for (let c = fromCol; c <= toCol; c += 1) {
      const cell = row.getCell(c)
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    }
  }
}

function applyGrandTotalTopBorder(sheet, grandTotalRow, fromCol, toCol) {
  for (let c = fromCol; c <= toCol; c += 1) {
    const cell = sheet.getRow(grandTotalRow).getCell(c)
    cell.border = { ...cell.border, top: MEDIUM }
  }
}

/**
 * @typedef {object} BusinessTableColumn
 * @property {string} header
 * @property {number} width
 * @property {'index'|'rowText'|'sum'|'image'} type
 * @property {string} [key]  — for `sum`, field on each item and on `totals`
 * @property {string} [numFmt] — for `sum`, default numeric pattern
 * @property {(row: object, index: number) => unknown} [getValue] — for `rowText` data cell
 * @property {string} [grandTotalText] — for `rowText` / `image`, label in the total row
 */

/**
 * @param {object} p
 * @param {string} p.sheetTitle
 * @param {string} p.fromDate YYYY-MM-DD
 * @param {string} p.toDate YYYY-MM-DD
 * @param {string} [p.periodLabel]  — overrides default "Period: …" line
 * @param {string} [p.worksheetName] default Report
 * @param {string} [p.workbookCreator] default HR Attendance
 * @param {object[]} p.items
 * @param {object} p.totals — one numeric field per `sum` column
 * @param {BusinessTableColumn[]} p.columns
 * @param {(item: object, i: number) => Promise<null|{ buffer: Buffer, extension: 'png'|'jpeg'|'gif' }>} [p.fetchImageForItem] — for `type: 'image'`; omit to leave "—" only
 * @returns {Promise<Buffer>}
 */
async function buildBusinessTableXlsxBuffer(p) {
  const {
    sheetTitle,
    fromDate,
    toDate,
    periodLabel,
    items,
    totals,
    columns: rawColumns,
    worksheetName = 'Report',
    workbookCreator = 'HR Attendance',
    fetchImageForItem,
  } = p
  if (!rawColumns || rawColumns.length === 0) {
    throw new Error('buildBusinessTableXlsxBuffer: at least one column is required')
  }
  const columns = rawColumns.map((c) => {
    if (!c || !c.header) throw new Error('buildBusinessTableXlsxBuffer: every column must have a header')
    if (!c.type) throw new Error('buildBusinessTableXlsxBuffer: every column must have a type')
    if (c.type === 'sum' && (c.key == null || c.key === '')) {
      throw new Error('buildBusinessTableXlsxBuffer: sum columns need a `key`')
    }
    if (c.type === 'rowText' && typeof c.getValue !== 'function') {
      throw new Error('buildBusinessTableXlsxBuffer: rowText columns need getValue(item, i)')
    }
    if (c.type === 'rowText' && (c.grandTotalText == null || c.grandTotalText === '')) {
      throw new Error('buildBusinessTableXlsxBuffer: rowText columns need grandTotalText for the total row')
    }
    if (c.type === 'image' && (c.grandTotalText == null || c.grandTotalText === '')) {
      throw new Error('buildBusinessTableXlsxBuffer: image columns need grandTotalText for the total row')
    }
    return c
  })

  const hasImageCol = columns.some((c) => c.type === 'image')
  let imagePayloads = null
  if (hasImageCol) {
    if (typeof fetchImageForItem === 'function' && items.length) {
      // Limit concurrency to avoid overwhelming the upstream API (Zoho) with dozens of
      // simultaneous requests, which causes timeouts and missing images.
      const IMAGE_FETCH_CONCURRENCY = 5
      imagePayloads = await promiseConcurrent(
        items.map((item, i) => () =>
          fetchImageForItem(item, i).catch(() => {
            // eslint-disable-next-line no-console
            console.warn('[businessTableXlsx] fetchImageForItem failed for row', i)
            return null
          })
        ),
        IMAGE_FETCH_CONCURRENCY
      )
    } else {
      imagePayloads = items.map(() => null)
    }
  } else {
    imagePayloads = null
  }

  const lastC = columns.length
  const range1 = `A1:${colLetter1Based(lastC)}1`
  const range2 = `A2:${colLetter1Based(lastC)}2`
  const fFrom = formatDateLabel(fromDate)
  const fTo = formatDateLabel(toDate)
  const period = periodLabel ?? `Period: ${fFrom}   to   ${fTo}`

  const imageCol0 = columns.findIndex((c) => c.type === 'image')
  const hasImageRowHeight = imageCol0 >= 0
  const IMAGE_W = 56
  const IMAGE_H = 56
  const imageRowPointHeight = 52

  const wb = new ExcelJS.Workbook()
  wb.creator = workbookCreator
  const ws = wb.addWorksheet(worksheetName, { properties: { defaultRowHeight: 20 } })

  for (let c = 0; c < columns.length; c += 1) {
    ws.getColumn(c + 1).width = columns[c].width
  }

  // Title + period (merged)
  ws.mergeCells(range1)
  const t1 = ws.getCell(1, 1)
  t1.value = sheetTitle
  t1.fill = FILL_TITLE
  t1.font = { bold: true, size: 16, name: 'Calibri' }
  t1.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 42

  ws.mergeCells(range2)
  const t2 = ws.getCell(2, 1)
  t2.value = period
  t2.fill = FILL_DATE
  t2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } }
  t2.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(2).height = 26

  ws.getRow(3).height = 6

  // Header row
  const hRow = ws.getRow(HEADER_ROW)
  for (let c = 0; c < columns.length; c += 1) {
    const cell = hRow.getCell(c + 1)
    cell.value = columns[c].header
    cell.fill = FILL_HEADER
    cell.font = { bold: true, name: 'Calibri', size: 11, color: { argb: 'FF1E293B' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }
  hRow.height = 32

  const dataRowStart = dataStart()
  const dataFont = { name: 'Calibri', size: 11 }
  const dataFontLabel = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1E293B' } }
  const dataFontNumberGT = { name: 'Calibri', size: 12, bold: true }

  // Data rows
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const r = dataRowStart + i
    const row = ws.getRow(r)
    row.height = hasImageRowHeight ? imageRowPointHeight : 20
    const zebra = i % 2 === 1
    for (let col = 1; col <= lastC; col += 1) {
      if (zebra) row.getCell(col).fill = FILL_ZEBRA
    }

    for (let c = 0; c < columns.length; c += 1) {
      const def = columns[c]
      const cell = row.getCell(c + 1)
      if (def.type === 'index') {
        cell.value = i + 1
        cell.font = { ...dataFont }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else if (def.type === 'rowText') {
        cell.value = def.getValue(item, i)
        cell.font = { ...dataFont }
        cell.alignment = { horizontal: 'left', vertical: 'middle' }
      } else if (def.type === 'image') {
        const pl = imagePayloads && imagePayloads[i]
        if (pl && pl.buffer) {
          cell.value = null
        } else {
          cell.value = '—'
        }
        cell.font = { ...dataFont }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else if (def.type === 'sum') {
        const nfmt = def.numFmt ?? DEFAULT_NUM_FMT
        const v = item[def.key]
        if (v == null) {
          cell.value = '—'
          cell.font = { ...dataFont }
        } else {
          cell.value = v
          cell.numFmt = nfmt
          cell.font = { ...dataFont }
        }
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
    }
  }

  // Grand total row
  const gtRowIdx = dataRowStart + items.length
  const gRow = ws.getRow(gtRowIdx)
  gRow.height = 24

  for (let c = 0; c < columns.length; c += 1) {
    const def = columns[c]
    const cell = gRow.getCell(c + 1)
    cell.fill = FILL_GT
    if (def.type === 'index') {
      cell.value = ''
      cell.font = { bold: true, name: 'Calibri' }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    } else if (def.type === 'rowText') {
      cell.value = def.grandTotalText
      cell.font = dataFontLabel
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
    } else if (def.type === 'image') {
      cell.value = def.grandTotalText
      cell.font = dataFontLabel
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    } else if (def.type === 'sum') {
      const nfmt = def.numFmt ?? DEFAULT_NUM_FMT
      const tv = totals[def.key]
      if (tv == null) {
        cell.value = '—'
        cell.font = { ...dataFontNumberGT, name: 'Calibri' }
      } else {
        cell.value = tv
        cell.numFmt = nfmt
        cell.font = { ...dataFontNumberGT, name: 'Calibri' }
      }
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
  }

  applyTableBorders(ws, HEADER_ROW, gtRowIdx, 1, lastC)
  applyGrandTotalTopBorder(ws, gtRowIdx, 1, lastC)

  if (imageCol0 >= 0 && imagePayloads) {
    for (let i = 0; i < items.length; i += 1) {
      const payload = imagePayloads[i]
      if (!payload || !payload.buffer) continue
      const extRaw = payload.extension != null ? String(payload.extension).toLowerCase() : 'jpeg'
      const ext = extRaw === 'png' || extRaw === 'gif' || extRaw === 'jpeg' ? extRaw : 'jpeg'
      const r = dataRowStart + i
      let imageId
      try {
        imageId = wb.addImage({ buffer: payload.buffer, extension: ext })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[businessTableXlsx] addImage', err && err.message)
        continue
      }
      ws.addImage(imageId, {
        tl: { col: imageCol0, row: r - 1 },
        ext: { width: IMAGE_W, height: IMAGE_H },
      })
    }
  }

  for (let c = 1; c <= lastC; c += 1) {
    const isL = c === 1
    const isR = c === lastC
    const a = ws.getRow(1).getCell(c)
    a.border = { ...a.border, top: MEDIUM, bottom: THIN, left: isL ? MEDIUM : undefined, right: isR ? MEDIUM : undefined }
    const b = ws.getRow(2).getCell(c)
    b.border = { ...b.border, top: THIN, bottom: MEDIUM, left: isL ? MEDIUM : undefined, right: isR ? MEDIUM : undefined }
  }

  ws.views = [{ state: 'frozen', ySplit: FROZEN_TITLE_ROWS, xSplit: 0 }]

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

module.exports = {
  buildBusinessTableXlsxBuffer,
  formatDateLabel,
  FROZEN_TITLE_ROWS,
  HEADER_ROW,
  /** @internal for tests that assert on layout row numbers */
  getDataStartRow: dataStart,
}

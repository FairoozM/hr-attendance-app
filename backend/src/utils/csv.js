/**
 * Tiny RFC-4180-ish CSV parser used by the item-report-groups bulk importer.
 *
 * Why hand-rolled instead of `csv-parse` or `papaparse`?
 *   The admin import payload is small (typically <1k rows) and adding a new
 *   runtime dependency for one feature isn't worth it. This implementation
 *   covers the subset of CSV we actually need:
 *
 *     - UTF-8 BOM stripping
 *     - LF, CR, and CRLF line endings
 *     - Quoted fields with embedded commas, newlines, and "" escapes
 *     - Trailing empty cells preserved
 *     - Unterminated quotes throw a parse error pointing at the line number
 *
 * Returns: { headers: string[], rows: string[][], totalLines: number }
 *
 * Notes:
 *   - All cells are returned as raw strings (no value coercion). Header names
 *     are returned as-is — case-folding / aliasing is the caller's job.
 *   - `rows` entries are normalised to `headers.length` cells. Extra cells in
 *     a row become a `parseError` on the result; missing trailing cells are
 *     padded with ''.
 */

const BOM = '\uFEFF'

class CsvParseError extends Error {
  constructor(message, line) {
    super(`${message} (line ${line})`)
    this.name = 'CsvParseError'
    this.line = line
    this.code = 'CSV_PARSE_ERROR'
  }
}

/**
 * Parse a CSV string into headers + rows.
 * @param {string} input
 * @param {object} [opts]
 * @param {string} [opts.delimiter=',']
 */
function parseCsv(input, opts = {}) {
  const delim = opts.delimiter || ','
  if (typeof input !== 'string') {
    throw new CsvParseError('CSV input must be a string', 0)
  }
  let src = input
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)
  // Normalise CRLF + lone CR to LF for simpler scanning.
  src = src.replace(/\r\n?/g, '\n')
  // Trim trailing newline so the parser doesn't emit a phantom empty row.
  if (src.endsWith('\n')) src = src.slice(0, -1)

  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  let line = 1

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ }
        else { inQuotes = false }
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      // A quote that's not at the start of an unquoted field is illegal in
      // strict RFC, but we tolerate it by treating it as opening a quoted
      // section as long as the cell so far is empty/whitespace.
      if (cell.replace(/\s+/g, '') === '') { inQuotes = true; cell = '' }
      else { cell += ch }
      continue
    }
    if (ch === delim) { row.push(cell); cell = ''; continue }
    if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; line++; continue }
    cell += ch
  }
  if (inQuotes) {
    throw new CsvParseError('Unterminated quoted field', line)
  }
  // Push the last (possibly empty) row.
  row.push(cell)
  rows.push(row)

  // Drop fully blank rows (e.g. blank line at end-of-file or between rows).
  const isBlank = (r) => r.length === 0 || (r.length === 1 && r[0] === '')
  while (rows.length && isBlank(rows[rows.length - 1])) rows.pop()

  if (rows.length === 0) {
    throw new CsvParseError('CSV is empty', 1)
  }

  const headers = rows.shift().map((h) => h.trim())
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new CsvParseError('Header row is empty', 1)
  }

  // Detect duplicate headers — silent collisions would be confusing.
  const seen = new Set()
  for (const h of headers) {
    const k = h.toLowerCase()
    if (k && seen.has(k)) {
      throw new CsvParseError(`Duplicate header column: "${h}"`, 1)
    }
    seen.add(k)
  }

  // Pad / trim rows to header length, preserving original cell strings.
  const normalised = rows.map((r, idx) => {
    if (isBlank(r)) return null
    if (r.length < headers.length) {
      while (r.length < headers.length) r.push('')
    } else if (r.length > headers.length) {
      const tail = r.slice(headers.length).filter((c) => c !== '')
      if (tail.length > 0) {
        // Caller decides whether to treat this as a per-row error or fatal.
        r._extraCells = tail.length
      }
      r.length = headers.length
    }
    return r
  }).filter(Boolean)

  return { headers, rows: normalised, totalLines: rows.length + 1 }
}

/**
 * Convenience: build a `Map<lowercaseHeader, columnIndex>` so the controller
 * can look up cells by canonical name.
 */
function indexHeaders(headers) {
  const map = new Map()
  headers.forEach((h, i) => { map.set(String(h).trim().toLowerCase(), i) })
  return map
}

/** Get a cell by lowercase header name. Returns '' if column doesn't exist. */
function cellOf(row, headerIdx, name) {
  const i = headerIdx.get(name)
  if (i == null) return ''
  return (row[i] ?? '').trim()
}

module.exports = { parseCsv, indexHeaders, cellOf, CsvParseError, BOM }

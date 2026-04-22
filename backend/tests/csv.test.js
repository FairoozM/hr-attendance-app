/**
 * Unit tests for backend/src/utils/csv.js
 *
 * The parser is intentionally tiny — these tests cover the surface that the
 * bulk-import controller actually relies on (BOM, quoted fields, escapes,
 * line endings, padding, duplicate headers).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseCsv, indexHeaders, cellOf, CsvParseError } = require('../src/utils/csv')

test('csv: parses a simple header + rows table', () => {
  const r = parseCsv('a,b,c\n1,2,3\n4,5,6')
  assert.deepEqual(r.headers, ['a', 'b', 'c'])
  assert.deepEqual(r.rows, [['1', '2', '3'], ['4', '5', '6']])
})

test('csv: handles UTF-8 BOM at the start of input', () => {
  const r = parseCsv('\uFEFFa,b\n1,2')
  assert.deepEqual(r.headers, ['a', 'b'])
  assert.deepEqual(r.rows, [['1', '2']])
})

test('csv: normalises CRLF and lone CR line endings to LF', () => {
  const r = parseCsv('a,b\r\n1,2\r\n3,4')
  assert.deepEqual(r.rows, [['1', '2'], ['3', '4']])
  const r2 = parseCsv('a,b\r1,2\r3,4')
  assert.deepEqual(r2.rows, [['1', '2'], ['3', '4']])
})

test('csv: supports quoted fields with embedded commas, newlines, and "" escapes', () => {
  const r = parseCsv(
    'a,b,c\n' +
    '"hello, world","line\n2","he said ""hi"""'
  )
  assert.deepEqual(r.rows[0], ['hello, world', 'line\n2', 'he said "hi"'])
})

test('csv: preserves trailing empty cells (pads short rows to header length)', () => {
  const r = parseCsv('a,b,c,d\n1,2\n5,6,7,8')
  assert.deepEqual(r.rows[0], ['1', '2', '', ''])
  assert.deepEqual(r.rows[1], ['5', '6', '7', '8'])
})

test('csv: marks rows with extra cells via _extraCells (non-fatal)', () => {
  const r = parseCsv('a,b\n1,2,3,4')
  assert.equal(r.rows[0].length, 2)
  assert.equal(r.rows[0][0], '1')
  assert.equal(r.rows[0][1], '2')
  assert.equal(r.rows[0]._extraCells, 2)
})

test('csv: rejects unterminated quoted fields', () => {
  assert.throws(() => parseCsv('a,b\n"oops,hello'), CsvParseError)
})

test('csv: rejects empty input and header-only with errors that mention the line', () => {
  assert.throws(() => parseCsv(''), /CSV is empty/)
  assert.throws(() => parseCsv(',,,'), /Header row is empty/)
})

test('csv: rejects duplicate header columns (case-insensitive)', () => {
  assert.throws(() => parseCsv('Foo,foo\n1,2'), /Duplicate header column/)
})

test('csv: indexHeaders + cellOf provide name-based lookups', () => {
  const r = parseCsv('Report_Group,SKU,Item_Name\nslow_moving,FL-001,FL Shine')
  const idx = indexHeaders(r.headers)
  assert.equal(cellOf(r.rows[0], idx, 'sku'), 'FL-001')
  assert.equal(cellOf(r.rows[0], idx, 'item_name'), 'FL Shine')
  assert.equal(cellOf(r.rows[0], idx, 'missing'), '')
})

test('csv: drops fully blank lines at end-of-file', () => {
  const r = parseCsv('a,b\n1,2\n\n\n')
  assert.equal(r.rows.length, 1)
})

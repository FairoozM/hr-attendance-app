'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const opc = require('../src/services/amazonInitialDraft/opcPackage')
const { buildTemplateWorkbook, UAE_HEADERS } = require('./helpers/amazonTemplateFixture')

function fixture() {
  return buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
}

describe('opcPackage — byte-preserving OPC reader/writer', () => {
  it('round-trips a package byte-for-byte when nothing is replaced', () => {
    const { buffer } = fixture()
    const rebuilt = opc.writePackage(opc.readPackage(buffer))
    assert.equal(Buffer.compare(buffer, rebuilt), 0)
  })

  it('reads back every entry with the stored CRC and uncompressed size', () => {
    const { buffer } = fixture()
    const pkg = opc.readPackage(buffer)
    assert.ok(pkg.entries.length >= 8)
    for (const entry of pkg.entries) {
      const content = opc.readEntryContent(entry)
      assert.equal(opc.crc32(content), entry.crc32, `CRC mismatch for ${entry.name}`)
      assert.equal(content.length, entry.uncompressedSize, `size mismatch for ${entry.name}`)
    }
  })

  it('leaves every other part byte-identical when one part is replaced', () => {
    const { buffer, templatePartName } = fixture()
    const pkg = opc.readPackage(buffer)
    const original = opc.readEntryContent(opc.findEntry(pkg, templatePartName)).toString('utf8')
    const patched = Buffer.from(original.replace('<sheetData>', '<sheetData><!--patched-->'), 'utf8')

    const output = opc.writePackage(pkg, new Map([[templatePartName, patched]]))
    const after = opc.readPackage(output)

    assert.deepEqual(
      after.entries.map((entry) => entry.name),
      pkg.entries.map((entry) => entry.name),
      'entry order must be preserved'
    )

    const changed = []
    for (const entry of pkg.entries) {
      const other = opc.findEntry(after, entry.name)
      if (Buffer.compare(opc.readEntryContent(entry), opc.readEntryContent(other)) !== 0) changed.push(entry.name)
    }
    assert.deepEqual(changed, [templatePartName])
  })

  it('preserves the macro binary exactly, including its stored (uncompressed) method', () => {
    const { buffer, templatePartName, vbaProject } = fixture()
    const pkg = opc.readPackage(buffer)
    const vbaBefore = opc.findEntry(pkg, 'xl/vbaProject.bin')
    assert.equal(vbaBefore.method, opc.METHOD_STORE)

    const sheet = opc.readEntryContent(opc.findEntry(pkg, templatePartName))
    const output = opc.writePackage(pkg, new Map([[templatePartName, sheet]]))

    const vbaAfter = opc.findEntry(opc.readPackage(output), 'xl/vbaProject.bin')
    assert.equal(vbaAfter.method, opc.METHOD_STORE)
    assert.equal(vbaAfter.crc32, vbaBefore.crc32)
    assert.equal(Buffer.compare(opc.readEntryContent(vbaAfter), vbaProject), 0)
  })

  it('does not mutate the input buffer', () => {
    const { buffer, templatePartName } = fixture()
    const snapshot = Buffer.from(buffer)
    const pkg = opc.readPackage(buffer)
    opc.writePackage(pkg, new Map([[templatePartName, Buffer.from('<worksheet/>', 'utf8')]]))
    assert.equal(Buffer.compare(buffer, snapshot), 0)
  })

  it('refuses to replace a part that is not in the upload', () => {
    const { buffer } = fixture()
    const pkg = opc.readPackage(buffer)
    assert.throws(
      () => opc.writePackage(pkg, new Map([['xl/worksheets/sheet99.xml', Buffer.from('x')]])),
      /not present in the upload/
    )
  })

  it('rejects a file that is not an OPC package', () => {
    assert.throws(() => opc.readPackage(Buffer.from('this is not a zip file at all')), /not a valid workbook package/i)
    assert.throws(() => opc.readPackage(Buffer.alloc(0)), /empty or truncated/i)
  })
})

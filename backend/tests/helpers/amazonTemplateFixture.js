'use strict'

/**
 * Builds a small Amazon-shaped .xlsm package for tests.
 *
 * The zip writer here is written independently of `opcPackage.js` on purpose: the
 * preservation tests are only meaningful if the bytes under test were not produced by
 * the same code that reads them back.
 */

const zlib = require('zlib')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

/** @param {Array<{name:string,content:Buffer|string,store?:boolean}>} files */
function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8')
    const method = file.store ? 0 : 8
    const data = method === 0 ? raw : zlib.deflateRawSync(raw)
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0x6000, 10)
    local.writeUInt16LE(0x5a21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0x6000, 12)
    central.writeUInt16LE(0x5a21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, eocd])
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function columnLettersToIndex(letters) {
  let index = 0
  for (const character of letters.toUpperCase()) index = index * 26 + (character.charCodeAt(0) - 64)
  return index
}

/**
 * @param {object} options
 * @param {Record<string,string>} options.technicalHeaders  column letter -> technical header
 * @param {Record<string,string>} [options.displayLabels]
 * @param {Record<string,string>} [options.groupLabels]
 * @param {Record<string,string>} [options.exampleRow]      Amazon's example values
 * @param {string} [options.bannerRow]                      preference-profile notice
 * @param {Record<number,Record<string,string>>} [options.dataRows]
 * @param {string|null} [options.pane]                      frozen topLeftCell, e.g. 'A8'
 * @param {number} [options.blankDataRows]                  styled-but-empty rows to append
 * @param {Array} [options.extraParts]                      additional zip entries
 */
function buildTemplateWorkbook(options) {
  const {
    technicalHeaders,
    displayLabels = {},
    groupLabels = {},
    exampleRow = {},
    bannerRow = "      \u2705 We've prefilled attributes from your selected Preference Profiles",
    dataRows = {},
    pane = 'A8',
    blankDataRows = 6,
    extraParts = [],
  } = options

  const strings = []
  const stringIndex = new Map()
  const internString = (value) => {
    const text = String(value)
    if (!stringIndex.has(text)) {
      stringIndex.set(text, strings.length)
      strings.push(text)
    }
    return stringIndex.get(text)
  }

  const rowSpecs = new Map()
  const putRow = (rowNumber, cells) => {
    if (!rowSpecs.has(rowNumber)) rowSpecs.set(rowNumber, new Map())
    const target = rowSpecs.get(rowNumber)
    for (const [letters, value] of Object.entries(cells)) {
      if (value === undefined || value === null || value === '') continue
      target.set(columnLettersToIndex(letters), { letters, value })
    }
  }

  putRow(1, { A: 'settings=feedType=256&timestamp=2026-01-01' })
  putRow(2, { A: '     Use ENGLISH to fill this template. DO NOT modify or delete the column headings.' })
  putRow(3, groupLabels)
  putRow(4, displayLabels)
  putRow(5, technicalHeaders)
  putRow(6, exampleRow)
  if (bannerRow) putRow(7, { A: bannerRow })
  for (const [rowNumber, cells] of Object.entries(dataRows)) putRow(Number(rowNumber), cells)

  const firstBlank = 8 + Object.keys(dataRows).length
  for (let i = 0; i < blankDataRows; i += 1) {
    const rowNumber = firstBlank + i
    if (!rowSpecs.has(rowNumber)) rowSpecs.set(rowNumber, new Map())
  }

  const maxColumn = Math.max(...Object.keys(technicalHeaders).map(columnLettersToIndex))
  const maxRow = Math.max(...rowSpecs.keys())

  // Mirrors the real template, which styles its instruction, header, example and banner
  // rows differently from the rows the seller fills in.
  const styleForRow = (rowNumber) => {
    if (rowNumber <= 2) return 40
    if (rowNumber <= 5) return 41
    if (rowNumber === 6) return 42
    if (rowNumber === 7 && bannerRow) return 95
    return 104
  }

  const rowXml = [...rowSpecs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, cells]) => {
      const style = styleForRow(rowNumber)
      const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0])
      const inner = sorted.length
        ? sorted
            .map(
              ([, cell]) =>
                `<c r="${cell.letters}${rowNumber}" s="${style}" t="s"><v>${internString(cell.value)}</v></c>`
            )
            .join('')
        : `<c r="A${rowNumber}" s="${style}"/>`
      return `<row r="${rowNumber}" spans="1:${maxColumn}" x14ac:dyDescent="0.2">${inner}</row>`
    })
    .join('')

  const paneXml = pane
    ? `<pane ySplit="${Number(pane.replace(/[A-Z]/g, '')) - 1}" topLeftCell="${pane}" activePane="bottomLeft" state="frozen"/>`
    : ''

  const lastColumn = (() => {
    let remaining = maxColumn
    let letters = ''
    while (remaining > 0) {
      const modulo = (remaining - 1) % 26
      letters = String.fromCharCode(65 + modulo) + letters
      remaining = Math.floor((remaining - modulo) / 26)
    }
    return letters
  })()

  // Whole-column validation and conditional formatting, mirroring the real template.
  const templateSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
    `<dimension ref="A1:${lastColumn}${maxRow}"/>` +
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0">${paneXml}</sheetView></sheetViews>` +
    `<cols><col min="1" max="${maxColumn}" width="18" style="3" customWidth="1"/></cols>` +
    `<sheetData>${rowXml}</sheetData>` +
    `<mergeCells count="1"><mergeCell ref="A2:${lastColumn}2"/></mergeCells>` +
    `<conditionalFormatting sqref="A8:${lastColumn}1048576"><cfRule type="expression" dxfId="0" priority="1"><formula>LEN(A8)&gt;0</formula></cfRule></conditionalFormatting>` +
    `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" sqref="B8:B1048576"><formula1>INDIRECT("ptlist")</formula1></dataValidation></dataValidations>` +
    `</worksheet>`

  const hiddenSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>COOKWARE_SET</t></is></c></row></sheetData></worksheet>`

  const sharedStrings =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('') +
    `</sst>`

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    `<sheet name="Template" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Dropdown Lists" sheetId="2" state="hidden" r:id="rId2"/>` +
    `</sheets>` +
    `<definedNames>` +
    `<definedName name="ptlist">'Dropdown Lists'!$A$1:$A$1</definedName>` +
    `<definedName name="COOKWARE_SETmaterial">'Dropdown Lists'!$A$1:$A$1</definedName>` +
    `</definedNames>` +
    `</workbook>`

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>` +
    `</Relationships>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>` +
    `</Types>`

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  // A stand-in macro blob, stored uncompressed so the "stored entry" path is covered.
  const vbaProject = Buffer.from('MOCK-VBA-PROJECT-BINARY-\u0000\u0001\u0002\u00ff-END', 'binary')

  return {
    buffer: buildZip([
      { name: '[Content_Types].xml', content: contentTypes },
      { name: '_rels/.rels', content: rootRels },
      { name: 'xl/workbook.xml', content: workbook },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
      { name: 'xl/worksheets/sheet1.xml', content: templateSheet },
      { name: 'xl/worksheets/sheet2.xml', content: hiddenSheet },
      { name: 'xl/sharedStrings.xml', content: sharedStrings },
      { name: 'xl/vbaProject.bin', content: vbaProject, store: true },
      ...extraParts,
    ]),
    templatePartName: 'xl/worksheets/sheet1.xml',
    vbaProject,
  }
}

/** The real UAE marketplace-qualified header set, trimmed to the mapped columns. */
const UAE_HEADERS = {
  A: 'contribution_sku#1.value',
  B: 'product_type#1.value',
  C: '::record_action',
  D: 'parentage_level[marketplace_id=A2VIGQ35RCS4UG]#1.value',
  E: 'child_parent_sku_relationship[marketplace_id=A2VIGQ35RCS4UG]#1.parent_sku',
  F: 'variation_theme#1.name',
  G: 'item_name[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  H: 'main_product_image_locator#1.media_location',
  I: 'brand[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  J: 'manufacturer[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  K: 'product_description[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  L: 'color[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  M: 'size[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  N: 'material[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  O: 'warranty_description[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  P: 'warranty_description[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#2.value',
  Q: 'item_package_weight[marketplace_id=A2VIGQ35RCS4UG]#1.value',
  R: 'item_package_weight[marketplace_id=A2VIGQ35RCS4UG]#1.unit',
  S: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.length.value',
  T: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.length.unit',
  U: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.width.value',
  V: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.width.unit',
  W: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.height.value',
  X: 'item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.height.unit',
  Y: 'purchasable_offer[marketplace_id=A2VIGQ35RCS4UG]#1.our_price#1.schedule#1.value_with_tax',
  Z: 'fulfillment_availability#1.quantity',
  AA: 'capacity[marketplace_id=A2VIGQ35RCS4UG]#1.value',
  AB: 'capacity[marketplace_id=A2VIGQ35RCS4UG]#1.unit',
  AC: 'number_of_items[marketplace_id=A2VIGQ35RCS4UG]#1.value',
  // A numbered run, as in the real template, where bullet_point occupies AE–AI.
  AD: 'bullet_point[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value',
  AE: 'bullet_point[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#2.value',
  AF: 'bullet_point[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#3.value',
}

/** The bullet-point columns the fixture template exposes, in order. */
const UAE_BULLET_COLUMNS = ['AD', 'AE', 'AF']

const UAE_LABELS = {
  A: 'SKU',
  B: 'Product Type',
  C: 'Listing Action',
  D: 'Parentage Level',
  E: 'Parent SKU',
  F: 'Variation Theme Name',
  G: 'Item Name',
  H: 'Main Image URL',
  I: 'Brand Name',
  J: 'Manufacturer',
  K: 'Product Description',
  L: 'Color',
  M: 'Size',
  N: 'Material',
  O: 'Warranty Description',
  P: 'Warranty Description',
  Q: 'Package Weight',
  R: 'Package Weight Unit',
  S: 'Item Package Length',
  T: 'Package Length Unit',
  U: 'Item Package Width',
  V: 'Package Width Unit',
  W: 'Item Package Height',
  X: 'Package Height Unit',
  Y: 'Your Price',
  Z: 'Quantity',
  AA: 'Capacity',
  AB: 'Capacity Unit',
  AC: 'Number of Items',
  AD: 'Bullet Point',
  AE: 'Bullet Point',
  AF: 'Bullet Point',
}

const UAE_EXAMPLE = {
  A: 'ABC123',
  B: 'ACCESSORY',
  C: '(Default) Create or Replace',
  D: 'Parent',
  E: 'ABC123',
  F: 'Size/Color',
  G: 'Adidas Blue Sneakers',
  I: 'Adidas',
  Q: '1.5',
  R: 'Kilograms',
}

module.exports = {
  UAE_BULLET_COLUMNS,
  UAE_EXAMPLE,
  UAE_HEADERS,
  UAE_LABELS,
  buildTemplateWorkbook,
  buildZip,
  columnLettersToIndex,
  crc32,
}

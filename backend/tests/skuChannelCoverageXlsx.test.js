const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const {
  buildSkuChannelCoverageXlsxBuffer,
  rowToExportObject,
} = require('../src/services/skuChannelCoverageXlsxService')

describe('skuChannelCoverageXlsx', () => {
  it('rowToExportObject maps booleans to Yes/No labels', () => {
    const row = rowToExportObject({
      zohoItemId: '1',
      zohoItemName: 'Widget',
      zohoSku: 'W-1',
      normalizedZohoKey: 'W-1',
      amazonUaeMatched: true,
      amazonKsaMatched: false,
      amazonMatchedAny: true,
      noonMatched: false,
      amazonUaeSku: 'W-1',
      amazonKsaSku: null,
      noonSku: null,
      amazonUaeStatus: 'ACTIVE',
      amazonKsaStatus: null,
      noonStatus: null,
      coverageStatus: 'AMAZON_ONLY',
    })
    assert.equal(row.amazonUaeMatched, 'Yes')
    assert.equal(row.amazonKsaMatched, 'No')
    assert.equal(row.noonMatched, 'No')
  })

  it('buildSkuChannelCoverageXlsxBuffer creates five worksheets', async () => {
    const rows = [
      {
        zohoItemId: '1',
        zohoItemName: 'On Amazon',
        zohoSku: 'A-1',
        normalizedZohoKey: 'A-1',
        amazonUaeMatched: true,
        amazonKsaMatched: false,
        amazonMatchedAny: true,
        noonMatched: false,
        amazonUaeSku: 'A-1',
        amazonKsaSku: null,
        noonSku: null,
        amazonUaeStatus: 'ACTIVE',
        amazonKsaStatus: null,
        noonStatus: null,
        coverageStatus: 'AMAZON_ONLY',
      },
      {
        zohoItemId: '2',
        zohoItemName: 'Missing all',
        zohoSku: 'Z-9',
        normalizedZohoKey: 'Z-9',
        amazonUaeMatched: false,
        amazonKsaMatched: false,
        amazonMatchedAny: false,
        noonMatched: false,
        amazonUaeSku: null,
        amazonKsaSku: null,
        noonSku: null,
        amazonUaeStatus: null,
        amazonKsaStatus: null,
        noonStatus: null,
        coverageStatus: 'MISSING_ALL_CHANNELS',
      },
    ]
    const summary = {
      totalActiveZohoItems: 2,
      matchedAmazonUae: 1,
      matchedAmazonKsa: 0,
      matchedAmazonAny: 1,
      matchedNoon: 0,
      missingAmazon: 1,
      missingNoon: 2,
      missingAllChannels: 1,
    }
    const buffer = await buildSkuChannelCoverageXlsxBuffer({
      rows,
      summary,
      meta: { generatedAt: '2026-06-05T12:00:00.000Z', noonSource: 'live' },
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const names = wb.worksheets.map((s) => s.name)
    assert.deepEqual(names, [
      'Full Coverage Report',
      'Missing Amazon',
      'Missing Noon',
      'Missing All Channels',
      'Summary',
    ])
    const missingAmazon = wb.getWorksheet('Missing Amazon')
    assert.ok(missingAmazon)
    assert.ok(missingAmazon.rowCount >= 4)
  })
})

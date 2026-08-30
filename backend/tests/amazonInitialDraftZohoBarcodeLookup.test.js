'use strict'

/**
 * Life Smile's Zoho items hold the barcode in the SKU field and the seller SKU in the item
 * name, with upc/ean/isbn/part_number empty throughout. These tests pin that mapping, and
 * pin the property that keeps the preview endpoint inside CloudFront's 30s origin timeout:
 * one database query for the whole upload, and no Zoho API call at all.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { mockModule, freshRequire } = require('./_helpers')

const LOOKUP_PATH = '../src/services/amazonInitialDraft/zohoBarcodeLookup'

/** A row as `findItemsByNames` returns it: name is the seller SKU, sku is the barcode. */
function cachedRow({ name, sku, itemId = `id-${name}` }) {
  return { name, sku, item_id: itemId }
}

function loadLookup({ rows = [], findItemsByNames = null } = {}) {
  const calls = { findItemsByNames: [], fetchItemById: [] }

  const restoreStore = mockModule('../src/services/zohoBulkInvoiceStore', {
    findItemsByNames:
      findItemsByNames ||
      (async (names) => {
        calls.findItemsByNames.push(names)
        return rows
      }),
  })

  // Any live Zoho call is a regression: the barcode is already in the item cache.
  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchItemById: async (itemId) => {
      calls.fetchItemById.push(itemId)
      return null
    },
  })

  const lookup = freshRequire(LOOKUP_PATH)
  return {
    lookup,
    calls,
    restore() {
      restoreStore()
      restoreClient()
    },
  }
}

test('amazon initial draft — zoho barcode lookup', async (t) => {
  await t.test('reads the barcode from the Zoho SKU field, matched on the Zoho item name', async () => {
    const ctx = loadLookup({
      rows: [
        cachedRow({ name: 'LIFEP17S-6-2-BEIGE', sku: '6294021012386' }),
        cachedRow({ name: 'P2SAU-18-GRAY', sku: '6294021011570' }),
      ],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus([
        'LIFEP17S-6-2-BEIGE',
        'P2SAU-18-GRAY',
        'LIFEP17S-6-2-BEIGE',
      ])

      assert.equal(ctx.calls.findItemsByNames.length, 1)
      assert.deepEqual(ctx.calls.findItemsByNames[0], ['LIFEP17S-6-2-BEIGE', 'P2SAU-18-GRAY'])
      assert.equal(ctx.calls.fetchItemById.length, 0)

      assert.equal(map.get('LIFEP17S-6-2-BEIGE').status, 'found')
      assert.equal(map.get('LIFEP17S-6-2-BEIGE').barcode, '6294021012386')
      assert.equal(map.get('LIFEP17S-6-2-BEIGE').zohoItemName, 'LIFEP17S-6-2-BEIGE')
      assert.equal(map.get('P2SAU-18-GRAY').barcode, '6294021011570')
    } finally {
      ctx.restore()
    }
  })

  await t.test('does not match the seller SKU against the Zoho SKU field', async () => {
    // The seller SKU is never the barcode, so a numeric-SKU collision must not resolve.
    const ctx = loadLookup({ rows: [cachedRow({ name: 'LIFEP22-10SILVER', sku: '6294021008389' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['6294021008389'])

      assert.equal(map.get('6294021008389').status, 'not-found')
      assert.equal(map.get('6294021008389').reason, 'zoho-item-name-not-found')
    } finally {
      ctx.restore()
    }
  })

  await t.test('matches an item name that differs only in casing, keyed by the workbook SKU', async () => {
    const ctx = loadLookup({ rows: [cachedRow({ name: 'lifep22-10silver', sku: '6294021008389' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LIFEP22-10SILVER'])

      assert.equal(map.get('LIFEP22-10SILVER').status, 'found')
      assert.equal(map.get('LIFEP22-10SILVER').barcode, '6294021008389')
      assert.equal(map.get('LIFEP22-10SILVER').zohoItemName, 'lifep22-10silver')
    } finally {
      ctx.restore()
    }
  })

  await t.test('does not match a seller SKU that differs by more than casing', async () => {
    const ctx = loadLookup({
      rows: [
        cachedRow({ name: 'LIFEP22-10SILVER-XL', sku: '6294021008389' }),
        cachedRow({ name: 'LIFEP2210SILVER', sku: '6294021008390' }),
      ],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LIFEP22-10SILVER'])

      assert.equal(map.get('LIFEP22-10SILVER').status, 'not-found')
      assert.equal(map.get('LIFEP22-10SILVER').reason, 'zoho-item-name-not-found')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports two Zoho items sharing one item name as ambiguous', async () => {
    const ctx = loadLookup({
      rows: [
        cachedRow({ name: 'LIFEP22-10SILVER', sku: '6294021008389', itemId: 'a' }),
        cachedRow({ name: 'LIFEP22-10SILVER', sku: '6294021008390', itemId: 'b' }),
      ],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LIFEP22-10SILVER'])

      assert.equal(map.get('LIFEP22-10SILVER').status, 'ambiguous')
      assert.equal(map.get('LIFEP22-10SILVER').barcode, '')
    } finally {
      ctx.restore()
    }
  })

  await t.test('passes a placeholder Zoho SKU through for the transform to reject', async () => {
    // 137 items carry 12-digit internal codes such as 829402100456. The lookup reports
    // them verbatim; leaving the cell blank is the transform step's decision.
    const ctx = loadLookup({ rows: [cachedRow({ name: 'AC36528', sku: '829402100456' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['AC36528'])

      assert.equal(map.get('AC36528').status, 'found')
      assert.equal(map.get('AC36528').barcode, '829402100456')
    } finally {
      ctx.restore()
    }
  })

  await t.test('prefers a real barcode field over the SKU field when one is populated', async () => {
    const ctx = loadLookup({})
    try {
      const { extractBarcodeText } = ctx.lookup
      assert.equal(extractBarcodeText({ upc: ' 6294021012386 ', sku: '999' }), '6294021012386')
      assert.equal(extractBarcodeText({ ean: '6294021012386', sku: '999' }), '6294021012386')
      assert.equal(extractBarcodeText({ upc: '', ean: '', sku: '6294021012386' }), '6294021012386')
      assert.equal(extractBarcodeText({ raw_json: { sku: '6294021012386' } }), '6294021012386')
      assert.equal(extractBarcodeText({ sku: '' }), '')
      assert.equal(extractBarcodeText(null), '')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports a blank Zoho SKU as a missing barcode', async () => {
    const ctx = loadLookup({ rows: [cachedRow({ name: 'LIFEP22-10SILVER', sku: '' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LIFEP22-10SILVER'])

      assert.equal(map.get('LIFEP22-10SILVER').status, 'not-found')
      assert.equal(map.get('LIFEP22-10SILVER').reason, 'zoho-barcode-blank')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports every SKU as errored when the cache query fails', async () => {
    const ctx = loadLookup({
      findItemsByNames: async () => {
        throw new Error('db down')
      },
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LIFEP22-10SILVER', 'P2SAU-18-GRAY'])

      assert.equal(map.get('LIFEP22-10SILVER').status, 'error')
      assert.equal(map.get('LIFEP22-10SILVER').reason, 'db down')
      assert.equal(map.get('P2SAU-18-GRAY').status, 'error')
    } finally {
      ctx.restore()
    }
  })
})

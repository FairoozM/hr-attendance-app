'use strict'

/**
 * The Initial Draft Generator resolves Zoho barcodes inside one HTTP request that sits
 * behind a 30s CloudFront origin timeout, while Zoho's rate limiter can park a single call
 * for 15s. These tests pin the properties that keep the endpoint from timing out: one
 * database query for the whole SKU set, no live Zoho call when the cache already has a
 * barcode, and a hard cap plus wall-clock budget on the calls that do happen.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { mockModule, freshRequire } = require('./_helpers')

const LOOKUP_PATH = '../src/services/amazonInitialDraft/zohoBarcodeLookup'

function cachedRow({ sku, itemId = `id-${sku}`, upc = null, raw = null }) {
  return {
    sku,
    item_id: itemId,
    raw_json: raw || (upc ? { upc } : {}),
  }
}

/**
 * Loads the lookup module with both external dependencies stubbed, and records how they
 * were called so the tests can assert on call counts.
 */
function loadLookup({ rows = [], details = {}, findItemsBySkus = null, detailDelayMs = 0 } = {}) {
  const calls = { findItemsBySkus: [], fetchItemById: [] }

  const restoreStore = mockModule('../src/services/zohoBulkInvoiceStore', {
    findItemsBySkus:
      findItemsBySkus ||
      (async (skus) => {
        calls.findItemsBySkus.push(skus)
        return rows
      }),
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchItemById: async (itemId) => {
      calls.fetchItemById.push(itemId)
      if (detailDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, detailDelayMs).unref()
        })
      }
      return details[itemId] || null
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
  await t.test('resolves the whole SKU set with one cache query and no Zoho API calls', async () => {
    const ctx = loadLookup({
      rows: [
        cachedRow({ sku: 'LS-POT-24', upc: '6294015161236' }),
        cachedRow({ sku: 'LS-POT-28', upc: '6294015161243' }),
      ],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24', 'LS-POT-28', 'LS-POT-24'])

      assert.equal(ctx.calls.findItemsBySkus.length, 1)
      assert.deepEqual(ctx.calls.findItemsBySkus[0], ['LS-POT-24', 'LS-POT-28'])
      assert.equal(ctx.calls.fetchItemById.length, 0)

      assert.equal(map.get('LS-POT-24').status, 'found')
      assert.equal(map.get('LS-POT-24').barcode, '6294015161236')
      assert.equal(map.get('LS-POT-28').barcode, '6294015161243')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports an unknown SKU as not cached without calling Zoho', async () => {
    const ctx = loadLookup({ rows: [cachedRow({ sku: 'LS-POT-24', upc: '6294015161236' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-MISSING'])

      assert.equal(map.get('LS-MISSING').status, 'not-found')
      assert.equal(map.get('LS-MISSING').reason, 'zoho-sku-not-in-cache')
      assert.equal(ctx.calls.fetchItemById.length, 0)
    } finally {
      ctx.restore()
    }
  })

  await t.test('matches a cached SKU that differs only in casing, keyed by the workbook SKU', async () => {
    const ctx = loadLookup({ rows: [cachedRow({ sku: 'ls-pot-24', upc: '6294015161236' })] })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'])

      assert.equal(map.get('LS-POT-24').status, 'found')
      assert.equal(map.get('LS-POT-24').barcode, '6294015161236')
      assert.equal(map.get('LS-POT-24').zohoSku, 'ls-pot-24')
      assert.equal(ctx.calls.fetchItemById.length, 0)
    } finally {
      ctx.restore()
    }
  })

  await t.test('does not match a SKU that differs by more than casing', async () => {
    const ctx = loadLookup({
      rows: [cachedRow({ sku: 'LS-POT-24-RED', upc: '6294015161236' }), cachedRow({ sku: 'LSPOT24', upc: '6294015161243' })],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'])

      assert.equal(map.get('LS-POT-24').status, 'not-found')
      assert.equal(map.get('LS-POT-24').reason, 'zoho-sku-not-in-cache')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports duplicate cached rows for one SKU as ambiguous', async () => {
    const ctx = loadLookup({
      rows: [
        cachedRow({ sku: 'LS-POT-24', itemId: 'a', upc: '6294015161236' }),
        cachedRow({ sku: 'LS-POT-24', itemId: 'b', upc: '6294015161243' }),
      ],
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'])

      assert.equal(map.get('LS-POT-24').status, 'ambiguous')
      assert.equal(map.get('LS-POT-24').barcode, '')
      assert.equal(ctx.calls.fetchItemById.length, 0)
    } finally {
      ctx.restore()
    }
  })

  await t.test('falls back to one item-detail call when the cached row has no barcode', async () => {
    const ctx = loadLookup({
      rows: [cachedRow({ sku: 'LS-POT-24', itemId: 'id-1' })],
      details: { 'id-1': { sku: 'LS-POT-24', item_id: 'id-1', upc: '6294015161236' } },
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'])

      assert.deepEqual(ctx.calls.fetchItemById, ['id-1'])
      assert.equal(map.get('LS-POT-24').status, 'found')
      assert.equal(map.get('LS-POT-24').barcode, '6294015161236')
    } finally {
      ctx.restore()
    }
  })

  await t.test('caps live Zoho calls and reports the rest as budget exceeded', async () => {
    const rows = []
    const skus = []
    for (let i = 0; i < 8; i += 1) {
      const sku = `LS-NO-BARCODE-${i}`
      skus.push(sku)
      rows.push(cachedRow({ sku, itemId: `id-${i}` }))
    }

    const ctx = loadLookup({ rows, details: {} })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(skus, {
        maxApiCalls: 2,
        concurrency: 1,
        budgetMs: 5000,
      })

      assert.ok(ctx.calls.fetchItemById.length <= 2, `expected at most 2 calls, got ${ctx.calls.fetchItemById.length}`)
      for (const sku of skus) {
        const entry = map.get(sku)
        assert.equal(entry.status, 'not-found')
        assert.equal(entry.reason, 'zoho-lookup-budget-exceeded')
        assert.equal(entry.barcode, '')
      }
    } finally {
      ctx.restore()
    }
  })

  await t.test('abandons a rate-limited Zoho call once the wall-clock budget runs out', async () => {
    const ctx = loadLookup({
      rows: [cachedRow({ sku: 'LS-POT-24', itemId: 'id-1' })],
      details: { 'id-1': { sku: 'LS-POT-24', item_id: 'id-1', upc: '6294015161236' } },
      detailDelayMs: 15000,
    })
    try {
      const startedAt = Date.now()
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'], { budgetMs: 150 })
      const elapsed = Date.now() - startedAt

      assert.ok(elapsed < 3000, `lookup should give up quickly, took ${elapsed}ms`)
      assert.equal(map.get('LS-POT-24').status, 'not-found')
      assert.equal(map.get('LS-POT-24').reason, 'zoho-lookup-budget-exceeded')
    } finally {
      ctx.restore()
    }
  })

  await t.test('never calls Zoho when the budget is disabled', async () => {
    const ctx = loadLookup({
      rows: [cachedRow({ sku: 'LS-POT-24', itemId: 'id-1' })],
      details: { 'id-1': { sku: 'LS-POT-24', item_id: 'id-1', upc: '6294015161236' } },
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24'], { maxApiCalls: 0 })

      assert.equal(ctx.calls.fetchItemById.length, 0)
      assert.equal(map.get('LS-POT-24').status, 'not-found')
      assert.equal(map.get('LS-POT-24').reason, 'zoho-barcode-blank')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reports every SKU as errored when the cache query fails', async () => {
    const ctx = loadLookup({
      findItemsBySkus: async () => {
        throw new Error('db down')
      },
    })
    try {
      const map = await ctx.lookup.lookupZohoBarcodesByExactSkus(['LS-POT-24', 'LS-POT-28'])

      assert.equal(map.get('LS-POT-24').status, 'error')
      assert.equal(map.get('LS-POT-24').reason, 'db down')
      assert.equal(map.get('LS-POT-28').status, 'error')
    } finally {
      ctx.restore()
    }
  })

  await t.test('reads the barcode from upc, ean or isbn on the row or its raw json', async () => {
    const ctx = loadLookup({})
    try {
      const { extractBarcodeText } = ctx.lookup
      assert.equal(extractBarcodeText({ upc: ' 6294015161236 ' }), '6294015161236')
      assert.equal(extractBarcodeText({ ean: '6294015161236' }), '6294015161236')
      assert.equal(extractBarcodeText({ raw_json: { isbn: '6294015161236' } }), '6294015161236')
      assert.equal(extractBarcodeText({ raw_json: { upc: '' } }), '')
      assert.equal(extractBarcodeText(null), '')
    } finally {
      ctx.restore()
    }
  })
})

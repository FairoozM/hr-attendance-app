/**
 * Backend tests for inventory health image cache + sync.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { mockModule, freshRequire } = require('./_helpers')

const UPLOAD_ROOT = path.join(__dirname, '../uploads/inventory-item-images-test')

function baseItem(overrides = {}) {
  return {
    item_id: '1001',
    sku: 'SKU-1001',
    name: 'Widget',
    status: 'active',
    stock_on_hand: 5,
    purchase_rate: 10,
    image_document_id: 'doc-1',
    ...overrides,
  }
}

function mockStorage() {
  return mockModule('../src/services/inventoryItemImageStorage', {
    UPLOAD_ROOT,
    PUBLIC_PREFIX: '/uploads/inventory-item-images',
    ensureUploadDir: () => fs.mkdirSync(UPLOAD_ROOT, { recursive: true }),
    saveInventoryItemImage: async (itemId, buffer, contentType) => ({
      imageUrl: `/uploads/inventory-item-images/${itemId}.jpg`,
      contentType: contentType || 'image/jpeg',
      fileSize: buffer.length,
    }),
    deleteInventoryItemImageFiles: async () => {},
    isPermanentCachedImageUrl: (url) =>
      typeof url === 'string' && url.startsWith('/uploads/inventory-item-images/'),
    isLegacyZohoProxyUrl: (url) =>
      typeof url === 'string' && url.includes('/api/zoho/items/images/'),
    fileExistsForPublicUrl: (url) => {
      if (!url || !url.startsWith('/uploads/inventory-item-images/')) return false
      const rel = url.slice('/uploads/inventory-item-images/'.length)
      return fs.existsSync(path.join(UPLOAD_ROOT, rel))
    },
    extensionFromContentType: () => 'jpg',
    sanitizeItemId: (id) => String(id),
    publicUrl: (itemId) => `/uploads/inventory-item-images/${itemId}.jpg`,
    _internals: {},
  })
}

test('attachImageFieldsToRows reads permanent imageUrl from cache only', async () => {
  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    attachImageFieldsToRows: async (rows) =>
      rows.map((row) => ({
        ...row,
        imageUrl: row.itemId === '1001' ? '/uploads/inventory-item-images/1001.jpg' : null,
        imageSource: row.itemId === '1001' ? 'zoho_downloaded_cached' : null,
        imageCachedAt: row.itemId === '1001' ? '2026-06-16T10:00:00.000Z' : null,
        imageMissing: row.itemId !== '1001',
      })),
    getImageCacheDebugInfo: async () => ({
      cachedRows: 1,
      missingRows: 0,
      sampleCachedUrls: [{ itemId: '1001', sku: 'SKU-1001', imageUrl: '/uploads/inventory-item-images/1001.jpg', fileExists: true }],
    }),
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [baseItem()],
    fetchItemsRawForWarehouse: async () => [],
  })

  const restoreSales = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: [], list_truncated: false, list_pages: 1 }),
  })

  const restoreGroups = mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [],
  })

  const restoreConfig = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null, organizationId: '1' }),
  })

  clearInventoryHealthCache()
  const svc = freshRequire('../src/services/inventoryHealthService')
  const data = await svc.getInventoryHealthDashboard({ includeZeroStock: '1' })

  assert.equal(data.rows.length, 1)
  assert.equal(data.rows[0].imageUrl, '/uploads/inventory-item-images/1001.jpg')
  assert.equal(data.rows[0].imageMissing, false)

  restoreStore()
  restoreAdapter()
  restoreSales()
  restoreGroups()
  restoreConfig()
})

function mockHealthCacheFallback() {
  return mockModule('../src/services/inventoryHealthService', {
    loadInventoryHealthBase: async () => {
      const err = new Error('cache miss in test')
      err.code = 'TEST_CACHE_MISS'
      throw err
    },
  })
}

test('syncMissingInventoryImages fetches only missing when force=false', async () => {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_ROOT, '1001.jpg'), Buffer.from('cached'))

  const upserts = []
  const imageFetches = []

  const restoreStorage = mockStorage()

  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () =>
      new Map([
        [
          '1001',
          {
            itemId: '1001',
            imageUrl: '/uploads/inventory-item-images/1001.jpg',
            missingReason: null,
          },
        ],
      ]),
    upsertInventoryItemImage: async (row) => {
      upserts.push(row)
    },
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      baseItem({ item_id: '1001', sku: 'SKU-A' }),
      baseItem({ item_id: '1002', sku: 'SKU-B', image_document_id: 'doc-2' }),
    ],
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async (itemId) => {
      imageFetches.push(itemId)
      return itemId === '1002' ? { buffer: Buffer.from('x'), contentType: 'image/jpeg' } : null
    },
    fetchItemById: async () => ({}),
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: false, limit: 100, dryRun: false })

  assert.equal(result.mode, 'missing_only')
  assert.equal(result.alreadyCached, 1)
  assert.equal(result.missingBeforeSync, 1)
  assert.equal(result.attempted, 1)
  assert.equal(result.downloaded, 1)
  assert.equal(result.saved, 1)
  assert.deepEqual(imageFetches, ['1002'])
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].itemId, '1002')
  assert.equal(upserts[0].imageSource, 'zoho_downloaded_cached')
  assert.match(upserts[0].imageUrl, /^\/uploads\/inventory-item-images\//)

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('syncMissingInventoryImages downloads via /image endpoint without list metadata', async () => {
  const upserts = []

  const restoreStorage = mockStorage()
  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () => new Map(),
    upsertInventoryItemImage: async (row) => {
      upserts.push(row)
    },
  })
  const restoreHealth = mockHealthCacheFallback()
  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      baseItem({ item_id: '1002', sku: 'NO-META', image_document_id: '', image_name: '' }),
    ],
  })
  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async (itemId) => {
      assert.equal(itemId, '1002')
      return { buffer: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' }
    },
    fetchItemById: async () => {
      throw new Error('fetchItemById should not be called')
    },
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: false, limit: 10 })

  assert.equal(result.saved, 1)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].itemId, '1002')
  assert.equal(upserts[0].imageSource, 'zoho_downloaded_cached')

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('syncMissingInventoryImages retries rows marked missing but skips permanent cache', async () => {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_ROOT, '1001.jpg'), Buffer.from('cached'))

  let fetchImageCalls = 0

  const restoreStorage = mockStorage()

  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () =>
      new Map([
        ['1001', { itemId: '1001', imageUrl: '/uploads/inventory-item-images/1001.jpg', missingReason: null }],
        ['1002', { itemId: '1002', imageUrl: null, missingReason: 'no_image_metadata' }],
      ]),
    upsertInventoryItemImage: async () => {},
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      baseItem({ item_id: '1001' }),
      baseItem({ item_id: '1002', image_document_id: 'doc' }),
    ],
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async () => {
      fetchImageCalls += 1
      return { buffer: Buffer.from('x'), contentType: 'image/jpeg' }
    },
    fetchItemById: async () => ({}),
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: false, limit: 100 })

  assert.equal(result.alreadyCached, 1)
  assert.equal(result.attempted, 1)
  assert.equal(fetchImageCalls, 1)

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('syncMissingInventoryImages re-downloads legacy proxy cache rows', async () => {
  const upserts = []

  const restoreStorage = mockStorage()

  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () =>
      new Map([
        [
          '1001',
          {
            itemId: '1001',
            imageUrl: null,
            imageSource: 'zoho_image_buffer',
            missingReason: null,
          },
        ],
      ]),
    upsertInventoryItemImage: async (row) => {
      upserts.push(row)
    },
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [baseItem({ item_id: '1001' })],
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async () => ({ buffer: Buffer.from('x'), contentType: 'image/jpeg' }),
    fetchItemById: async () => ({}),
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: false, limit: 100 })

  assert.equal(result.alreadyCached, 0)
  assert.equal(result.attempted, 1)
  assert.equal(result.saved, 1)
  assert.equal(upserts[0].imageSource, 'zoho_downloaded_cached')

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('syncMissingInventoryImages respects limit', async () => {
  const attemptedIds = []

  const restoreStorage = mockStorage()

  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () => new Map(),
    upsertInventoryItemImage: async (row) => {
      attemptedIds.push(row.itemId)
    },
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      baseItem({ item_id: '1001', sku: 'A' }),
      baseItem({ item_id: '1002', sku: 'B' }),
      baseItem({ item_id: '1003', sku: 'C' }),
    ],
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async () => ({ buffer: Buffer.from('x'), contentType: 'image/jpeg' }),
    fetchItemById: async () => ({}),
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: false, limit: 2 })

  assert.equal(result.attempted, 2)
  assert.equal(result.skippedDueToLimit, 1)
  assert.equal(attemptedIds.length, 2)

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('syncMissingInventoryImages allows refetch when force=true', async () => {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_ROOT, '1001.jpg'), Buffer.from('cached'))

  const imageFetches = []

  const restoreStorage = mockStorage()

  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getAllCachedByItemId: async () =>
      new Map([['1001', { itemId: '1001', imageUrl: '/uploads/inventory-item-images/1001.jpg', missingReason: null }]]),
    upsertInventoryItemImage: async () => {},
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async (itemId) => {
      imageFetches.push(itemId)
      return { buffer: Buffer.from('x'), contentType: 'image/jpeg' }
    },
    fetchItemById: async () => ({}),
  })

  const restoreHealth = mockHealthCacheFallback()

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [baseItem({ item_id: '1001' })],
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const result = await svc.syncMissingInventoryImages({ force: true, limit: 100 })

  assert.equal(result.mode, 'force_refetch')
  assert.equal(result.attempted, 1)
  assert.deepEqual(imageFetches, ['1001'])

  restoreStorage()
  restoreStore()
  restoreHealth()
  restoreAdapter()
  restoreClient()
})

test('getImageCacheStatus returns coverage stats', async () => {
  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    getImageCacheStatus: async () => ({
      cachedImages: 8,
      missingImages: 2,
      cacheCoveragePercent: 80,
      lastSyncAt: '2026-06-16T12:00:00.000Z',
      sampleMissing: [{ sku: 'X', itemName: 'Missing', itemId: '9', reason: 'no_image_metadata' }],
    }),
  })

  const svc = freshRequire('../src/services/inventoryHealthImageService')
  const status = await svc.getInventoryImageCacheStatus(10)

  assert.equal(status.cachedImages, 8)
  assert.equal(status.missingImages, 2)
  assert.equal(status.cacheCoveragePercent, 80)
  assert.equal(status.sampleMissing.length, 1)

  restoreStore()
})

test('missing images do not break inventory health rows', async () => {
  const restoreStore = mockModule('../src/services/inventoryItemImageStore', {
    attachImageFieldsToRows: async (rows) =>
      rows.map((row) => ({
        ...row,
        imageUrl: null,
        imageSource: null,
        imageCachedAt: null,
        imageMissing: true,
      })),
    getImageCacheDebugInfo: async () => ({
      cachedRows: 0,
      missingRows: 1,
      sampleCachedUrls: [],
    }),
  })

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [baseItem({ image_document_id: '', image_name: '' })],
    fetchItemsRawForWarehouse: async () => [],
  })

  const restoreSales = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: [], list_truncated: false, list_pages: 1 }),
  })

  const restoreGroups = mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [],
  })

  const restoreConfig = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null, organizationId: '1' }),
  })

  clearInventoryHealthCache()
  const svc = freshRequire('../src/services/inventoryHealthService')
  const data = await svc.getInventoryHealthDashboard({ includeZeroStock: '1' })

  assert.equal(data.rows.length, 1)
  assert.equal(data.rows[0].imageMissing, true)
  assert.equal(data.rows[0].imageUrl, null)
  assert.ok(data.rows[0].riskScore >= 0)

  restoreStore()
  restoreAdapter()
  restoreSales()
  restoreGroups()
  restoreConfig()
})

function clearInventoryHealthCache() {
  try {
    const svc = require('../src/services/inventoryHealthService')
    svc.clearInventoryHealthCache()
  } catch {
    // ignore before fresh require
  }
}

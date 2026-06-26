const test = require('node:test')
const assert = require('node:assert/strict')
const { freshRequire, mockModule } = require('./_helpers')

function makeFile({ name = 'file.bin', mimetype = 'application/octet-stream' } = {}) {
  return {
    originalname: name,
    mimetype,
    size: 12,
    buffer: Buffer.from('test-file'),
  }
}

function makeStore() {
  const store = {
    batchId: 1,
    rowId: 10,
    fileId: 100,
    batches: [],
    rows: [],
    files: [],
  }

  function batchSummary(batchId) {
    const rows = store.rows.filter((row) => row.batch_id === Number(batchId))
    const files = store.files.filter((file) => file.batch_id === Number(batchId))
    return {
      total_lines: rows.length,
      total_quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      missing_fnsku_count: rows.filter((row) => !row.fnsku_no).length,
      missing_image_count: rows.filter((row) => !files.some((file) => file.row_id === row.id && file.file_type === 'product_image')).length,
      missing_pdf_count: rows.filter((row) => !files.some((file) => file.row_id === row.id && file.file_type === 'fnsku_label_pdf')).length,
      pdf_file_count: files.filter((file) => file.file_type === 'fnsku_label_pdf').length,
    }
  }

  async function query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim()
    if (compact.startsWith('SELECT b.*')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      return { rows: batch ? [{ ...batch, ...batchSummary(batch.id) }] : [] }
    }
    if (compact.startsWith('SELECT * FROM amazon_ksa_rto_label_rows WHERE batch_id')) {
      return { rows: store.rows.filter((row) => row.batch_id === Number(params[0])).sort((a, b) => a.id - b.id) }
    }
    if (compact.startsWith('SELECT * FROM amazon_ksa_rto_label_files WHERE batch_id') && compact.includes('ORDER BY created_at')) {
      return { rows: store.files.filter((file) => file.batch_id === Number(params[0])).sort((a, b) => b.id - a.id) }
    }
    if (compact.startsWith('SELECT id, batch_id FROM amazon_ksa_rto_label_rows')) {
      return {
        rows: store.rows
          .filter((row) => row.id === Number(params[0]) && row.batch_id === Number(params[1]))
          .map((row) => ({ id: row.id, batch_id: row.batch_id })),
      }
    }
    if (compact.startsWith('SELECT * FROM amazon_ksa_rto_label_files WHERE batch_id') && compact.includes('row_id')) {
      return {
        rows: store.files.filter(
          (file) => file.batch_id === Number(params[0]) && file.row_id === Number(params[1]) && file.file_type === params[2]
        ),
      }
    }
    if (compact.startsWith('SELECT * FROM amazon_ksa_rto_label_files WHERE row_id')) {
      return {
        rows: store.files.filter((file) => file.row_id === Number(params[0]) && ['product_image', 'fnsku_label_pdf'].includes(file.file_type)),
      }
    }
    if (compact.startsWith('SELECT * FROM amazon_ksa_rto_label_rows WHERE id')) {
      return { rows: store.rows.filter((row) => row.id === Number(params[0])) }
    }
    if (compact.startsWith('DELETE FROM amazon_ksa_rto_label_files WHERE batch_id')) {
      store.files = store.files.filter(
        (file) => !(file.batch_id === Number(params[0]) && file.row_id === Number(params[1]) && file.file_type === params[2])
      )
      return { rows: [] }
    }
    if (compact.startsWith('INSERT INTO amazon_ksa_rto_label_files')) {
      const file = {
        id: store.fileId++,
        batch_id: Number(params[0]),
        row_id: Number(params[1]),
        file_type: params[2],
        file_name: params[3],
        file_url: params[4],
        file_size: params[5],
        mime_type: params[6],
        uploaded_by: params[7],
        created_at: new Date().toISOString(),
      }
      store.files.push(file)
      return { rows: [file] }
    }
    if (compact.startsWith('UPDATE amazon_ksa_rto_label_rows SET status')) {
      const row = store.rows.find((item) => item.id === Number(params[0]))
      if (row) row.status = params[1]
      return { rows: row ? [row] : [] }
    }
    throw new Error(`Unhandled SQL in test: ${compact}`)
  }

  async function clientQuery(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim()
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) return { rows: [] }
    if (compact.startsWith('INSERT INTO amazon_ksa_rto_label_batches')) {
      const batch = {
        id: store.batchId++,
        batch_title: params[0],
        reference_no: params[1],
        agent_name: params[2],
        destination: params[3],
        notes: params[4],
        header_image_url: params[5],
        created_by: params[6],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.batches.push(batch)
      return { rows: [{ id: batch.id }] }
    }
    if (compact.startsWith('INSERT INTO amazon_ksa_rto_label_rows')) {
      const row = {
        id: store.rowId++,
        batch_id: Number(params[0]),
        product_code: params[1],
        fnsku_no: params[2],
        quantity: Number(params[3]),
        notes: params[4],
        status: params[5],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.rows.push(row)
      return { rows: [{ id: row.id }] }
    }
    throw new Error(`Unhandled client SQL in test: ${compact}`)
  }

  return {
    store,
    db: {
      query,
      pool: {
        async connect() {
          return { query: clientQuery, release() {} }
        },
      },
    },
  }
}

function loadService() {
  const { store, db } = makeStore()
  const restoreDb = mockModule('../src/db', db)
  const restoreS3 = mockModule('../src/services/s3Service', {
    createAmazonKsaRtoLabelKey(batchId, fileType, fileName, rowId) {
      return `test/${batchId}/${rowId || 'batch'}/${fileType}/${fileName}`
    },
    async putObjectBuffer() {},
    async getDownloadUrl({ key }) {
      return `https://signed.example/${key}`
    },
    async deleteObjectIfExists() {},
  })
  const service = freshRequire('../src/services/amazonKsaRtoLabelingService')
  return {
    service,
    store,
    restore() {
      restoreDb()
      restoreS3()
    },
  }
}

test('Amazon KSA RTO labeling status distinguishes missing product code and row files', () => {
  const { service, restore } = loadService()
  try {
    assert.equal(service.statusForRow({ product_code: '', fnsku_no: 'X001ABC', quantity: 1 }), service.STATUS_MISSING_PRODUCT_CODE)
    assert.equal(service.statusForRow({ product_code: 'LIFEP12', fnsku_no: 'X001ABC', quantity: 0 }), service.STATUS_INVALID_QTY)
    assert.equal(service.statusForRow({ product_code: 'LIFEP12', fnsku_no: '', quantity: 1 }), service.STATUS_MISSING_FNSKU)
    assert.equal(service.statusForRow({ product_code: 'LIFEP12', fnsku_no: 'X001ABC', quantity: 1 }), service.STATUS_MISSING_IMAGE)
    assert.equal(
      service.statusForRow({ product_code: 'LIFEP12', fnsku_no: 'X001ABC', quantity: 1, productImage: { id: 1 } }),
      service.STATUS_MISSING_PDF
    )
    assert.equal(
      service.statusForRow({
        product_code: 'LIFEP12',
        fnsku_no: 'X001ABC',
        quantity: 1,
        productImage: { id: 1 },
        labelPdf: { id: 2 },
      }),
      service.STATUS_READY
    )
  } finally {
    restore()
  }
})

test('Amazon KSA RTO labeling creates batch, uploads row files, and fetches files attached to row', async () => {
  const { service, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Test',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id

    await service.uploadRowFile(created.id, rowId, 'product_image', makeFile({ name: 'sku.webp', mimetype: 'image/webp' }), 7)
    await service.uploadRowFile(created.id, rowId, 'fnsku_label_pdf', makeFile({ name: 'fnsku.pdf', mimetype: 'application/pdf' }), 7)

    const fetched = await service.getBatch(created.id)
    assert.equal(fetched.rows.length, 1)
    assert.equal(fetched.rows[0].productImage.fileName, 'sku.webp')
    assert.equal(fetched.rows[0].labelPdf.fileName, 'fnsku.pdf')
    assert.equal(fetched.rows[0].status, service.STATUS_READY)
  } finally {
    restore()
  }
})

test('Amazon KSA RTO labeling rejects wrong MIME type for row uploads', async () => {
  const { service, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Test',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id

    await assert.rejects(
      service.uploadRowFile(created.id, rowId, 'product_image', makeFile({ name: 'wrong.pdf', mimetype: 'application/pdf' }), 7),
      /Image upload must be PNG, JPG, or WebP/
    )
    await assert.rejects(
      service.uploadRowFile(created.id, rowId, 'fnsku_label_pdf', makeFile({ name: 'wrong.png', mimetype: 'image/png' }), 7),
      /FNSKU label upload must be a PDF/
    )
  } finally {
    restore()
  }
})

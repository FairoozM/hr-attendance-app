const test = require('node:test')
const assert = require('node:assert/strict')
const { captureConsole, freshRequire, makeReqRes, mockModule } = require('./_helpers')

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
      agent_checked_count: rows.filter((row) => row.agent_row_status === 'checked').length,
      agent_issue_count: rows.filter((row) => row.agent_row_status === 'issue').length,
      agent_not_checked_count: rows.filter((row) => row.agent_row_status === 'not_checked').length,
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
    if (compact.startsWith('SELECT id FROM amazon_ksa_rto_label_batches WHERE share_token')) {
      return {
        rows: store.batches
          .filter((batch) => {
            if (batch.share_token !== params[0] || !batch.share_enabled) return false
            if (!batch.share_expires_at) return true
            return new Date(batch.share_expires_at).getTime() > Date.now()
          })
          .map((batch) => ({ id: batch.id })),
      }
    }
    if (compact.startsWith('SELECT id, agent_status FROM amazon_ksa_rto_label_batches')) {
      return {
        rows: store.batches
          .filter((batch) => {
            if (batch.share_token !== params[0] || !batch.share_enabled) return false
            if (!batch.share_expires_at) return true
            return new Date(batch.share_expires_at).getTime() > Date.now()
          })
          .map((batch) => ({ id: batch.id, agent_status: batch.agent_status })),
      }
    }
    if (compact.startsWith('SELECT id, share_token FROM amazon_ksa_rto_label_batches')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      return { rows: batch ? [{ id: batch.id, share_token: batch.share_token }] : [] }
    }
    if (compact.startsWith('SELECT id FROM amazon_ksa_rto_label_batches WHERE id')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      return { rows: batch ? [{ id: batch.id }] : [] }
    }
    if (compact.startsWith('UPDATE amazon_ksa_rto_label_batches SET share_token')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      if (batch) {
        batch.share_token = params[1]
        batch.share_enabled = params[2]
        batch.share_expires_at = params[3]
      }
      return { rows: [] }
    }
    if (compact.startsWith('UPDATE amazon_ksa_rto_label_batches SET share_enabled')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      if (batch) batch.share_enabled = false
      return { rows: batch ? [{ id: batch.id }] : [] }
    }
    if (compact.startsWith("UPDATE amazon_ksa_rto_label_rows SET agent_row_status = 'not_checked'")) {
      for (const row of store.rows.filter((item) => item.batch_id === Number(params[0]))) {
        row.agent_row_status = 'not_checked'
        row.agent_row_note = null
        row.agent_checked_at = null
      }
      return { rows: [] }
    }
    if (compact.startsWith('UPDATE amazon_ksa_rto_label_rows SET agent_row_status')) {
      const row = store.rows.find((item) => item.id === Number(params[0]) && item.batch_id === Number(params[1]))
      if (row) {
        row.agent_row_status = params[2]
        row.agent_row_note = params[3]
        row.agent_checked_at = ['checked', 'issue'].includes(params[2]) ? new Date().toISOString() : null
      }
      return { rows: row ? [{ id: row.id }] : [] }
    }
    if (compact.startsWith('UPDATE amazon_ksa_rto_label_batches SET agent_status = CASE')) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      if (batch && batch.agent_status === 'pending') batch.agent_status = 'in_progress'
      return { rows: [] }
    }
    if (compact.startsWith("UPDATE amazon_ksa_rto_label_batches SET agent_status = 'completed'")) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      if (batch) {
        batch.agent_status = 'completed'
        batch.agent_completed_at = new Date().toISOString()
        batch.agent_notes = params[1]
        batch.agent_completed_by_name = params[2]
      }
      return { rows: [] }
    }
    if (compact.startsWith("UPDATE amazon_ksa_rto_label_batches SET agent_status = 'in_progress'")) {
      const batch = store.batches.find((item) => item.id === Number(params[0]))
      if (batch) {
        batch.agent_status = 'in_progress'
        batch.agent_completed_at = null
      }
      return { rows: [] }
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
        share_token: null,
        share_enabled: false,
        share_expires_at: null,
        agent_completed_at: null,
        agent_notes: null,
        agent_completed_by_name: null,
        agent_status: 'pending',
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
        agent_row_status: 'not_checked',
        agent_row_note: null,
        agent_checked_at: null,
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

test('Amazon KSA RTO public share returns batch only when enabled and not expired', async () => {
  const { service, store, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    assert.equal(await service.publicBatchByToken('missing-token'), null)

    const shared = await service.setBatchShare(created.id, {})
    assert.ok(shared.shareToken)
    const publicBatch = await service.publicBatchByToken(shared.shareToken)
    assert.equal(publicBatch.batchTitle, 'KSA RTO Public')
    assert.equal(publicBatch.rows[0].productCode, 'LIFEP12')
    assert.equal(publicBatch.rows[0].files, undefined)
    assert.equal(publicBatch.rows[0].productImage, null)

    await service.disableBatchShare(created.id)
    assert.equal(await service.publicBatchByToken(shared.shareToken), null)

    store.batches[0].share_enabled = true
    store.batches[0].share_expires_at = '2000-01-01T00:00:00.000Z'
    assert.equal(await service.publicBatchByToken(shared.shareToken), null)
  } finally {
    restore()
  }
})

test('Amazon KSA RTO public row status update to checked works', async () => {
  const { service, store, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id
    const shared = await service.setBatchShare(created.id, {})
    const publicBatch = await service.updatePublicRowStatus(shared.shareToken, rowId, {
      agentRowStatus: 'checked',
    })

    assert.equal(publicBatch.rows[0].agentRowStatus, 'checked')
    assert.equal(publicBatch.rows[0].agentRowNote, '')
    assert.equal(store.rows[0].agent_row_status, 'checked')
    assert.ok(store.rows[0].agent_checked_at)
    assert.equal(store.batches[0].agent_status, 'in_progress')
  } finally {
    restore()
  }
})

test('Amazon KSA RTO public row status update to issue with note works and only updates agent fields', async () => {
  const { service, store, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id
    const shared = await service.setBatchShare(created.id, {})
    const before = { ...store.rows[0] }
    const publicBatch = await service.updatePublicRowStatus(shared.shareToken, rowId, {
      agentRowStatus: 'issue',
      agentRowNote: 'Quantity mismatch',
      productCode: 'HACK',
      fnskuNo: 'BAD',
      quantity: 999,
    })

    assert.equal(publicBatch.rows[0].agentRowStatus, 'issue')
    assert.equal(publicBatch.rows[0].agentRowNote, 'Quantity mismatch')
    assert.equal(store.rows[0].agent_row_status, 'issue')
    assert.equal(store.rows[0].agent_row_note, 'Quantity mismatch')
    assert.equal(store.rows[0].product_code, before.product_code)
    assert.equal(store.rows[0].fnsku_no, before.fnsku_no)
    assert.equal(store.rows[0].quantity, before.quantity)
  } finally {
    restore()
  }
})

test('Amazon KSA RTO public controller never returns raw DB error messages', async () => {
  const rawError = new Error('inconsistent types deduced for parameter $3')
  const restoreService = mockModule('../src/services/amazonKsaRtoLabelingService', {
    async updatePublicRowStatus() {
      throw rawError
    },
  })
  try {
    const controller = freshRequire('../src/controllers/amazonKsaRtoLabelingController')
    const { req, res } = makeReqRes({
      params: { shareToken: 'token', rowId: '10' },
      body: { agentRowStatus: 'checked' },
    })
    const logs = await captureConsole(async () => {
      await controller.postPublicRowStatus(req, res)
    })

    assert.equal(res.statusCode, 500)
    assert.equal(res.body.error, 'Could not save this row status. Please try again.')
    assert.equal(JSON.stringify(res.body).includes('inconsistent types'), false)
    assert.equal(JSON.stringify(res.body).includes('parameter $3'), false)
    assert.equal(logs.error.length > 0, true)
    assert.equal(String(logs.error[0][1]?.message || logs.error[0][1]).includes('inconsistent types'), true)
  } finally {
    restoreService()
  }
})

test('Amazon KSA RTO public complete sets completed status and notes', async () => {
  const { service, store, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const shared = await service.setBatchShare(created.id, {})
    const completed = await service.completePublicBatch(shared.shareToken, {
      agentNotes: 'Finished all rows',
      completedByName: 'KSA Agent',
    })

    assert.equal(completed.agentStatus, 'completed')
    assert.equal(completed.agentNotes, 'Finished all rows')
    assert.equal(completed.agentCompletedByName, 'KSA Agent')
    assert.equal(store.batches[0].agent_status, 'completed')
    await assert.rejects(
      service.updatePublicRowStatus(shared.shareToken, created.rows[0].id, { agentRowStatus: 'checked' }),
      /already completed/
    )
  } finally {
    restore()
  }
})

test('Amazon KSA RTO completed batch can be reopened without resetting row statuses', async () => {
  const { service, store, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id
    const shared = await service.setBatchShare(created.id, {})
    await service.updatePublicRowStatus(shared.shareToken, rowId, {
      agentRowStatus: 'issue',
      agentRowNote: 'Damaged item',
    })
    await service.completePublicBatch(shared.shareToken, {
      agentNotes: 'Finished too early',
      completedByName: 'KSA Agent',
    })

    const beforeToken = store.batches[0].share_token
    const reopened = await service.reopenAgentBatch(created.id, { resetRows: false })

    assert.equal(reopened.agentStatus, 'in_progress')
    assert.equal(reopened.agentCompletedAt, null)
    assert.equal(reopened.shareToken, beforeToken)
    assert.equal(reopened.shareEnabled, true)
    assert.equal(reopened.rows[0].agentRowStatus, 'issue')
    assert.equal(reopened.rows[0].agentRowNote, 'Damaged item')

    const publicBatch = await service.updatePublicRowStatus(shared.shareToken, rowId, {
      agentRowStatus: 'checked',
    })
    assert.equal(publicBatch.agentStatus, 'in_progress')
    assert.equal(publicBatch.rows[0].agentRowStatus, 'checked')
  } finally {
    restore()
  }
})

test('Amazon KSA RTO reopen with reset clears row checks/issues and notes', async () => {
  const { service, restore } = loadService()
  try {
    const created = await service.createBatch(
      {
        batchTitle: 'KSA RTO Public',
        rows: [{ productCode: 'LIFEP12', fnskuNo: 'X001ABC', quantity: 2 }],
      },
      7
    )
    const rowId = created.rows[0].id
    const shared = await service.setBatchShare(created.id, {})
    await service.updatePublicRowStatus(shared.shareToken, rowId, {
      agentRowStatus: 'issue',
      agentRowNote: 'Quantity mismatch',
    })
    await service.completePublicBatch(shared.shareToken, {})

    const reopened = await service.reopenAgentBatch(created.id, { resetRows: true })

    assert.equal(reopened.agentStatus, 'in_progress')
    assert.equal(reopened.agentCompletedAt, null)
    assert.equal(reopened.shareToken, shared.shareToken)
    assert.equal(reopened.shareEnabled, true)
    assert.equal(reopened.rows[0].agentRowStatus, 'not_checked')
    assert.equal(reopened.rows[0].agentRowNote, '')
    assert.equal(reopened.rows[0].agentCheckedAt, null)
  } finally {
    restore()
  }
})

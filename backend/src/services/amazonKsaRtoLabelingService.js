const { query, pool } = require('../db')
const s3Service = require('./s3Service')

const STATUS_READY = 'Ready'
const STATUS_MISSING_PRODUCT_CODE = 'Missing Product Code'
const STATUS_MISSING_FNSKU = 'Missing FNSKU'
const STATUS_MISSING_IMAGE = 'Missing Image'
const STATUS_MISSING_PDF = 'Missing PDF'
const STATUS_INVALID_QTY = 'Invalid Qty'
const DEFAULT_DESTINATION = 'Wanasa-Lifesmile'
const FILE_TYPE_BATCH_HEADER = 'batch_header'
const FILE_TYPE_HEADER_IMAGE = 'header_image'
const FILE_TYPE_PRODUCT_IMAGE = 'product_image'
const FILE_TYPE_FNSKU_LABEL_PDF = 'fnsku_label_pdf'

function intOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeQuantity(value) {
  if (typeof value === 'number') return value
  const raw = normalizeText(value).replace(/,/g, '')
  if (!raw) return NaN
  return Number(raw)
}

function statusForRow(row) {
  const productCode = normalizeText(row.product_code ?? row.productCode)
  const quantity = normalizeQuantity(row.quantity)
  const fnsku = normalizeText(row.fnsku_no ?? row.fnskuNo)
  const productImage = row.productImage || row.product_image || row.productImageFile || row.product_image_file
  const labelPdf = row.labelPdf || row.label_pdf || row.labelPdfFile || row.label_pdf_file
  if (!productCode) return STATUS_MISSING_PRODUCT_CODE
  if (!Number.isFinite(quantity) || quantity <= 0) return STATUS_INVALID_QTY
  if (!fnsku) return STATUS_MISSING_FNSKU
  if (!productImage) return STATUS_MISSING_IMAGE
  if (!labelPdf) return STATUS_MISSING_PDF
  return STATUS_READY
}

function normalizeRow(row) {
  const productCode = normalizeText(row.product_code ?? row.productCode)
  const fnskuNo = normalizeText(row.fnsku_no ?? row.fnskuNo)
  const quantity = normalizeQuantity(row.quantity)
  const notes = normalizeText(row.notes)
  const status = statusForRow({ product_code: productCode, fnsku_no: fnskuNo, quantity })
  return {
    id: intOrNull(row.id),
    product_code: productCode,
    fnsku_no: fnskuNo || null,
    quantity,
    notes,
    status,
  }
}

function validateBatchPayload(payload) {
  const batchTitle = normalizeText(payload.batch_title ?? payload.batchTitle) || 'Amazon KSA RTO - LIFESMILE'
  const rows = Array.isArray(payload.rows) ? payload.rows.map(normalizeRow) : []
  const invalid = rows.filter((row) => [STATUS_MISSING_PRODUCT_CODE, STATUS_INVALID_QTY].includes(row.status))
  if (!rows.length) {
    const err = new Error('Add at least one labeling row before saving.')
    err.status = 400
    throw err
  }
  if (invalid.length) {
    const err = new Error('Some rows have missing product code or invalid quantity.')
    err.status = 400
    err.details = invalid.map((row, index) => ({ index, product_code: row.product_code, quantity: row.quantity }))
    throw err
  }
  return {
    batch_title: batchTitle,
    reference_no: normalizeText(payload.reference_no ?? payload.referenceNo) || null,
    agent_name: normalizeText(payload.agent_name ?? payload.agentName) || null,
    destination: normalizeText(payload.destination) || DEFAULT_DESTINATION,
    notes: normalizeText(payload.notes) || null,
    header_image_url: normalizeText(payload.header_image_url ?? payload.headerImageUrl) || null,
    rows,
  }
}

function mapBatch(row) {
  if (!row) return null
  return {
    id: row.id,
    batchTitle: row.batch_title,
    referenceNo: row.reference_no || '',
    agentName: row.agent_name || '',
    destination: row.destination || DEFAULT_DESTINATION,
    notes: row.notes || '',
    headerImageUrl: row.header_image_url || '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalLines: Number(row.total_lines || 0),
    totalQuantity: Number(row.total_quantity || 0),
    missingFnskuCount: Number(row.missing_fnsku_count || 0),
    missingImageCount: Number(row.missing_image_count || 0),
    missingPdfCount: Number(row.missing_pdf_count || 0),
    pdfFileCount: Number(row.pdf_file_count || 0),
  }
}

function mapRow(row, files = []) {
  const productImage = files.find((file) => file.fileType === FILE_TYPE_PRODUCT_IMAGE) || null
  const labelPdf = files.find((file) => file.fileType === FILE_TYPE_FNSKU_LABEL_PDF) || null
  return {
    id: row.id,
    batchId: row.batch_id,
    productCode: row.product_code,
    fnskuNo: row.fnsku_no || '',
    quantity: Number(row.quantity || 0),
    notes: row.notes || '',
    status: statusForRow({
      product_code: row.product_code,
      fnsku_no: row.fnsku_no,
      quantity: row.quantity,
      productImage,
      labelPdf,
    }),
    productImage,
    labelPdf,
    files,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function mapFile(row) {
  const key = row.file_url
  let downloadUrl = ''
  try {
    downloadUrl = await s3Service.getDownloadUrl({ key, expiresIn: 3600 })
  } catch {
    downloadUrl = ''
  }
  return {
    id: row.id,
    batchId: row.batch_id,
    rowId: row.row_id,
    fileType: row.file_type,
    fileName: row.file_name,
    fileUrl: key,
    downloadUrl,
    fileSize: Number(row.file_size || 0),
    mimeType: row.mime_type || '',
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    status: downloadUrl ? 'Uploaded' : 'Stored',
  }
}

async function ensureAmazonKsaRtoLabelingTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_batches (
      id SERIAL PRIMARY KEY,
      batch_title TEXT NOT NULL,
      reference_no TEXT,
      agent_name TEXT,
      destination TEXT NOT NULL DEFAULT 'Wanasa-Lifesmile',
      notes TEXT,
      header_image_url TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_rows (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES amazon_ksa_rto_label_batches(id) ON DELETE CASCADE,
      product_code TEXT NOT NULL,
      fnsku_no TEXT,
      quantity NUMERIC(14,2) NOT NULL,
      notes TEXT,
      status VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT amazon_ksa_rto_label_rows_quantity_chk CHECK (quantity > 0),
      CONSTRAINT amazon_ksa_rto_label_rows_status_chk CHECK (status IN ('Ready', 'Missing Product Code', 'Missing FNSKU', 'Missing Image', 'Missing PDF', 'Invalid Qty'))
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_files (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES amazon_ksa_rto_label_batches(id) ON DELETE CASCADE,
      row_id INTEGER REFERENCES amazon_ksa_rto_label_rows(id) ON DELETE CASCADE,
      file_type VARCHAR(32) NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT amazon_ksa_rto_label_files_type_chk CHECK (file_type IN ('batch_header', 'header_image', 'fnsku_pdf', 'product_image', 'fnsku_label_pdf'))
    )
  `)
  await query(`ALTER TABLE amazon_ksa_rto_label_files ADD COLUMN IF NOT EXISTS row_id INTEGER REFERENCES amazon_ksa_rto_label_rows(id) ON DELETE CASCADE`)
  await query(`ALTER TABLE amazon_ksa_rto_label_rows DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_rows_status_chk`)
  await query(`
    ALTER TABLE amazon_ksa_rto_label_rows
    ADD CONSTRAINT amazon_ksa_rto_label_rows_status_chk
    CHECK (status IN ('Ready', 'Missing Product Code', 'Missing FNSKU', 'Missing Image', 'Missing PDF', 'Invalid Qty'))
  `)
  await query(`ALTER TABLE amazon_ksa_rto_label_files DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_files_type_chk`)
  await query(`
    ALTER TABLE amazon_ksa_rto_label_files
    ADD CONSTRAINT amazon_ksa_rto_label_files_type_chk
    CHECK (file_type IN ('batch_header', 'header_image', 'fnsku_pdf', 'product_image', 'fnsku_label_pdf'))
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_batches_created ON amazon_ksa_rto_label_batches(created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_batches_reference ON amazon_ksa_rto_label_batches(LOWER(reference_no))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_batch ON amazon_ksa_rto_label_rows(batch_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_product ON amazon_ksa_rto_label_rows(LOWER(product_code))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_fnsku ON amazon_ksa_rto_label_rows(LOWER(fnsku_no))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_files_batch ON amazon_ksa_rto_label_files(batch_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_files_row ON amazon_ksa_rto_label_files(row_id)`)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_ksa_rto_row_file_type
    ON amazon_ksa_rto_label_files(row_id, file_type)
    WHERE row_id IS NOT NULL AND file_type IN ('product_image', 'fnsku_label_pdf')
  `)
}

async function listBatches({ search = '', from = '', to = '', limit = 50 } = {}) {
  const where = []
  const params = []
  const q = normalizeText(search)
  if (q) {
    params.push(`%${q.toLowerCase()}%`)
    where.push(`(
      LOWER(b.batch_title) LIKE $${params.length}
      OR LOWER(COALESCE(b.reference_no, '')) LIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM amazon_ksa_rto_label_rows r
        WHERE r.batch_id = b.id
          AND (LOWER(r.product_code) LIKE $${params.length} OR LOWER(COALESCE(r.fnsku_no, '')) LIKE $${params.length})
      )
    )`)
  }
  if (from) {
    params.push(from)
    where.push(`b.created_at::date >= $${params.length}::date`)
  }
  if (to) {
    params.push(to)
    where.push(`b.created_at::date <= $${params.length}::date`)
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200))
  const sql = `
    SELECT b.*,
      COALESCE(rs.total_lines, 0)::int AS total_lines,
      COALESCE(rs.total_quantity, 0) AS total_quantity,
      COALESCE(rs.missing_fnsku_count, 0)::int AS missing_fnsku_count,
      COALESCE(rs.missing_image_count, 0)::int AS missing_image_count,
      COALESCE(rs.missing_pdf_count, 0)::int AS missing_pdf_count,
      COALESCE(fs.pdf_file_count, 0)::int AS pdf_file_count
    FROM amazon_ksa_rto_label_batches b
    LEFT JOIN (
      SELECT r.batch_id,
        COUNT(*)::int AS total_lines,
        COALESCE(SUM(r.quantity), 0) AS total_quantity,
        COUNT(*) FILTER (WHERE COALESCE(r.fnsku_no, '') = '')::int AS missing_fnsku_count,
        COUNT(*) FILTER (WHERE pi.id IS NULL)::int AS missing_image_count,
        COUNT(*) FILTER (WHERE lp.id IS NULL)::int AS missing_pdf_count
      FROM amazon_ksa_rto_label_rows r
      LEFT JOIN amazon_ksa_rto_label_files pi
        ON pi.row_id = r.id AND pi.file_type = 'product_image'
      LEFT JOIN amazon_ksa_rto_label_files lp
        ON lp.row_id = r.id AND lp.file_type = 'fnsku_label_pdf'
      GROUP BY r.batch_id
    ) rs ON rs.batch_id = b.id
    LEFT JOIN (
      SELECT batch_id, COUNT(*) FILTER (WHERE file_type IN ('fnsku_label_pdf', 'fnsku_pdf'))::int AS pdf_file_count
      FROM amazon_ksa_rto_label_files
      GROUP BY batch_id
    ) fs ON fs.batch_id = b.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.updated_at DESC, b.id DESC
    LIMIT $${params.length}
  `
  const result = await query(sql, params)
  return result.rows.map(mapBatch)
}

async function getBatch(id) {
  const batch = await query(`
    SELECT b.*,
      COALESCE(rs.total_lines, 0)::int AS total_lines,
      COALESCE(rs.total_quantity, 0) AS total_quantity,
      COALESCE(rs.missing_fnsku_count, 0)::int AS missing_fnsku_count,
      COALESCE(rs.missing_image_count, 0)::int AS missing_image_count,
      COALESCE(rs.missing_pdf_count, 0)::int AS missing_pdf_count,
      COALESCE(fs.pdf_file_count, 0)::int AS pdf_file_count
    FROM amazon_ksa_rto_label_batches b
    LEFT JOIN (
      SELECT r.batch_id,
        COUNT(*)::int AS total_lines,
        COALESCE(SUM(r.quantity), 0) AS total_quantity,
        COUNT(*) FILTER (WHERE COALESCE(r.fnsku_no, '') = '')::int AS missing_fnsku_count,
        COUNT(*) FILTER (WHERE pi.id IS NULL)::int AS missing_image_count,
        COUNT(*) FILTER (WHERE lp.id IS NULL)::int AS missing_pdf_count
      FROM amazon_ksa_rto_label_rows r
      LEFT JOIN amazon_ksa_rto_label_files pi
        ON pi.row_id = r.id AND pi.file_type = 'product_image'
      LEFT JOIN amazon_ksa_rto_label_files lp
        ON lp.row_id = r.id AND lp.file_type = 'fnsku_label_pdf'
      GROUP BY r.batch_id
    ) rs ON rs.batch_id = b.id
    LEFT JOIN (
      SELECT batch_id, COUNT(*) FILTER (WHERE file_type IN ('fnsku_label_pdf', 'fnsku_pdf'))::int AS pdf_file_count
      FROM amazon_ksa_rto_label_files
      GROUP BY batch_id
    ) fs ON fs.batch_id = b.id
    WHERE b.id = $1
  `, [id])
  if (!batch.rows.length) return null
  const rows = await query(`SELECT * FROM amazon_ksa_rto_label_rows WHERE batch_id = $1 ORDER BY id ASC`, [id])
  const files = await query(`SELECT * FROM amazon_ksa_rto_label_files WHERE batch_id = $1 ORDER BY created_at DESC, id DESC`, [id])
  const mappedFiles = await Promise.all(files.rows.map(mapFile))
  const filesByRowId = new Map()
  for (const file of mappedFiles) {
    if (file.rowId == null) continue
    const key = String(file.rowId)
    if (!filesByRowId.has(key)) filesByRowId.set(key, [])
    filesByRowId.get(key).push(file)
  }
  return {
    ...mapBatch(batch.rows[0]),
    rows: rows.rows.map((row) => mapRow(row, filesByRowId.get(String(row.id)) || [])),
    files: mappedFiles.filter((file) => file.rowId == null),
  }
}

async function insertRows(client, batchId, rows) {
  const inserted = []
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO amazon_ksa_rto_label_rows
        (batch_id, product_code, fnsku_no, quantity, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [batchId, row.product_code, row.fnsku_no, row.quantity, row.notes || null, row.status]
    )
    inserted.push(result.rows?.[0])
  }
  return inserted
}

async function replaceRowsPreservingFiles(client, batchId, rows) {
  const keptIds = []
  for (const row of rows) {
    if (row.id) {
      const updated = await client.query(
        `UPDATE amazon_ksa_rto_label_rows
         SET product_code = $3,
             fnsku_no = $4,
             quantity = $5,
             notes = $6,
             status = $7,
             updated_at = NOW()
         WHERE id = $1 AND batch_id = $2
         RETURNING id`,
        [row.id, batchId, row.product_code, row.fnsku_no, row.quantity, row.notes || null, row.status]
      )
      if (updated.rows.length) {
        keptIds.push(updated.rows[0].id)
        continue
      }
    }
    const inserted = await client.query(
      `INSERT INTO amazon_ksa_rto_label_rows
        (batch_id, product_code, fnsku_no, quantity, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [batchId, row.product_code, row.fnsku_no, row.quantity, row.notes || null, row.status]
    )
    keptIds.push(inserted.rows[0].id)
  }
  if (keptIds.length) {
    const removedFiles = await client.query(
      `SELECT f.file_url
       FROM amazon_ksa_rto_label_files f
       JOIN amazon_ksa_rto_label_rows r ON r.id = f.row_id
       WHERE r.batch_id = $1 AND NOT (r.id = ANY($2::int[]))`,
      [batchId, keptIds]
    )
    for (const file of removedFiles.rows) {
      await s3Service.deleteObjectIfExists(file.file_url).catch(() => {})
    }
    await client.query(
      `DELETE FROM amazon_ksa_rto_label_rows
       WHERE batch_id = $1 AND NOT (id = ANY($2::int[]))`,
      [batchId, keptIds]
    )
  } else {
    await client.query(`DELETE FROM amazon_ksa_rto_label_rows WHERE batch_id = $1`, [batchId])
  }
}

async function createBatch(payload, userId) {
  const data = validateBatchPayload(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const created = await client.query(
      `INSERT INTO amazon_ksa_rto_label_batches
        (batch_title, reference_no, agent_name, destination, notes, header_image_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        data.batch_title,
        data.reference_no,
        data.agent_name,
        data.destination,
        data.notes,
        data.header_image_url,
        userId || null,
      ]
    )
    const id = created.rows[0].id
    await insertRows(client, id, data.rows)
    await client.query('COMMIT')
    return getBatch(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function updateBatch(id, payload) {
  const data = validateBatchPayload(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE amazon_ksa_rto_label_batches
       SET batch_title = $2,
           reference_no = $3,
           agent_name = $4,
           destination = $5,
           notes = $6,
           header_image_url = COALESCE(NULLIF($7, ''), header_image_url),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id, data.batch_title, data.reference_no, data.agent_name, data.destination, data.notes, data.header_image_url]
    )
    if (!updated.rows.length) {
      const err = new Error('Batch not found.')
      err.status = 404
      throw err
    }
    await replaceRowsPreservingFiles(client, id, data.rows)
    await client.query('COMMIT')
    return getBatch(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function deleteBatch(id) {
  const files = await query(`SELECT file_url FROM amazon_ksa_rto_label_files WHERE batch_id = $1`, [id])
  for (const file of files.rows) {
    await s3Service.deleteObjectIfExists(file.file_url).catch(() => {})
  }
  await query(`DELETE FROM amazon_ksa_rto_label_batches WHERE id = $1`, [id])
}

function validateUpload(fileType, file) {
  if (!file) {
    const err = new Error('Upload a file first.')
    err.status = 400
    throw err
  }
  if ([FILE_TYPE_HEADER_IMAGE, FILE_TYPE_BATCH_HEADER, FILE_TYPE_PRODUCT_IMAGE].includes(fileType)) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const err = new Error('Image upload must be PNG, JPG, or WebP.')
      err.status = 400
      throw err
    }
  } else if ([FILE_TYPE_FNSKU_LABEL_PDF, 'fnsku_pdf'].includes(fileType)) {
    if (file.mimetype !== 'application/pdf') {
      const err = new Error('FNSKU label upload must be a PDF.')
      err.status = 400
      throw err
    }
  } else {
    const err = new Error('Invalid file type.')
    err.status = 400
    throw err
  }
}

async function rowFilesForRow(rowId) {
  const result = await query(
    `SELECT * FROM amazon_ksa_rto_label_files
     WHERE row_id = $1 AND file_type IN ('product_image', 'fnsku_label_pdf')
     ORDER BY created_at DESC, id DESC`,
    [rowId]
  )
  return Promise.all(result.rows.map(mapFile))
}

async function refreshRowStatus(rowId) {
  const rowResult = await query(`SELECT * FROM amazon_ksa_rto_label_rows WHERE id = $1`, [rowId])
  if (!rowResult.rows.length) return null
  const files = await rowFilesForRow(rowId)
  const nextStatus = statusForRow({
    product_code: rowResult.rows[0].product_code,
    fnsku_no: rowResult.rows[0].fnsku_no,
    quantity: rowResult.rows[0].quantity,
    productImage: files.find((file) => file.fileType === FILE_TYPE_PRODUCT_IMAGE),
    labelPdf: files.find((file) => file.fileType === FILE_TYPE_FNSKU_LABEL_PDF),
  })
  const updated = await query(
    `UPDATE amazon_ksa_rto_label_rows
     SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [rowId, nextStatus]
  )
  return mapRow(updated.rows[0], files)
}

async function uploadFile(batchId, fileType, file, userId) {
  const exists = await query(`SELECT id FROM amazon_ksa_rto_label_batches WHERE id = $1`, [batchId])
  if (!exists.rows.length) {
    const err = new Error('Batch not found.')
    err.status = 404
    throw err
  }
  validateUpload(fileType, file)
  const key = s3Service.createAmazonKsaRtoLabelKey(batchId, fileType, file.originalname)
  await s3Service.putObjectBuffer({ key, body: file.buffer, contentType: file.mimetype })
  const inserted = await query(
    `INSERT INTO amazon_ksa_rto_label_files
      (batch_id, file_type, file_name, file_url, file_size, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [batchId, fileType, file.originalname, key, file.size || null, file.mimetype || null, userId || null]
  )
  if ([FILE_TYPE_HEADER_IMAGE, FILE_TYPE_BATCH_HEADER].includes(fileType)) {
    await query(`UPDATE amazon_ksa_rto_label_batches SET header_image_url = $2, updated_at = NOW() WHERE id = $1`, [
      batchId,
      key,
    ])
  }
  return mapFile(inserted.rows[0])
}

async function uploadRowFile(batchId, rowId, fileType, file, userId) {
  if (![FILE_TYPE_PRODUCT_IMAGE, FILE_TYPE_FNSKU_LABEL_PDF].includes(fileType)) {
    const err = new Error('file_type must be product_image or fnsku_label_pdf.')
    err.status = 400
    throw err
  }
  validateUpload(fileType, file)
  const rowResult = await query(
    `SELECT id, batch_id FROM amazon_ksa_rto_label_rows WHERE id = $1 AND batch_id = $2`,
    [rowId, batchId]
  )
  if (!rowResult.rows.length) {
    const err = new Error('Row not found for this batch.')
    err.status = 404
    throw err
  }

  const existing = await query(
    `SELECT * FROM amazon_ksa_rto_label_files
     WHERE batch_id = $1 AND row_id = $2 AND file_type = $3`,
    [batchId, rowId, fileType]
  )
  for (const old of existing.rows) {
    await s3Service.deleteObjectIfExists(old.file_url).catch(() => {})
  }
  await query(
    `DELETE FROM amazon_ksa_rto_label_files
     WHERE batch_id = $1 AND row_id = $2 AND file_type = $3`,
    [batchId, rowId, fileType]
  )

  const key = s3Service.createAmazonKsaRtoLabelKey(batchId, fileType, file.originalname, rowId)
  await s3Service.putObjectBuffer({ key, body: file.buffer, contentType: file.mimetype })
  const inserted = await query(
    `INSERT INTO amazon_ksa_rto_label_files
      (batch_id, row_id, file_type, file_name, file_url, file_size, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [batchId, rowId, fileType, file.originalname, key, file.size || null, file.mimetype || null, userId || null]
  )
  const mapped = await mapFile(inserted.rows[0])
  const row = await refreshRowStatus(rowId)
  return { file: mapped, row }
}

async function deleteFile(fileId) {
  const result = await query(`SELECT * FROM amazon_ksa_rto_label_files WHERE id = $1`, [fileId])
  if (!result.rows.length) return
  const file = result.rows[0]
  await s3Service.deleteObjectIfExists(file.file_url).catch(() => {})
  await query(`DELETE FROM amazon_ksa_rto_label_files WHERE id = $1`, [fileId])
  if (file.file_type === 'header_image') {
    await query(
      `UPDATE amazon_ksa_rto_label_batches
       SET header_image_url = NULL, updated_at = NOW()
       WHERE id = $1 AND header_image_url = $2`,
      [file.batch_id, file.file_url]
    )
  }
}

async function deleteRowFile(fileId) {
  const result = await query(`SELECT * FROM amazon_ksa_rto_label_files WHERE id = $1`, [fileId])
  if (!result.rows.length) return null
  const file = result.rows[0]
  if (![FILE_TYPE_PRODUCT_IMAGE, FILE_TYPE_FNSKU_LABEL_PDF].includes(file.file_type)) {
    const err = new Error('File is not a row-level SKU file.')
    err.status = 400
    throw err
  }
  await s3Service.deleteObjectIfExists(file.file_url).catch(() => {})
  await query(`DELETE FROM amazon_ksa_rto_label_files WHERE id = $1`, [fileId])
  return refreshRowStatus(file.row_id)
}

module.exports = {
  DEFAULT_DESTINATION,
  STATUS_READY,
  STATUS_MISSING_PRODUCT_CODE,
  STATUS_MISSING_FNSKU,
  STATUS_MISSING_IMAGE,
  STATUS_MISSING_PDF,
  STATUS_INVALID_QTY,
  FILE_TYPE_PRODUCT_IMAGE,
  FILE_TYPE_FNSKU_LABEL_PDF,
  ensureAmazonKsaRtoLabelingTables,
  listBatches,
  getBatch,
  createBatch,
  updateBatch,
  deleteBatch,
  uploadFile,
  uploadRowFile,
  deleteFile,
  deleteRowFile,
  statusForRow,
}

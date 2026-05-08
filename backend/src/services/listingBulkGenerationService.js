const { query } = require('../db')
const { runOpenAiJsonChat } = require('./aiRequestService')
const { qualityCheck } = require('./listingValidationService')
const { getBatchColumns, refreshBatchSummary, rowToClient } = require('./listingBatchService')

const CONTENT_FIELD_KEYS = [
  'item_name',
  'product_description',
  'bullet_point_1',
  'bullet_point_2',
  'bullet_point_3',
  'bullet_point_4',
  'bullet_point_5',
  'generic_keywords',
  'search_terms',
  'arabic_title',
  'arabic_bullet_point_1',
  'arabic_bullet_point_2',
  'arabic_bullet_point_3',
  'arabic_bullet_point_4',
  'arabic_bullet_point_5',
]

const jobs = new Map()

function modeConfig(mode) {
  if (mode === 'fast') return { concurrency: 5, maxRetries: 1 }
  if (mode === 'careful') return { concurrency: 2, maxRetries: 2 }
  return { concurrency: 3, maxRetries: 2 }
}

function wantedContentKeys(columns, only = '') {
  const active = new Set(columns.map((c) => c.key))
  let keys = CONTENT_FIELD_KEYS.filter((key) => active.has(key))
  if (only === 'title') keys = keys.filter((key) => key === 'item_name' || key === 'arabic_title')
  if (only === 'bullets') keys = keys.filter((key) => key.includes('bullet'))
  if (only === 'description') keys = keys.filter((key) => key === 'product_description')
  if (only === 'arabic') keys = keys.filter((key) => key.startsWith('arabic'))
  return keys
}

function systemPrompt(keys) {
  return `You are a senior Amazon marketplace copywriter for Life Smile products.
Return JSON only. Generate values only for these flat-file columns: ${keys.join(', ')}.
Never generate SKU, product IDs, browse nodes, price, compliance, fulfillment, listing action, or business identity fields.
Rules:
- item_name/title must start with LIFE SMILE.
- For cookware sets, include Cookware Set, Cooking Set, and Pots and Pans Set where applicable.
- Use only supplied row data; do not invent unsupported claims.
- Keep bullets concise and Amazon-safe.`
}

function buildPayload(row, keys) {
  return JSON.stringify(
    {
      sku: row.sku,
      source_fields: row.current_values || {},
      generate_columns: keys,
    },
    null,
    2
  )
}

function normalizeGenerated(data, keys) {
  const out = {}
  for (const key of keys) {
    const val = data?.[key]
    if (Array.isArray(val)) out[key] = val.join(' ')
    else out[key] = val == null ? '' : String(val).trim()
  }
  if (!out.item_name && data?.title && keys.includes('item_name')) out.item_name = String(data.title).trim()
  if (Array.isArray(data?.bullet_points)) {
    for (let i = 1; i <= 5; i++) {
      const key = `bullet_point_${i}`
      if (keys.includes(key) && !out[key]) out[key] = String(data.bullet_points[i - 1] || '').trim()
    }
  }
  if (!out.product_description && data?.description && keys.includes('product_description')) {
    out.product_description = String(data.description).trim()
  }
  return out
}

async function generateOneRow(batchId, rowId, { reqUser, only = '', cachedSettings } = {}) {
  const columns = await getBatchColumns(batchId)
  const keys = wantedContentKeys(columns, only)
  if (keys.length === 0) {
    const err = new Error('No AI content columns are active in this flat file')
    err.code = 'NO_CONTENT_COLUMNS'
    throw err
  }
  const r = await query(`SELECT * FROM listing_batch_rows WHERE batch_id = $1 AND id = $2`, [batchId, rowId])
  const row = r.rows[0]
  if (!row) return null
  await query(`UPDATE listing_batch_rows SET status = 'Generating', updated_at = NOW() WHERE id = $1`, [rowId])
  try {
    const ai = await runOpenAiJsonChat({
      reqUser,
      moduleName: 'amazon_listing',
      actionName: 'bulk_generate_listing',
      messages: [
        { role: 'system', content: systemPrompt(keys) },
        { role: 'user', content: `Flat-file row data:\n${buildPayload(row, keys)}\nReturn a JSON object keyed by column name.` },
      ],
      temperature: 0.22,
      maxRetries: 1,
      timeoutMs: 120000,
      cachedSettings,
    })
    const generated = normalizeGenerated(ai.data, keys)
    const current = { ...(row.current_values || {}) }
    const source = { ...(row.source_map || {}) }
    for (const [key, val] of Object.entries(generated)) {
      if (val) {
        current[key] = val
        source[key] = 'AI Generated'
      }
    }
    const quality = qualityCheck(current, columns)
    const status = quality.level === 'high' ? 'Generated' : 'Needs Review'
    const updated = await query(
      `UPDATE listing_batch_rows
       SET current_values = $3::jsonb, generated_values = $4::jsonb, source_map = $5::jsonb,
           quality = $6::jsonb, status = $7, ai_usage_log_id = $8, ai_model = $9,
           estimated_cost_usd = $10, generated_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE batch_id = $1 AND id = $2
       RETURNING *`,
      [
        batchId,
        rowId,
        JSON.stringify(current),
        JSON.stringify({ ...(row.generated_values || {}), ...generated }),
        JSON.stringify(source),
        JSON.stringify(quality),
        status,
        ai.usageLogId,
        ai.model,
        ai.estimatedCostUsd,
      ]
    )
    await refreshBatchSummary(batchId)
    return rowToClient(updated.rows[0])
  } catch (err) {
    await query(
      `UPDATE listing_batch_rows
       SET status = 'Failed', retry_count = retry_count + 1, last_error = $3, updated_at = NOW()
       WHERE batch_id = $1 AND id = $2`,
      [batchId, rowId, String(err.message || err).slice(0, 2000)]
    )
    await refreshBatchSummary(batchId)
    throw err
  }
}

async function startGeneration(batchId, { reqUser, mode = 'balanced', rowIds = [] } = {}) {
  if (jobs.has(String(batchId))) return jobs.get(String(batchId))
  const cfg = modeConfig(mode)
  const params = [batchId]
  let where = `batch_id = $1 AND status IN ('Ready','Imported','Failed','Needs Review')`
  if (Array.isArray(rowIds) && rowIds.length > 0) {
    params.push(rowIds.map(Number).filter(Boolean))
    where += ` AND id = ANY($2::int[])`
  }
  const rows = await query(`SELECT id FROM listing_batch_rows WHERE ${where} ORDER BY row_index ASC`, params)
  await query(`UPDATE listing_batch_rows SET status = 'Queued', updated_at = NOW() WHERE ${where}`, params)
  const job = {
    batchId: Number(batchId),
    mode,
    total: rows.rows.length,
    completed: 0,
    failed: 0,
    running: true,
    cancelled: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  jobs.set(String(batchId), job)
  const queue = rows.rows.map((r) => r.id)
  let cursor = 0
  async function worker() {
    while (!job.cancelled && cursor < queue.length) {
      const rowId = queue[cursor++]
      let ok = false
      for (let attempt = 0; attempt <= cfg.maxRetries && !ok; attempt++) {
        try {
          await generateOneRow(batchId, rowId, { reqUser })
          ok = true
        } catch (_) {
          if (attempt >= cfg.maxRetries) job.failed += 1
        }
      }
      job.completed += 1
      job.updatedAt = new Date().toISOString()
    }
  }
  Promise.all(Array.from({ length: Math.min(cfg.concurrency, queue.length) }, () => worker()))
    .finally(async () => {
      job.running = false
      job.updatedAt = new Date().toISOString()
      await refreshBatchSummary(batchId)
    })
    .catch(() => {})
  return job
}

function getGenerationJob(batchId) {
  return jobs.get(String(batchId)) || null
}

function cancelGenerationJob(batchId) {
  const job = jobs.get(String(batchId))
  if (job) job.cancelled = true
  return job || null
}

module.exports = {
  generateOneRow,
  startGeneration,
  getGenerationJob,
  cancelGenerationJob,
}

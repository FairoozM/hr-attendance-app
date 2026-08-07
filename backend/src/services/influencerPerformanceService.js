const { query, pool, ensureInfluencerPerformanceRecordsTable } = require('../db')
const influencersService = require('./influencersService')

/**
 * Performance metrics are stored as opaque JSONB; ranking and totals are computed on the frontend.
 * @typedef {object} PerformanceRecordInput
 * @property {string} [id]
 * @property {string} [contractId]
 * @property {string} [influencerId]
 * @property {string} [date]
 * @property {string} [contractStartDate]
 * @property {string} [contractEndDate]
 * @property {number|string} [monitoringDays]
 * @property {number|string} [views]
 * @property {number|string} [likes]
 * @property {number|string} [comments]
 * @property {number|string} [shares]
 * @property {number|string} [salesAed]
 * @property {number|string} [cost]
 * @property {number|string} [netProfitAed]
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function coerceMetric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * @param {unknown} value
 * @returns {string} YYYY-MM-DD or ''
 */
function isoDateSlice(value) {
  if (value == null || value === '') return ''
  const s = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function normalizeContractUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    return `${hostname}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return normalizeText(raw).replace(/[?#].*$/, '')
  }
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'contract'
}

function contractSignature(record = {}) {
  const influencerId = record.influencerId || 'unknown'
  const url = normalizeContractUrl(record.postUrl)
  if (url) return `${influencerId}::url::${url}`
  return `${influencerId}::video::${normalizeText(record.videoTitle || record.campaignName || 'video')}`
}

function ensureContractId(record = {}) {
  const existing = String(record.contractId || '').trim()
  if (existing.startsWith('ip-contract::')) return existing
  const start = isoDateSlice(record.contractStartDate || record.date) || 'unknown-date'
  return `ip-contract::${slug(contractSignature(record))}::${start}`
}

async function upsertContractFromRecord(record, updatedByUserId) {
  const contractId = ensureContractId(record)
  const start = isoDateSlice(record.contractStartDate || record.date) || null
  const monitoringDays = Number.parseInt(String(record.monitoringDays || 5), 10)
  const validDays = Number.isFinite(monitoringDays) ? Math.max(3, Math.min(5, monitoringDays)) : 5
  const endIso = isoDateSlice(record.contractEndDate)
  const body = {
    id: contractId,
    influencerId: record.influencerId,
    platform: record.platform || '',
    campaignName: record.campaignName || '',
    videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
    postUrl: record.postUrl || '',
    contractStartDate: start,
    contractEndDate: endIso || null,
    monitoringDays: validDays,
  }
  await query(
    `INSERT INTO influencer_performance_contracts
       (id, influencer_id, platform, campaign_name, video_title, post_url, contract_start_date, monitoring_days, body, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::jsonb, NOW(), $10)
     ON CONFLICT (id) DO UPDATE SET
       influencer_id = EXCLUDED.influencer_id,
       platform = COALESCE(NULLIF(influencer_performance_contracts.platform, ''), EXCLUDED.platform),
       campaign_name = COALESCE(NULLIF(influencer_performance_contracts.campaign_name, ''), EXCLUDED.campaign_name),
       video_title = COALESCE(NULLIF(influencer_performance_contracts.video_title, ''), EXCLUDED.video_title),
       post_url = COALESCE(NULLIF(influencer_performance_contracts.post_url, ''), EXCLUDED.post_url),
       contract_start_date = LEAST(COALESCE(influencer_performance_contracts.contract_start_date, EXCLUDED.contract_start_date), EXCLUDED.contract_start_date),
       monitoring_days = GREATEST(influencer_performance_contracts.monitoring_days, EXCLUDED.monitoring_days),
       body = influencer_performance_contracts.body || EXCLUDED.body,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [contractId, record.influencerId, body.platform, body.campaignName, body.videoTitle, body.postUrl, start, validDays, JSON.stringify(body), updatedByUserId]
  )
  return contractId
}

async function listPerformanceRecords() {
  await ensureInfluencerPerformanceRecordsTable()
  const result = await query(
    `SELECT id, contract_id, body, updated_at FROM influencer_performance_records ORDER BY check_date DESC NULLS LAST, id`
  )
  return result.rows.map((row) => {
    const body = row.body && typeof row.body === 'object' ? row.body : {}
    return {
      ...body,
      id: row.id,
      contractId: body.contractId || row.contract_id || ensureContractId(body),
      updatedAt: body.updatedAt || row.updated_at,
    }
  })
}

async function listPerformanceContracts() {
  await ensureInfluencerPerformanceRecordsTable()
  const result = await query(
    `SELECT id, body, updated_at FROM influencer_performance_contracts ORDER BY contract_start_date DESC NULLS LAST, id`
  )
  return result.rows.map((row) => ({
    ...(row.body && typeof row.body === 'object' ? row.body : {}),
    id: row.id,
    updatedAt: row.updated_at,
  }))
}

async function getPerformanceRecordBodyById(recordId) {
  await ensureInfluencerPerformanceRecordsTable()
  const id = String(recordId || '').trim()
  if (!id) return null
  const r = await query(`SELECT body FROM influencer_performance_records WHERE id = $1`, [id])
  const body = r.rows[0]?.body
  return body && typeof body === 'object' ? body : null
}

async function getTombstonedRecordIds(ids) {
  const cleanIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)))
  if (!cleanIds.length) return new Set()
  const r = await query(
    `SELECT id FROM influencer_performance_record_tombstones WHERE id = ANY($1::text[])`,
    [cleanIds],
  )
  return new Set(r.rows.map((row) => String(row.id)))
}

/**
 * Upserts records; skips rows whose influencer id is not in the influencers snapshot.
 */
async function bulkUpsertPerformanceRecords(records, updatedByUserId, isAdmin = false) {
  await ensureInfluencerPerformanceRecordsTable()
  if (!Array.isArray(records) || records.length === 0) {
    return { upserted: 0, skipped: 0, skippedTombstoned: 0, skippedTombstonedIds: [] }
  }

  let upserted = 0
  let skipped = 0
  let skippedTombstoned = 0
  const skippedTombstonedIds = []
  const uid =
    updatedByUserId != null && String(updatedByUserId).trim() !== ''
      ? Number.parseInt(String(updatedByUserId), 10)
      : null
  const validUid = Number.isFinite(uid) ? uid : null
  const incomingIds = records.map((record) => (record && record.id != null ? String(record.id).trim() : ''))
  const tombstonedIds = await getTombstonedRecordIds(incomingIds)

  for (const raw of records) {
    if (!raw || typeof raw !== 'object') {
      skipped++
      continue
    }
    const id = raw.id != null ? String(raw.id).trim() : ''
    const influencerId = raw.influencerId != null ? String(raw.influencerId).trim() : ''
    const checkDate = isoDateSlice(raw.date)
    if (!id || !influencerId || !checkDate) {
      skipped++
      continue
    }
    if (tombstonedIds.has(id)) {
      skipped++
      skippedTombstoned++
      skippedTombstonedIds.push(id)
      continue
    }

    const exists = await influencersService.getInfluencerById(influencerId)
    if (!exists) {
      skipped++
      continue
    }

    const contractId = await upsertContractFromRecord({ ...raw, id, influencerId, date: checkDate }, validUid)
    /** Persist numeric metrics as finite numbers (or omit invalid values). Rankings stay client-side. */
    const body = {
      ...raw,
      id,
      contractId,
      influencerId,
      date: checkDate,
      views: coerceMetric(raw.views),
      likes: coerceMetric(raw.likes),
      comments: coerceMetric(raw.comments),
      shares: coerceMetric(raw.shares),
      saves: coerceMetric(raw.saves),
      salesAed: coerceMetric(raw.salesAed),
      cost: coerceMetric(raw.cost),
      storyViews: coerceMetric(raw.storyViews),
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'netProfitAed')) {
      body.netProfitAed = coerceMetric(raw.netProfitAed)
    }
    if (!isAdmin) {
      delete body.netProfitAed
      const previous = await getPerformanceRecordBodyById(id)
      if (previous && Object.prototype.hasOwnProperty.call(previous, 'netProfitAed')) {
        body.netProfitAed = previous.netProfitAed
      }
    }
    await query(
      `INSERT INTO influencer_performance_records (id, contract_id, influencer_id, check_date, body, updated_at, updated_by)
       VALUES ($1, $2, $3, $4::date, $5::jsonb, NOW(), $6)
       ON CONFLICT (id) DO UPDATE SET
         contract_id = EXCLUDED.contract_id,
         influencer_id = EXCLUDED.influencer_id,
         check_date = EXCLUDED.check_date,
         body = EXCLUDED.body,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [id, contractId, influencerId, checkDate, JSON.stringify(body), validUid]
    )
    upserted++
  }

  return { upserted, skipped, skippedTombstoned, skippedTombstonedIds }
}

async function deletePerformanceRecord(recordId, updatedByUserId) {
  await ensureInfluencerPerformanceRecordsTable()
  const id = String(recordId || '').trim()
  if (!id) return { deleted: false }
  const uid =
    updatedByUserId != null && String(updatedByUserId).trim() !== ''
      ? Number.parseInt(String(updatedByUserId), 10)
      : null
  const validUid = Number.isFinite(uid) ? uid : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(`DELETE FROM influencer_performance_records WHERE id = $1`, [id])
    await client.query(
      `INSERT INTO influencer_performance_record_tombstones (id, deleted_by)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [id, validUid],
    )
    await client.query('COMMIT')
    return { deleted: r.rowCount > 0 }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  listPerformanceRecords,
  listPerformanceContracts,
  bulkUpsertPerformanceRecords,
  deletePerformanceRecord,
  getTombstonedRecordIds,
}

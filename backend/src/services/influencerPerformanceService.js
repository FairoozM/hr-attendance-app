const { query, ensureInfluencerPerformanceRecordsTable } = require('../db')
const influencersService = require('./influencersService')

function isoDateSlice(value) {
  if (value == null || value === '') return ''
  const s = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

async function listPerformanceRecords() {
  await ensureInfluencerPerformanceRecordsTable()
  const result = await query(
    `SELECT id, body, updated_at, updated_by FROM influencer_performance_records ORDER BY check_date DESC NULLS LAST, id`
  )
  return result.rows.map((row) => {
    const body = row.body && typeof row.body === 'object' ? row.body : {}
    const savedByUserId = row.updated_by != null ? Number(row.updated_by) : null
    return {
      ...body,
      id: row.id,
      updatedAt: body.updatedAt || row.updated_at,
      savedByUserId: Number.isFinite(savedByUserId) ? savedByUserId : null,
    }
  })
}

/**
 * Upserts records; skips rows whose influencer id is not in the influencers snapshot.
 */
async function bulkUpsertPerformanceRecords(records, updatedByUserId) {
  await ensureInfluencerPerformanceRecordsTable()
  if (!Array.isArray(records) || records.length === 0) {
    return { upserted: 0, skipped: 0 }
  }

  let upserted = 0
  let skipped = 0
  const uid =
    updatedByUserId != null && String(updatedByUserId).trim() !== ''
      ? Number.parseInt(String(updatedByUserId), 10)
      : null
  const validUid = Number.isFinite(uid) ? uid : null

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

    const exists = await influencersService.getInfluencerById(influencerId)
    if (!exists) {
      skipped++
      continue
    }

    const body = { ...raw, id, influencerId, date: checkDate }
    await query(
      `INSERT INTO influencer_performance_records (id, influencer_id, check_date, body, updated_at, updated_by)
       VALUES ($1, $2, $3::date, $4::jsonb, NOW(), $5)
       ON CONFLICT (id) DO UPDATE SET
         influencer_id = EXCLUDED.influencer_id,
         check_date = EXCLUDED.check_date,
         body = EXCLUDED.body,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [id, influencerId, checkDate, JSON.stringify(body), validUid]
    )
    upserted++
  }

  return { upserted, skipped }
}

async function deletePerformanceRecord(recordId, _updatedByUserId) {
  await ensureInfluencerPerformanceRecordsTable()
  const id = String(recordId || '').trim()
  if (!id) return { deleted: false }
  const r = await query(`DELETE FROM influencer_performance_records WHERE id = $1`, [id])
  return { deleted: r.rowCount > 0 }
}

module.exports = {
  listPerformanceRecords,
  bulkUpsertPerformanceRecords,
  deletePerformanceRecord,
}

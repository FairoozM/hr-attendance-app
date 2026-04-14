const { query, ensureInfluencersSnapshotTable } = require('../db')

const SNAPSHOT_ID = 1

async function getInfluencers() {
  await ensureInfluencersSnapshotTable()
  const result = await query('SELECT body FROM influencers_snapshot WHERE id = $1', [SNAPSHOT_ID])
  if (!result.rows.length) return []
  const body = result.rows[0].body
  return Array.isArray(body) ? body : []
}

async function replaceInfluencers(list) {
  await ensureInfluencersSnapshotTable()
  await query(
    `INSERT INTO influencers_snapshot (id, body, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
    [SNAPSHOT_ID, JSON.stringify(list)]
  )
}

module.exports = { getInfluencers, replaceInfluencers }

const { query, ensureInfluencersSnapshotTable } = require('../db')

const SNAPSHOT_ID = 1

function rowTimestamp(r) {
  const u = r?.updatedAt || r?.createdAt
  const n = u ? new Date(u).getTime() : 0
  return Number.isNaN(n) ? 0 : n
}

/**
 * Union-merge: keeps every id that exists on either side. When both have the same id,
 * the row with the newer updatedAt (or createdAt) wins; ties prefer the incoming row.
 * Prevents a stale client/tab from replacing the whole snapshot with an older list and
 * dropping rows another session just saved.
 */
function mergeSnapshotsPreferNewer(existing, incoming) {
  const byId = new Map()
  for (const r of existing || []) {
    if (r && r.id != null) byId.set(String(r.id), r)
  }
  for (const r of incoming || []) {
    if (!r || r.id == null) continue
    const id = String(r.id)
    const cur = byId.get(id)
    if (!cur || rowTimestamp(r) >= rowTimestamp(cur)) {
      byId.set(id, r)
    }
  }
  return Array.from(byId.values())
}

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

/** Loads current snapshot, merges incoming rows (prefer newer timestamps), persists, returns merged list. */
async function mergeInfluencersWithSnapshot(incoming) {
  const existing = await getInfluencers()
  const merged = mergeSnapshotsPreferNewer(existing, incoming)
  await replaceInfluencers(merged)
  return merged
}

async function removeInfluencerById(id) {
  const sid = String(id).trim()
  if (!sid) return
  const list = await getInfluencers()
  const next = list.filter((r) => r && String(r.id) !== sid)
  await replaceInfluencers(next)
}

module.exports = {
  getInfluencers,
  replaceInfluencers,
  mergeInfluencersWithSnapshot,
  removeInfluencerById,
}

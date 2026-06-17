#!/usr/bin/env node
/**
 * One-time cleanup for a stale Influencer Performance record that can resurrect
 * from old per-user preference caches.
 */
'use strict'

require('dotenv').config()

const { pool, ensureInfluencerPerformanceRecordsTable } = require('../src/db')

const BAD_RECORD_ID = '79420445-a765-4f49-8f63-e130002e5a24'
const AFFECTED_USER_IDS = [1, 6, 8]
const PREF_KEY = 'influencer_performance_v1'

async function main() {
  await ensureInfluencerPerformanceRecordsTable()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const deleted = await client.query(
      `DELETE FROM influencer_performance_records WHERE id = $1`,
      [BAD_RECORD_ID],
    )
    await client.query(
      `INSERT INTO influencer_performance_record_tombstones (id, deleted_by)
       VALUES ($1, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [BAD_RECORD_ID],
    )
    const prefs = await client.query(
      `
        UPDATE user_preferences
        SET pref_value = jsonb_set(
          jsonb_set(
            pref_value::jsonb,
            '{records}',
            (
              SELECT COALESCE(jsonb_agg(record), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(pref_value::jsonb->'records', '[]'::jsonb)) AS record
              WHERE record->>'id' <> $1
            ),
            true
          ),
          '{tombstones}',
          COALESCE(pref_value::jsonb->'tombstones', '{}'::jsonb) || jsonb_build_object($1, EXTRACT(EPOCH FROM NOW())::bigint * 1000),
          true
        )
        WHERE pref_key = $2
          AND user_id = ANY($3::int[])
      `,
      [BAD_RECORD_ID, PREF_KEY, AFFECTED_USER_IDS],
    )

    await client.query('COMMIT')
    console.log(JSON.stringify({
      recordId: BAD_RECORD_ID,
      deletedPerformanceRows: deleted.rowCount,
      updatedPreferenceRows: prefs.rowCount,
      affectedUserIds: AFFECTED_USER_IDS,
    }, null, 2))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * Copy weekly_ads_report_history rows from SOURCE_DATABASE_URL into DATABASE_URL
 * (or TARGET_DATABASE_URL). Inserts only when (user_id, client_id) is missing on
 * the target — existing rows are left unchanged.
 *
 * Typical recovery after restoring an old pg_dump into a throwaway database:
 *
 *   SOURCE_DATABASE_URL='postgres://...restore...' \
 *   DATABASE_URL='postgres://...production...' \
 *   node backend/scripts/mergeWeeklyAdsReportHistoryFromDatabase.js
 *
 * Dry run (counts only):
 *
 *   ... node backend/scripts/mergeWeeklyAdsReportHistoryFromDatabase.js --dry-run
 */
'use strict'

const path = require('path')
const { Client } = require('pg')
const { buildPoolConfig } = require('../src/db/dbConnectionConfig')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const dryRun = process.argv.includes('--dry-run')

async function tableExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  )
  return rows.length > 0
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL
  const targetUrl = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL
  if (!sourceUrl || !targetUrl) {
    console.error(
      'Set SOURCE_DATABASE_URL (restored backup DB) and DATABASE_URL or TARGET_DATABASE_URL (destination).',
    )
    process.exit(1)
  }
  if (sourceUrl === targetUrl) {
    console.error('SOURCE_DATABASE_URL must differ from the destination URL.')
    process.exit(1)
  }

  const src = new Client(buildPoolConfig(sourceUrl).poolConfig)
  const dst = new Client(buildPoolConfig(targetUrl).poolConfig)
  await src.connect()
  await dst.connect()

  if (!(await tableExists(src, 'weekly_ads_report_history'))) {
    console.error('Source has no table weekly_ads_report_history.')
    await src.end()
    await dst.end()
    process.exit(1)
  }
  if (!(await tableExists(dst, 'weekly_ads_report_history'))) {
    console.error('Target has no table weekly_ads_report_history (run the app migrations / ensureWeeklyAdsReportHistoryTable).')
    await src.end()
    await dst.end()
    process.exit(1)
  }

  const { rows } = await src.query(
    `SELECT user_id, client_id, title, start_date, end_date, rows, notes, saved_at, updated_at
     FROM weekly_ads_report_history`,
  )

  let inserted = 0
  let skipped = 0
  for (const r of rows) {
    if (dryRun) {
      const check = await dst.query(
        `SELECT 1 FROM weekly_ads_report_history WHERE user_id = $1 AND client_id = $2`,
        [r.user_id, r.client_id],
      )
      if (check.rowCount) skipped += 1
      else inserted += 1
      continue
    }
    const res = await dst.query(
      `INSERT INTO weekly_ads_report_history (user_id, client_id, title, start_date, end_date, rows, notes, saved_at, updated_at)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::jsonb, $7, COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW()))
       ON CONFLICT (user_id, client_id) DO NOTHING`,
      [
        r.user_id,
        r.client_id,
        r.title,
        r.start_date,
        r.end_date,
        JSON.stringify(r.rows),
        r.notes,
        r.saved_at,
        r.updated_at,
      ],
    )
    if (res.rowCount) inserted += 1
    else skipped += 1
  }

  await src.end()
  await dst.end()

  if (dryRun) {
    console.log(
      `weekly_ads_report_history: ${rows.length} rows on source — ${inserted} missing on target (would insert), ${skipped} already on target.`,
    )
    console.log('Re-run without --dry-run to apply.')
  } else {
    console.log(
      `weekly_ads_report_history: ${rows.length} rows on source — inserted ${inserted}, skipped ${skipped} (already on target).`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

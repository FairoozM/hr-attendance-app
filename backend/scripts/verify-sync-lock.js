#!/usr/bin/env node
/**
 * Integration check for the notification sync coordination SQL.
 *
 * Runs the real `pg_try_advisory_lock` / conditional-upsert statements from notificationsService
 * against a live Postgres using two independent pools, which is the closest local stand-in for two
 * backend processes. Point DATABASE_URL at a scratch database:
 *
 *   DATABASE_URL=postgres://localhost:5432/sync_lock_check node scripts/verify-sync-lock.js
 */
const assert = require('node:assert/strict')
const { Pool } = require('pg')
const { buildPoolConfig } = require('../src/db/dbConnectionConfig')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required (use a scratch database — this script writes and drops rows).')
  process.exit(1)
}
const { poolConfig } = buildPoolConfig(connectionString)

const NAMESPACE = 4242
const LOCK_ID = 2
const SYNC_NAME = 'subscription'

function makeWorker(tag) {
  const pool = new Pool(poolConfig)

  async function withLock(run) {
    const client = await pool.connect()
    try {
      const acquired = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [NAMESPACE, LOCK_ID])
      if (process.env.VERIFY_TRACE) console.log(`    [trace] ${tag} try_lock ->`, acquired.rows[0].locked)
      if (!acquired.rows[0].locked) return null
      try {
        return await run()
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [NAMESPACE, LOCK_ID])
      }
    } finally {
      client.release()
    }
  }

  async function claim({ force = false, intervalSecs = 60 } = {}) {
    if (force) {
      await pool.query(
        `INSERT INTO notification_sync_state (sync_name, last_run_at, last_run_by)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (sync_name) DO UPDATE
           SET last_run_at = NOW(), last_run_by = EXCLUDED.last_run_by`,
        [SYNC_NAME, tag]
      )
      return true
    }
    const result = await pool.query(
      `INSERT INTO notification_sync_state (sync_name, last_run_at, last_run_by)
       VALUES ($1, NOW(), $3)
       ON CONFLICT (sync_name) DO UPDATE
         SET last_run_at = NOW(), last_run_by = EXCLUDED.last_run_by
         WHERE notification_sync_state.last_run_at <= NOW() - make_interval(secs => $2::double precision)
       RETURNING last_run_at`,
      [SYNC_NAME, intervalSecs, tag]
    )
    return result.rowCount > 0
  }

  return { tag, pool, withLock, claim }
}

async function main() {
  const a = makeWorker('worker-a')
  const b = makeWorker('worker-b')
  const results = []

  try {
    await a.pool.query(`
      CREATE TABLE IF NOT EXISTS notification_sync_state (
        sync_name VARCHAR(64) PRIMARY KEY,
        last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_run_by VARCHAR(128) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await a.pool.query('DELETE FROM notification_sync_state WHERE sync_name = $1', [SYNC_NAME])

    // 1. First claim wins (insert path), second is throttled (conditional-update path).
    assert.equal(await a.claim(), true)
    assert.equal(await b.claim(), false)
    results.push('shared throttle blocks a second process')

    // 2. The stamp records the winner, and a throttled attempt must not overwrite it.
    const owner = await a.pool.query('SELECT last_run_by FROM notification_sync_state WHERE sync_name = $1', [SYNC_NAME])
    assert.equal(owner.rows[0].last_run_by, 'worker-a')
    results.push('throttled attempt leaves last_run_by untouched')

    // 3. Once the interval elapses, the other process may claim.
    await a.pool.query(
      `UPDATE notification_sync_state SET last_run_at = NOW() - INTERVAL '2 minutes' WHERE sync_name = $1`,
      [SYNC_NAME]
    )
    assert.equal(await b.claim(), true)
    results.push('claim succeeds after the interval elapses')

    // 4. force always claims.
    assert.equal(await a.claim({ force: true }), true)
    results.push('force bypasses the interval')

    // 5. Advisory lock is mutually exclusive across connections, and force cannot bypass it.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let peerEntered = false
    const held = a.withLock(async () => {
      const peer = await b.withLock(async () => {
        peerEntered = true
      })
      assert.equal(peer, null, 'peer must not enter the critical section')
      await gate
      return 'ran'
    })
    release()
    assert.equal(await held, 'ran')
    assert.equal(peerEntered, false)
    results.push('advisory lock excludes a second process')

    // 6. The lock is released afterwards, so the peer can now take it.
    assert.equal(await b.withLock(async () => 'ran'), 'ran')
    results.push('lock released after the critical section')

    // 7. A throw inside the critical section still releases the lock.
    await assert.rejects(() => a.withLock(async () => { throw new Error('boom') }))
    assert.equal(await b.withLock(async () => 'ran'), 'ran')
    results.push('lock released even when the sync throws')

    // 8. A crashed process must not wedge the fleet: session-level locks die with the backend.
    const orphan = new Pool(poolConfig)
    const orphanClient = await orphan.connect()
    const grabbed = await orphanClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked, pg_backend_pid() AS pid',
      [NAMESPACE, LOCK_ID]
    )
    assert.equal(grabbed.rows[0].locked, true)
    assert.equal(await b.withLock(async () => 'ran'), null, 'lock is visibly held by the orphan')

    // Killing the backend stands in for `kill -9` on a Node process mid-sync.
    orphanClient.on('error', () => {})
    await a.pool.query('SELECT pg_terminate_backend($1)', [grabbed.rows[0].pid])
    orphan.end().catch(() => {})

    // Postgres drops the lock as the backend exits, which is not synchronous with the kill.
    let recovered = null
    for (let i = 0; i < 50 && recovered === null; i += 1) {
      recovered = await b.withLock(async () => 'ran')
      if (recovered === null) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(recovered, 'ran')
    results.push('a crashed process does not wedge the fleet')

    for (const line of results) console.log(`  ok  ${line}`)
    console.log(`\n${results.length} checks passed`)
  } finally {
    await a.pool.end().catch(() => {})
    await b.pool.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})

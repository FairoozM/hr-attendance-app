'use strict'

/**
 * Cached Stripe payout list (summary only) for Management → Stripe.
 *
 * One row per payout among the latest PAYOUT_LIST_SIZE. Holds Stripe payout fields and the
 * balance-transaction composition shown in the table; no customer, order or secret data.
 * Written only by an explicit refresh; nothing here talks to Zoho or Stripe.
 */

const PAYOUT_LIST_SIZE = 30

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS stripe_payout_list_cache (
     payout_id TEXT PRIMARY KEY CHECK (payout_id LIKE 'po\\_%'),
     status VARCHAR(20) NOT NULL,
     amount_minor BIGINT NOT NULL,
     currency CHAR(3) NOT NULL,
     arrival_date TIMESTAMPTZ,
     stripe_created_at TIMESTAMPTZ,
     automatic BOOLEAN NOT NULL DEFAULT false,
     livemode BOOLEAN NOT NULL DEFAULT false,
     composition JSONB NOT NULL,
     composition_fetched_at TIMESTAMPTZ NOT NULL,
     refreshed_at TIMESTAMPTZ NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_payout_list_cache_created
     ON stripe_payout_list_cache (stripe_created_at DESC, payout_id DESC)`,
]

async function ensureStripePayoutListCacheTables(query) {
  for (const sql of SCHEMA_SQL) await query(sql)
}

function iso(value) {
  return value ? new Date(value).toISOString() : null
}

function mapRow(row) {
  return {
    payoutId: row.payout_id,
    status: row.status,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency || '').trim(),
    arrivalDate: iso(row.arrival_date),
    createdAt: iso(row.stripe_created_at),
    automatic: row.automatic === true,
    livemode: row.livemode === true,
    composition: row.composition,
    compositionFetchedAt: iso(row.composition_fetched_at),
    refreshedAt: iso(row.refreshed_at),
  }
}

/** Newest first, at most PAYOUT_LIST_SIZE rows. */
async function listCachedPayouts(db) {
  const { rows } = await db.query(
    `SELECT * FROM stripe_payout_list_cache
     ORDER BY stripe_created_at DESC NULLS LAST, payout_id DESC
     LIMIT $1`,
    [PAYOUT_LIST_SIZE],
  )
  return rows.map(mapRow)
}

/**
 * Replace the cached list with `payouts` in one transaction: upsert every row and drop
 * payouts that are no longer among the latest. `db` must be a dedicated client.
 * @param {{ query: Function }} db
 * @param {Array<{ payoutId: string, status: string, amountMinor: number, currency: string, arrivalDate: string|null,
 *   createdAt: string|null, automatic?: boolean, livemode?: boolean, composition: object, compositionFetchedAt: string }>} payouts
 * @param {string} refreshedAt ISO timestamp
 */
async function replaceCachedPayouts(db, payouts, refreshedAt) {
  await db.query('BEGIN')
  try {
    for (const p of payouts) {
      await db.query(
        `INSERT INTO stripe_payout_list_cache (payout_id, status, amount_minor, currency, arrival_date, stripe_created_at,
           automatic, livemode, composition, composition_fetched_at, refreshed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
         ON CONFLICT (payout_id) DO UPDATE SET
           status = EXCLUDED.status,
           amount_minor = EXCLUDED.amount_minor,
           currency = EXCLUDED.currency,
           arrival_date = EXCLUDED.arrival_date,
           stripe_created_at = EXCLUDED.stripe_created_at,
           automatic = EXCLUDED.automatic,
           livemode = EXCLUDED.livemode,
           composition = EXCLUDED.composition,
           composition_fetched_at = EXCLUDED.composition_fetched_at,
           refreshed_at = EXCLUDED.refreshed_at`,
        [p.payoutId, p.status, p.amountMinor, p.currency, p.arrivalDate, p.createdAt, p.automatic === true, p.livemode === true,
          JSON.stringify(p.composition), p.compositionFetchedAt, refreshedAt],
      )
    }
    await db.query('DELETE FROM stripe_payout_list_cache WHERE NOT (payout_id = ANY($1::text[]))', [payouts.map((p) => p.payoutId)])
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

module.exports = {
  PAYOUT_LIST_SIZE,
  SCHEMA_SQL,
  ensureStripePayoutListCacheTables,
  listCachedPayouts,
  replaceCachedPayouts,
  mapRow,
}

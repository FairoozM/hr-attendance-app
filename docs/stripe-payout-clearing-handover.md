# Stripe payout clearing — handover (2026-09-29)

## State

- Branch `home/stripe-refunds-20260928`. This commit adds normal-refund clearing (credit note refunds,
  refund fee journals), `POSTING_UNCERTAIN` recovery, and the tightened manual-retry rule.
- Production posting stays **disabled**: `STRIPE_CLEARING_POSTING_ENABLED=false` in
  `/home/ubuntu/hr-attendance-app/backend/.env` (the systemd `EnvironmentFile`).
- Schema 051 (`stripe_payout_refund_components`) and 052 (`POSTING_UNCERTAIN`, recovery/retry
  columns, event `event_type`/`evidence`) are applied by `ensureStripePayoutClearingTables`
  (`SCHEMA_SQL` in `stripePayoutClearingStore.js`). The `.sql` files mirror it.
- Production had 6 component rows for `po_1UJNObDJogiiRoKPHtPAr3KE`, all `VERIFIED`; 0 `FAILED` rows,
  so 052 converted nothing to `POSTING_UNCERTAIN`.

## Recovery / retry rules (do not weaken)

- Deep recovery lookups are complete or they fail: every Zoho list is paged (200 per page, max
  5 pages) and a partial or failed lookup is `RECOVERY_LOOKUP_FAILED`, never a recheck.
- Multiple records with one reference are always a conflict (review), never picked.
- Payments and journals must match reference, customer, accounts, amount, allocations and date.
- "Not created" needs a fresh complete lookup **and** the admin's own Zoho check (time ≥ 15 min
  after the write became uncertain, location, search including the reference, 0 records found).
  The evidence is stored in `retry_authorization_evidence`; the DB rejects an authorization without it.

## Verified read-only against production

All six live components (NET ×2, FEE ×2, customer advance journal, payout fee journal): exact →
VERIFIED, wrong amount/date/account → CONFLICT, unknown reference → MISSING. Credit note refund
matching verified on a real (non-workflow) refund. Pagination verified with forced small pages.

## Tomorrow

1. Example coverage still missing in production:
   - refund fee journal (Dr 1019 / Cr 1013 or reverse) — only an analogue journal was checked;
   - a workflow-created credit note refund;
   - customer advance refund journal (Dr 1123 / Cr 1019).
2. Decide whether the boot schema step (`ensureStripeTables`, non-fatal, no transaction) should run
   in a transaction and stop startup on failure.
3. Posting activation is a separate decision: set `STRIPE_CLEARING_POSTING_ENABLED=true` only after
   the above, then restart `hr-attendance-backend`.
4. Remove the old `hr-lifesmile/assets` bundle only once the new frontend is confirmed (it is kept
   for rollback).

## Rollback

- Backend code: restore the archived files from
  `/home/ubuntu/deploy-backups/stripe-051-052-20260929/` (also in
  `s3://hr-lifesmile-artifacts/rollback/stripe-051-052-20260929/`) and restart the service. The new
  schema can stay (additive columns; constraints only widen) while no `POSTING_UNCERTAIN` rows exist.
- Frontend: re-upload the archived `index.html` to `s3://hr-lifesmile/index.html` and invalidate
  `/index.html`; the previous assets were not deleted.
- Database: RDS snapshot `hr-attendance-production-pre-stripe-051-052-20260929`, only if the schema
  itself must be undone.
- Never reset the host to its Git commit: the host tree is file-synced and its Git HEAD is outdated.

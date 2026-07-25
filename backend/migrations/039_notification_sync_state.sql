-- Fleet-wide coordination for notification source syncs.
--
-- The throttle used to live in each Node process's heap, so every extra process (PM2 worker,
-- container, second EC2 instance) ran its own delete-and-reinsert pass. That is not just wasted
-- writes: subscriptionNotificationsService computes its "active keys" set in JavaScript and then
-- deletes every row outside that set, so two overlapping passes with different snapshots can
-- delete each other's rows. A deleted row is later re-INSERTed fresh, resetting is_read to false
-- and resurfacing an alert the admin had already read.
--
-- This table makes "when did the fleet last sync" shared state. Mutual exclusion itself uses a
-- Postgres advisory lock (see notificationsService.js).

CREATE TABLE IF NOT EXISTS notification_sync_state (
  sync_name VARCHAR(64) PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- host:pid of the process that last claimed the slot, for debugging a noisy fleet.
  last_run_by VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

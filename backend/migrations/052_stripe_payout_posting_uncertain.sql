-- POSTING_UNCERTAIN: a Zoho write whose outcome is unknown (timeout, connection reset, malformed
-- success, success without an ID) and that the immediate Zoho search did not find. Zoho may hold
-- the record, so the component is never re-sent until an admin rechecks Zoho and explicitly
-- confirms, with their own recorded Zoho check, that it was not created (retry_authorized_*,
-- retry_authorization_evidence). request_snapshot is exactly what was sent,
-- so every recheck tests Zoho against the attempt itself, not a later re-plan. Applies to payout
-- components (NET, FEE, CUSTOMER_ADVANCE, PAYOUT_FEE_JOURNAL) and normal refund components
-- (credit note refund, refund fee journal). Additive only. Applied at boot by ensureStripeTables(); this file is the
-- reference migration and is safe to run repeatedly.

ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS first_uncertain_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS uncertain_since TIMESTAMPTZ;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS last_recovery_check_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS recovery_check_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS retry_authorized_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS retry_authorized_by TEXT;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS retry_authorization_reason TEXT;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS retry_authorization_evidence JSONB;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS request_snapshot JSONB;

ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS first_uncertain_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS uncertain_since TIMESTAMPTZ;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS last_recovery_check_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS recovery_check_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS retry_authorized_at TIMESTAMPTZ;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS retry_authorized_by TEXT;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS retry_authorization_reason TEXT;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS retry_authorization_evidence JSONB;
ALTER TABLE stripe_payout_refund_components ADD COLUMN IF NOT EXISTS request_snapshot JSONB;

DO $$
DECLARE
  t TEXT;
  r RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['stripe_payout_clearing_components', 'stripe_payout_refund_components'] LOOP
    -- Replace the unnamed inline status check with a named one that allows POSTING_UNCERTAIN.
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = t::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%''NEEDS_REVIEW''%'
        AND pg_get_constraintdef(oid) NOT LIKE '%POSTING_UNCERTAIN%'
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, r.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = 'ck_' || t || '_status') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN (''PLANNED'', ''POSTING'', ''POSTED'', ''VERIFIED'', ''FAILED'', ''NEEDS_REVIEW'', ''POSTING_UNCERTAIN''))',
        t, 'ck_' || t || '_status');
    END IF;
    -- Rows left FAILED by an unresolved uncertain POST (old "may be retried" path) are not retryable.
    EXECUTE format(
      'UPDATE %I SET status = ''POSTING_UNCERTAIN'', uncertain_since = COALESCE(uncertain_since, updated_at),
              first_uncertain_at = COALESCE(first_uncertain_at, updated_at), updated_at = NOW()
        WHERE status = ''FAILED'' AND retry_authorized_at IS NULL
          AND last_error LIKE ''%%was not re-posted and may be retried%%''', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = 'ck_' || t || '_uncertain') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (status <> ''POSTING_UNCERTAIN'' OR (uncertain_since IS NOT NULL AND first_uncertain_at IS NOT NULL))',
        t, 'ck_' || t || '_uncertain');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = 'ck_' || t || '_retry_auth') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (retry_authorized_at IS NULL OR (retry_authorized_by IS NOT NULL AND retry_authorization_reason IS NOT NULL AND retry_authorization_evidence IS NOT NULL))',
        t, 'ck_' || t || '_retry_auth');
    END IF;
  END LOOP;
END $$;

ALTER TABLE stripe_payout_clearing_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(40);
ALTER TABLE stripe_payout_clearing_events ADD COLUMN IF NOT EXISTS evidence JSONB;

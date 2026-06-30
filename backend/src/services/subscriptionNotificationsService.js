const { query } = require('../db')
const subscriptionService = require('./subscriptionService')
const { getDaysLeft, formatDaysRemaining, subtractDays } = require('./subscriptionUtils')

const NOTIFICATION_TYPE = 'subscription_expiry'
const INVOICE_MISSING_TYPE = 'subscription_invoice_missing'
const EXPIRY_TRIGGERS = [30, 15, 7, 3, 1, 0]

function buildExpiryTriggerKey(subscriptionId, trigger, expiryDate) {
  return `subscription_expiry:${subscriptionId}:${trigger}:${expiryDate}`
}

function buildInvoiceMissingKey(subscriptionId, expiryDate) {
  return `subscription_invoice_missing:${subscriptionId}:${expiryDate}`
}

function buildExpiryMessage(name, trigger, expiryDate) {
  const label = formatDaysRemaining(expiryDate)
  if (trigger === 'expired') {
    return `${label} — payment or renewal required.`
  }
  if (trigger === 0) {
    return `Expires today (${String(expiryDate).slice(0, 10)}) — action required.`
  }
  return `${label} (expires ${String(expiryDate).slice(0, 10)}).`
}

function buildExpiryTitle(name, trigger) {
  if (trigger === 'expired') return `Subscription expired: ${name}`
  if (trigger === 0) return `Subscription expires today: ${name}`
  return `Subscription expiring soon: ${name}`
}

function buildPaymentRequiredTitle(name) {
  return `Payment required: ${name}`
}

function buildInvoiceMissingTitle(name) {
  return `Invoice missing: ${name}`
}

/**
 * Sync subscription expiry notifications into the notifications table.
 * Idempotent via unique trigger_key; stale rows removed when subscription changes.
 */
async function syncSubscriptionNotifications() {
  const subs = await query(
    `SELECT s.id, s.name, s.expiry_date, s.payment_status, s.invoice_required, s.invoice_status,
            (SELECT COUNT(*)::int FROM subscription_invoices si WHERE si.subscription_id = s.id) AS invoice_count
     FROM subscriptions s
     WHERE s.deleted_at IS NULL AND s.expiry_date IS NOT NULL`
  )

  const activeKeys = new Set()

  for (const sub of subs.rows) {
    const subId = sub.id
    const expiryDate = String(sub.expiry_date).slice(0, 10)
    const name = sub.name || 'Subscription'
    const daysLeft = getDaysLeft(expiryDate)
    const invoiceCount = Number(sub.invoice_count) || 0

    for (const trigger of EXPIRY_TRIGGERS) {
      const scheduledFor = trigger === 0 ? expiryDate : subtractDays(expiryDate, trigger)
      const triggerKey = buildExpiryTriggerKey(subId, trigger, expiryDate)
      activeKeys.add(triggerKey)

      const title = buildExpiryTitle(name, trigger)
      const message = buildExpiryMessage(name, trigger, expiryDate)

      await query(
        `INSERT INTO notifications (type, title, message, scheduled_for, trigger_key, meta)
         VALUES ($1, $2, $3, $4::date, $5, $6::jsonb)
         ON CONFLICT (trigger_key) DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           scheduled_for = EXCLUDED.scheduled_for,
           meta = EXCLUDED.meta,
           updated_at = NOW(),
           is_read = CASE
             WHEN notifications.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for THEN false
             ELSE notifications.is_read
           END,
           read_at = CASE
             WHEN notifications.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for THEN NULL
             ELSE notifications.read_at
           END`,
        [
          NOTIFICATION_TYPE,
          title,
          message,
          scheduledFor,
          triggerKey,
          JSON.stringify({
            subscription_id: subId,
            expiry_date: expiryDate,
            trigger,
            days_left: daysLeft,
          }),
        ]
      )
    }

    if (daysLeft !== null && daysLeft < 0 && sub.payment_status !== 'Paid') {
      const triggerKey = buildExpiryTriggerKey(subId, 'expired', expiryDate)
      activeKeys.add(triggerKey)
      const scheduledFor = expiryDate
      await query(
        `INSERT INTO notifications (type, title, message, scheduled_for, trigger_key, meta)
         VALUES ($1, $2, $3, $4::date, $5, $6::jsonb)
         ON CONFLICT (trigger_key) DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           scheduled_for = EXCLUDED.scheduled_for,
           meta = EXCLUDED.meta,
           updated_at = NOW()`,
        [
          NOTIFICATION_TYPE,
          buildExpiryTitle(name, 'expired'),
          buildExpiryMessage(name, 'expired', expiryDate),
          scheduledFor,
          triggerKey,
          JSON.stringify({
            subscription_id: subId,
            expiry_date: expiryDate,
            trigger: 'expired',
            days_left: daysLeft,
          }),
        ]
      )
    }

    if (
      sub.invoice_required &&
      invoiceCount === 0 &&
      daysLeft !== null &&
      daysLeft <= 15
    ) {
      const triggerKey = buildInvoiceMissingKey(subId, expiryDate)
      activeKeys.add(triggerKey)
      const scheduledFor = subtractDays(expiryDate, 15)
      await query(
        `INSERT INTO notifications (type, title, message, scheduled_for, trigger_key, meta)
         VALUES ($1, $2, $3, $4::date, $5, $6::jsonb)
         ON CONFLICT (trigger_key) DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           scheduled_for = EXCLUDED.scheduled_for,
           meta = EXCLUDED.meta,
           updated_at = NOW()`,
        [
          INVOICE_MISSING_TYPE,
          buildInvoiceMissingTitle(name),
          `No invoice uploaded — expiry in ${Math.max(daysLeft, 0)} day(s) on ${expiryDate}.`,
          scheduledFor,
          triggerKey,
          JSON.stringify({
            subscription_id: subId,
            expiry_date: expiryDate,
            trigger: 'invoice_missing',
          }),
        ]
      )
    }

    if (sub.payment_status === 'Payment Requested' && daysLeft !== null && daysLeft <= 30) {
      const triggerKey = `subscription_payment_required:${subId}:${expiryDate}`
      activeKeys.add(triggerKey)
      const scheduledFor = subtractDays(expiryDate, Math.min(30, Math.max(daysLeft, 0)))
      await query(
        `INSERT INTO notifications (type, title, message, scheduled_for, trigger_key, meta)
         VALUES ($1, $2, $3, $4::date, $5, $6::jsonb)
         ON CONFLICT (trigger_key) DO UPDATE SET
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           scheduled_for = EXCLUDED.scheduled_for,
           meta = EXCLUDED.meta,
           updated_at = NOW()`,
        [
          'subscription_payment_required',
          buildPaymentRequiredTitle(name),
          `Payment requested — ${formatDaysRemaining(expiryDate)}.`,
          scheduledFor,
          triggerKey,
          JSON.stringify({
            subscription_id: subId,
            expiry_date: expiryDate,
            trigger: 'payment_required',
          }),
        ]
      )
    }
  }

  if (activeKeys.size > 0) {
    await query(
      `DELETE FROM notifications n
       WHERE (n.trigger_key LIKE 'subscription_expiry:%'
           OR n.trigger_key LIKE 'subscription_invoice_missing:%'
           OR n.trigger_key LIKE 'subscription_payment_required:%')
         AND n.trigger_key != ALL($1::text[])`,
      [Array.from(activeKeys)]
    )
  }
}

module.exports = {
  NOTIFICATION_TYPE,
  INVOICE_MISSING_TYPE,
  buildExpiryTriggerKey,
  buildInvoiceMissingKey,
  syncSubscriptionNotifications,
}

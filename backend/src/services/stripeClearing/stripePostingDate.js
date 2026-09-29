'use strict'

/**
 * The only place Stripe clearing turns instants into Asia/Dubai calendar days.
 *
 * Every new Zoho record (customer payments, journals, credit note refunds) is dated with
 * getDubaiPostingDate() evaluated on the server when the POST runs, never with the payout
 * arrival date, the Stripe transaction date, UTC or the browser's clock. dubaiDateOf() is for
 * showing and searching source dates (payout arrival, payout creation) only.
 */

const DUBAI_TIME_ZONE = 'Asia/Dubai'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DUBAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatDubaiDay(date) {
  const parts = {}
  for (const p of formatter.formatToParts(date)) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** YYYY-MM-DD of an ISO timestamp (or Date) in Asia/Dubai; null when unparseable. */
function dubaiDateOf(value) {
  if (value == null || value === '') return null
  const t = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(t)) return null
  return formatDubaiDay(new Date(t))
}

/** Current Zoho posting date: today's YYYY-MM-DD in Asia/Dubai at `now` (server clock). */
function getDubaiPostingDate(now = new Date()) {
  const date = dubaiDateOf(now instanceof Date ? now : new Date(now))
  if (!date) throw new Error('Invalid clock value for the Zoho posting date.')
  return date
}

module.exports = { DUBAI_TIME_ZONE, dubaiDateOf, getDubaiPostingDate }

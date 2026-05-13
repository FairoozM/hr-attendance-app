/**
 * Marketplace-local calendar boundaries for Amazon dashboards (UAE / KSA).
 * Uses IANA zones via Intl for "today" and fixed offsets (+04:00 Dubai, +03:00 Riyadh) for wall-clock → UTC.
 */

export const IANA_UAE = 'Asia/Dubai'
export const IANA_KSA = 'Asia/Riyadh'

export function ianaKeyForDashboardMarketplace(marketplaceKey) {
  return marketplaceKey === 'ksa' ? IANA_KSA : IANA_UAE
}

export function ymdInTimeZone(date, ianaKey) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaKey,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const m = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  return { y: +m.year, m: +m.month, d: +m.day }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Interpret calendar y-m-d h:min:s in the marketplace zone as an absolute UTC instant.
 * UAE and KSA do not observe DST; offsets are fixed.
 */
export function zonedLocalToUtcDate(y, mon, day, h, min, sec, ms, ianaKey) {
  const off = ianaKey === IANA_KSA ? '+03:00' : '+04:00'
  const iso = `${y}-${pad2(mon)}-${pad2(day)}T${pad2(h)}:${pad2(min)}:${pad2(sec)}.${String(ms).padStart(3, '0')}${off}`
  return new Date(iso)
}

export function startOfZonedDay(y, mon, day, ianaKey) {
  return zonedLocalToUtcDate(y, mon, day, 0, 0, 0, 0, ianaKey)
}

export function addCalendarDaysInZone(ianaKey, y, mon, day, deltaDays) {
  const noon = zonedLocalToUtcDate(y, mon, day, 12, 0, 0, 0, ianaKey)
  const shifted = new Date(noon.getTime() + deltaDays * 86400000)
  return ymdInTimeZone(shifted, ianaKey)
}

export function endBeforeNow() {
  return new Date(Date.now() - 130_000)
}

const SYNC_MAX_MS = 7 * 24 * 60 * 60 * 1000 + 60_000

export function isRangeWithinSyncLimit(createdAfter, createdBefore) {
  if (!createdAfter || !createdBefore) return false
  return createdBefore.getTime() - createdAfter.getTime() <= SYNC_MAX_MS
}

/**
 * @param {'all'|'uae'|'ksa'} marketplaceKey
 * @param {'today'|'yesterday'|'last7'|'last30'|'custom'} preset
 */
export function rangeForMarketplacePreset(marketplaceKey, preset, customFromYmd, customToYmd) {
  const tz = ianaKeyForDashboardMarketplace(marketplaceKey)
  const nowCap = endBeforeNow()
  const today = ymdInTimeZone(new Date(), tz)

  if (preset === 'today') {
    const start = startOfZonedDay(today.y, today.m, today.d, tz)
    const tomorrow = addCalendarDaysInZone(tz, today.y, today.m, today.d, 1)
    const nextMid = startOfZonedDay(tomorrow.y, tomorrow.m, tomorrow.d, tz)
    const end = new Date(Math.min(nowCap.getTime(), nextMid.getTime() - 1))
    return { createdAfter: start, createdBefore: end.getTime() < start.getTime() ? nowCap : end }
  }
  if (preset === 'yesterday') {
    const y = addCalendarDaysInZone(tz, today.y, today.m, today.d, -1)
    const yStart = startOfZonedDay(y.y, y.m, y.d, tz)
    const yEnd = startOfZonedDay(today.y, today.m, today.d, tz)
    return { createdAfter: yStart, createdBefore: yEnd }
  }
  if (preset === 'last7') {
    const startYmd = addCalendarDaysInZone(tz, today.y, today.m, today.d, -6)
    const start = startOfZonedDay(startYmd.y, startYmd.m, startYmd.d, tz)
    return { createdAfter: start, createdBefore: nowCap }
  }
  if (preset === 'last30') {
    const startYmd = addCalendarDaysInZone(tz, today.y, today.m, today.d, -29)
    const start = startOfZonedDay(startYmd.y, startYmd.m, startYmd.d, tz)
    return { createdAfter: start, createdBefore: nowCap }
  }
  const [fy, fm, fd] = String(customFromYmd || '').split('-').map((x) => parseInt(x, 10))
  const [ty, tm, td] = String(customToYmd || '').split('-').map((x) => parseInt(x, 10))
  if (!fy || !fm || !fd || !ty || !tm || !td) {
    const startYmd = addCalendarDaysInZone(tz, today.y, today.m, today.d, -6)
    return {
      createdAfter: startOfZonedDay(startYmd.y, startYmd.m, startYmd.d, tz),
      createdBefore: nowCap,
    }
  }
  const start = startOfZonedDay(fy, fm, fd, tz)
  const endDayNext = addCalendarDaysInZone(tz, ty, tm, td, 1)
  const exclusiveEnd = startOfZonedDay(endDayNext.y, endDayNext.m, endDayNext.d, tz)
  const end = new Date(Math.min(nowCap.getTime(), exclusiveEnd.getTime() - 1))
  return { createdAfter: start, createdBefore: end.getTime() < start.getTime() ? nowCap : end }
}

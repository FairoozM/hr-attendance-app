'use strict'

/**
 * Money for POS settlement: integer fils (1/100 AED) parsed from the source text, never through a
 * float. A value with more than two decimals is accepted only when the extra digits are zeros;
 * anything else is reported instead of being rounded, so the settlement never silently changes.
 */

type MoneyParse = { ok: true; fils: number } | { ok: false; reason: string }

/**
 * Parse "1,234.50", "(6.10)", "-0.31", "AED 324.24", "324.24-", "324.2400" into fils.
 * Blank → ok with 0 only when `blankIsZero`.
 */
function parseMoneyToFils(raw: unknown, { blankIsZero = false }: { blankIsZero?: boolean } = {}): MoneyParse {
  let s = raw == null ? '' : String(raw).trim()
  if (s === '') return blankIsZero ? { ok: true, fils: 0 } : { ok: false, reason: 'blank' }
  s = s.replace(/^="?|"$/g, '').replace(/\b(AED|DHS?)\b/gi, '').replace(/\s+/g, '')
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[1] === '' && (m[2] == null || m[2] === ''))) return { ok: false, reason: `"${String(raw)}" is not an amount` }
  const whole = m[1] || '0'
  const frac = m[2] || ''
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return { ok: false, reason: `"${String(raw)}" has more than two decimals; it is not rounded` }
  if (whole.length > 12) return { ok: false, reason: `"${String(raw)}" is too large` }
  const fils = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return { ok: true, fils: negative && fils !== 0 ? -fils : fils }
}

function filsToMajor(fils: number): number {
  return Math.round(Number(fils) || 0) / 100
}

function formatFils(fils: number): string {
  const n = Math.round(Number(fils) || 0)
  const abs = Math.abs(n)
  return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Fils from a Zoho JSON number (Zoho sends 2-decimal amounts). */
function majorToFils(major: unknown): number {
  const parsed = parseMoneyToFils(typeof major === 'number' ? major.toFixed(2) : major, { blankIsZero: true })
  return parsed.ok ? parsed.fils : NaN
}

/**
 * Split `totalFils` across `weights` (fils) in proportion, largest remainder first, ties to the
 * earlier entry. The parts always add back to the total exactly.
 */
function allocateProportionally(totalFils: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum === 0) return weights.map((_, i) => (i === 0 ? totalFils : 0))
  const exact = weights.map((w) => (totalFils * w) / sum)
  const floor = exact.map((x) => Math.floor(x))
  let left = totalFils - floor.reduce((s, x) => s + x, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floor[i] += 1
    left -= 1
  }
  return floor
}

module.exports = { parseMoneyToFils, filsToMajor, formatFils, majorToFils, allocateProportionally }

/**
 * Shared accounting helpers for Ecommerce Ledger + Summary.
 */

const { dubaiDayBounds, todayUaeYmd, assertYmd, addDaysYmd } =
  require('../dailyEcommerceReport/dateBounds')
const { round2 } = require('../dailyEcommerceReport/money')

/** Account types where debit increases the balance (asset/expense side). */
const DEBIT_NORMAL_TYPES = new Set([
  'cash',
  'bank',
  'other_asset',
  'other_current_asset',
  'fixed_asset',
  'stock',
  'payment_clearing_account',
  'accounts_receivable',
  'expense',
  'cost_of_goods_sold',
  'other_expense',
])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toNumber(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {string} accountType
 * @param {'debit_normal'|'credit_normal'|null|undefined} natureOverride
 */
function isDebitNormalAccount(accountType, natureOverride) {
  if (natureOverride === 'credit_normal') return false
  if (natureOverride === 'debit_normal') return true
  const t = clean(accountType).toLowerCase()
  if (!t) return true
  if (DEBIT_NORMAL_TYPES.has(t)) return true
  if (t.includes('asset') || t.includes('expense') || t === 'stock' || t === 'bank' || t === 'cash') {
    return true
  }
  return false
}

/**
 * Signed effect of a debit/credit on the account's displayed balance.
 * Positive increases the balance shown on the ledger.
 *
 * @param {{ debit?: number, credit?: number, debitOrCredit?: string, amount?: number }} movement
 * @param {string} accountType
 * @param {'debit_normal'|'credit_normal'|null|undefined} natureOverride
 */
function applyAccountMovement(movement, accountType, natureOverride) {
  const debitNormal = isDebitNormalAccount(accountType, natureOverride)
  const debit = Math.abs(toNumber(movement?.debit))
  const credit = Math.abs(toNumber(movement?.credit))
  const side = clean(movement?.debitOrCredit).toLowerCase()
  const amount = Math.abs(toNumber(movement?.amount))

  if (debit > 0 || credit > 0) {
    return debitNormal ? debit - credit : credit - debit
  }
  if (side === 'debit') return debitNormal ? amount : -amount
  if (side === 'credit') return debitNormal ? -amount : amount
  return 0
}

/**
 * @param {object[]} accounts - { accountId, parentAccountId }
 * @param {string} parentAccountId
 * @returns {string[]} parent + all nested descendants
 */
function getDescendantAccountIds(accounts, parentAccountId) {
  const parent = clean(parentAccountId)
  if (!parent) return []
  const byParent = new Map()
  for (const a of accounts || []) {
    const pid = clean(a.parentAccountId || a.parent_account_id)
    const id = clean(a.accountId || a.account_id)
    if (!pid || !id) continue
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid).push(id)
  }
  const out = new Set([parent])
  const queue = [parent]
  while (queue.length) {
    const id = queue.shift()
    for (const child of byParent.get(id) || []) {
      if (!out.has(child)) {
        out.add(child)
        queue.push(child)
      }
    }
  }
  return [...out]
}

/**
 * Running balances from opening + signed row deltas.
 * @param {number} opening
 * @param {{ delta: number }[]} rows
 */
function attachRunningBalances(opening, rows) {
  let bal = round2(toNumber(opening))
  return (rows || []).map((row) => {
    bal = round2(bal + toNumber(row.delta))
    return { ...row, balance: bal, runningBalance: bal }
  })
}

/**
 * Return / sale ratio as percent (0–100 scale for display), never NaN/Infinity.
 * Uses returns / salesAmount (caller chooses gross vs net base).
 */
function calculateReturnSaleRatio(returnAmount, salesAmount) {
  const ret = toNumber(returnAmount)
  const sales = toNumber(salesAmount)
  if (!(sales > 0)) return null
  return round2((ret / sales) * 100)
}

/**
 * Count distinct YYYY-MM-DD keys with non-zero sales activity.
 * @param {Map<string, number>|Record<string, number>} dailySalesByYmd
 * @param {string} fromYmd inclusive
 * @param {string} toYmd inclusive
 */
function countDaysWithSales(dailySalesByYmd, fromYmd, toYmd) {
  const get =
    dailySalesByYmd instanceof Map
      ? (k) => dailySalesByYmd.get(k)
      : (k) => dailySalesByYmd?.[k]
  let count = 0
  let cur = fromYmd
  while (cur <= toYmd) {
    const v = toNumber(get(cur))
    if (v !== 0) count += 1
    cur = addDaysYmd(cur, 1)
  }
  return count
}

/** Day-of-year (1–366) for a YYYY-MM-DD in calendar terms (UAE date string). */
function dayOfYearFromYmd(ymd) {
  assertYmd(ymd)
  const [y, m, d] = ymd.split('-').map(Number)
  const start = Date.UTC(y, 0, 0)
  const target = Date.UTC(y, m - 1, d)
  return Math.round((target - start) / 86400000)
}

function monthNumberFromYmd(ymd) {
  assertYmd(ymd)
  return Number(ymd.slice(5, 7))
}

function dayNameFromYmd(ymd) {
  assertYmd(ymd)
  const [y, m, d] = ymd.split('-').map(Number)
  // Noon UTC avoids DST edge; weekday for calendar date is stable for UAE civil date.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function yearStartYmd(ymd) {
  assertYmd(ymd)
  return `${ymd.slice(0, 4)}-01-01`
}

function monthStartYmd(ymd) {
  assertYmd(ymd)
  return `${ymd.slice(0, 7)}-01`
}

function previousYmd(ymd) {
  return addDaysYmd(ymd, -1)
}

module.exports = {
  DEBIT_NORMAL_TYPES,
  clean,
  toNumber,
  isDebitNormalAccount,
  applyAccountMovement,
  getDescendantAccountIds,
  attachRunningBalances,
  calculateReturnSaleRatio,
  countDaysWithSales,
  dayOfYearFromYmd,
  monthNumberFromYmd,
  dayNameFromYmd,
  yearStartYmd,
  monthStartYmd,
  previousYmd,
  dubaiDayBounds,
  todayUaeYmd,
  assertYmd,
  addDaysYmd,
  round2,
}

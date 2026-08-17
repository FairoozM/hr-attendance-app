/** Ecommerce price list — persisted per user via API (see PREF_ALL_PRICES_EC). */

import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import { getAllPricesMarket, PROFIT_POLICY_ANY, PROFIT_POLICY_TARGET } from './allPricesMarket'
import { getAllPricesPrefsScope } from './allPricesMarketScope'

export const STORAGE_KEY_RATES = 'hr-all-prices-ecommerce-rates-v1'
export const STORAGE_KEY_ROWS = 'hr-all-prices-ecommerce-rows-v1'

export const DEFAULT_RATES = {
  /** Percent values 0–100 for UI; formulas use decimals */
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

/** Commission is locked at 15% for All UAE Prices (Custom). */
export const CUSTOM_FIXED_COMMISSION_PCT = 15

/** @returns {boolean} */
export function isProductionBuild() {
  return typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD)
}

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

function hasWholesaleSalesPrice(row) {
  if (row?.salesPrice === '' || row?.salesPrice == null) return false
  const n = Number(row.salesPrice)
  return Number.isFinite(n) && n > 0
}

function buildComputedPriceRow(salesPrice, safePurchase, safeShipping, vat, commission, advertising) {
  const vatAmount = salesPrice * vat
  const commissionAmount = salesPrice * commission
  const advertisingAmount = salesPrice * advertising
  const totalCost = safePurchase + vatAmount + commissionAmount + advertisingAmount + safeShipping
  const profit = salesPrice - totalCost
  const profitPct = salesPrice > 0 ? (profit / salesPrice) * 100 : 0

  return {
    denominatorInvalid: false,
    salesPriceFromWholesale: true,
    salesPriceRaw: salesPrice,
    salesPrice,
    vatAmount,
    commissionAmount,
    advertisingAmount,
    totalCost,
    profit,
    profitPct,
  }
}

/**
 * Cost-up sales price from purchase + shipping and rate percentages.
 * Always ignores any wholesale salesPrice on the row.
 *
 * @param {{ purchasePrice?: unknown, shipping?: unknown }} row
 * @param {{ vatPct?: unknown, commissionPct?: unknown, advertisingPct?: unknown, requiredProfitPct?: unknown }} [rates]
 */
export function computeCostUpEcommercePriceRow(row, rates = DEFAULT_RATES) {
  const purchase = Number(row?.purchasePrice)
  const shipping = Number(row?.shipping)
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)
  const reqProfit = toDec(rates.requiredProfitPct)

  const safePurchase = Number.isFinite(purchase) ? purchase : 0
  const safeShipping = Number.isFinite(shipping) ? shipping : 0

  const denominator = 1 - vat - commission - advertising - reqProfit

  if (denominator <= 0 || denominator >= 1) {
    return {
      denominatorInvalid: true,
      salesPriceFromWholesale: false,
      salesPriceRaw: 0,
      salesPrice: 0,
      vatAmount: 0,
      commissionAmount: 0,
      advertisingAmount: 0,
      totalCost: 0,
      profit: 0,
      profitPct: 0,
    }
  }

  const salesPriceRaw = (safePurchase + safeShipping) / denominator
  const salesPrice = Math.round(salesPriceRaw)
  return {
    ...buildComputedPriceRow(salesPrice, safePurchase, safeShipping, vat, commission, advertising),
    salesPriceFromWholesale: false,
    salesPriceRaw,
  }
}

/**
 * All UAE Prices (Custom): cost-up with commission locked at 15%.
 * Purchase/shipping come from the shared UAE catalog; wholesale salesPrice is ignored.
 *
 * @param {{ purchasePrice?: unknown, shipping?: unknown }} row
 * @param {{ vatPct?: unknown, advertisingPct?: unknown, requiredProfitPct?: unknown, commissionPct?: unknown }} [rates]
 */
export function computeCustomUaePriceRow(row, rates = DEFAULT_RATES) {
  return computeCostUpEcommercePriceRow(row, {
    vatPct: rates?.vatPct,
    advertisingPct: rates?.advertisingPct,
    requiredProfitPct: rates?.requiredProfitPct,
    commissionPct: CUSTOM_FIXED_COMMISSION_PCT,
  })
}

/**
 * Client-side mirror of backend check: VAT + 15% commission + advertising + profit must be under 100%.
 * @param {number} vatPct
 * @param {number} advertisingPct
 * @param {number} requiredProfitPct
 */
export function areCustomUaeRatesValid(vatPct, advertisingPct, requiredProfitPct) {
  if (![vatPct, advertisingPct, requiredProfitPct].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
    return false
  }
  return vatPct + CUSTOM_FIXED_COMMISSION_PCT + advertisingPct + requiredProfitPct < 100
}

/**
 * Wholesales sales price is the source of truth when provided on the row.
 * VAT, commission, and advertising are derived from that sales price; profit % is informational.
 *
 * Legacy rows without salesPrice still use the old cost-based formula as a fallback.
 *
 * @param {{ salesPrice?: unknown, purchasePrice?: unknown, shipping?: unknown }} row
 * @param {{ vatPct?: unknown, commissionPct?: unknown, advertisingPct?: unknown, requiredProfitPct?: unknown }} [rates]
 */
export function computeEcommercePriceRow(row, rates = DEFAULT_RATES) {
  const purchase = Number(row.purchasePrice)
  const shipping = Number(row.shipping)
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)

  const safePurchase = Number.isFinite(purchase) ? purchase : 0
  const safeShipping = Number.isFinite(shipping) ? shipping : 0

  if (hasWholesaleSalesPrice(row)) {
    return buildComputedPriceRow(Number(row.salesPrice), safePurchase, safeShipping, vat, commission, advertising)
  }

  return computeCostUpEcommercePriceRow(row, rates)
}

export function makeRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Dev-only BRKH demo rows — never returned in production builds. */
export function seedEcommerceRowsForDevOnly() {
  if (isProductionBuild()) return []
  return Array.from({ length: 17 }, (_, i) => ({
    id: makeRowId(),
    itemNo: `BRKH-64-${i + 1}`,
    purchasePrice: i === 0 ? 26.83 : '',
    shipping: i === 0 ? 21 : '',
    dateOfPrices: '',
  }))
}

/** @deprecated Use seedEcommerceRowsForDevOnly — kept only for dev/test imports. */
export function seedEcommerceRows() {
  return seedEcommerceRowsForDevOnly()
}

function normalizePriceCell(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : String(value).trim()
}

/**
 * True when rows match the built-in BRKH-64 template fingerprint (empty costs except row 1).
 * @param {unknown} rows
 * @returns {boolean}
 */
export function isBrkhTemplateSeedRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  if (rows.length < 15 || rows.length > 20) return false

  for (let i = 0; i < rows.length; i += 1) {
    const itemNo = String(rows[i]?.itemNo ?? '').trim().toUpperCase()
    if (itemNo !== `BRKH-64-${i + 1}`) return false
  }

  const firstPurchase = normalizePriceCell(rows[0]?.purchasePrice)
  const firstShipping = normalizePriceCell(rows[0]?.shipping)
  if (firstPurchase !== '26.83' || firstShipping !== '21') return false

  for (let i = 1; i < rows.length; i += 1) {
    const purchase = normalizePriceCell(rows[i]?.purchasePrice)
    const shipping = normalizePriceCell(rows[i]?.shipping)
    if (purchase !== '' || shipping !== '') return false
  }

  return true
}

/**
 * @param {unknown} rawRows
 * @returns {import('./allPricesEcommerceUtils').AllPricesRow[] | null}
 */
export function normalizeAllPricesRows(rawRows) {
  if (!Array.isArray(rawRows)) return null
  return rawRows.map((r) => ({
    id: r.id || makeRowId(),
    itemNo: r.itemNo != null ? String(r.itemNo) : '',
    salesPrice: r.salesPrice ?? '',
    purchasePrice: r.purchasePrice ?? '',
    shipping: r.shipping ?? '',
    dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
  }))
}

/** Shallow clone rows for formula sandbox (does not mutate price list). */
export function cloneAllPricesRows(rawRows) {
  const normalized = normalizeAllPricesRows(rawRows) || []
  return normalized.map((r) => ({ ...r }))
}

/**
 * Resolve rows from a preference bundle; strips BRKH template seed in production.
 * @param {unknown} bundle
 * @param {{ isProd?: boolean }} [options]
 */
export function resolveAllPricesRowsFromBundle(bundle, options = {}) {
  const isProd = options.isProd != null ? options.isProd : isProductionBuild()
  const safeBundle = bundle && typeof bundle === 'object' ? bundle : {}
  const loaded = normalizeAllPricesRows(safeBundle.rows) || []
  if (isProd && isBrkhTemplateSeedRows(loaded)) return []
  return loaded
}

/**
 * @param {unknown} raw
 */
export function normalizeAllPricesRates(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  return {
    vatPct: Number.isFinite(Number(p.vatPct)) ? Number(p.vatPct) : DEFAULT_RATES.vatPct,
    commissionPct: Number.isFinite(Number(p.commissionPct)) ? Number(p.commissionPct) : DEFAULT_RATES.commissionPct,
    advertisingPct: Number.isFinite(Number(p.advertisingPct)) ? Number(p.advertisingPct) : DEFAULT_RATES.advertisingPct,
    requiredProfitPct: Number.isFinite(Number(p.requiredProfitPct))
      ? Number(p.requiredProfitPct)
      : DEFAULT_RATES.requiredProfitPct,
  }
}

function readBundle() {
  const b = getUserPrefKey(getAllPricesPrefsScope().ec, null)
  return b && typeof b === 'object' ? b : {}
}

/**
 * Read a market's bundle without switching the active scope — for pages that consume another
 * market's catalog (e.g. composite pricing reading All Prices (UAE) Special Offers).
 *
 * @param {import('./allPricesMarket').PricesMarketId} marketId
 */
function readBundleForMarket(marketId) {
  const b = getUserPrefKey(getAllPricesMarket(marketId).prefs.ec, null)
  return b && typeof b === 'object' ? b : {}
}

/**
 * @param {import('./allPricesMarket').PricesMarketId} marketId
 * @returns {ReturnType<typeof normalizeAllPricesRows>}
 */
export function loadRowsForMarket(marketId) {
  try {
    return resolveAllPricesRowsFromBundle(readBundleForMarket(marketId))
  } catch {
    return null
  }
}

/**
 * @param {import('./allPricesMarket').PricesMarketId} marketId
 */
export function loadRatesForMarket(marketId) {
  try {
    return normalizeAllPricesRates(readBundleForMarket(marketId).rates)
  } catch {
    return { ...DEFAULT_RATES }
  }
}

/**
 * @param {object} rates
 * @param {unknown[]} rows
 * @param {string | null | undefined} [lastSavedAt]
 */
export function buildAllPricesBundle(rates, rows, lastSavedAt) {
  const bundle = {
    rates: normalizeAllPricesRates(rates),
    rows: normalizeAllPricesRows(rows) || [],
  }
  if (lastSavedAt) bundle.lastSavedAt = String(lastSavedAt)
  return bundle
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseLastSavedAt(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatLastSavedAt(iso) {
  const parsed = parseLastSavedAt(iso)
  if (!parsed) return ''
  const d = new Date(parsed)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * @param {unknown} bundle
 * @returns {{ rates: object, rows: ReturnType<typeof normalizeAllPricesRows>, lastSavedAt: string | null }}
 */
export function hydrateAllPricesStateFromBundle(bundle) {
  const safeBundle = bundle && typeof bundle === 'object' ? bundle : {}
  return {
    rates: normalizeAllPricesRates(safeBundle.rates),
    rows: resolveAllPricesRowsFromBundle(safeBundle),
    lastSavedAt: parseLastSavedAt(safeBundle.lastSavedAt),
  }
}

/**
 * Persist All Prices bundle with production guard against BRKH template saves.
 * @param {{ rates?: object, rows?: unknown[], lastSavedAt?: string | null }} partial
 * @param {{ source?: string, action?: string, preserveLastSavedAt?: boolean }} [meta]
 * @returns {{ blocked: boolean }}
 */
export function saveAllPricesEcommerceBundle(partial, meta = {}) {
  const source = meta.source || 'unknown'
  const action = meta.action || 'save'
  const bundle = readBundle()
  const rates = normalizeAllPricesRates(
    partial.rates != null ? partial.rates : bundle.rates,
  )
  const rows = normalizeAllPricesRows(
    partial.rows != null ? partial.rows : bundle.rows,
  ) || []

  if (isProductionBuild() && isBrkhTemplateSeedRows(rows)) {
    console.error('[all-prices] blocked BRKH/template seed save in production', {
      source,
      action,
      rowCount: rows.length,
    })
    return { blocked: true }
  }

  let lastSavedAt = bundle.lastSavedAt != null ? bundle.lastSavedAt : null
  if (Object.prototype.hasOwnProperty.call(partial, 'lastSavedAt')) {
    lastSavedAt = partial.lastSavedAt
  } else if (meta.preserveLastSavedAt === false) {
    lastSavedAt = null
  }

  const next = buildAllPricesBundle(rates, rows, lastSavedAt || undefined)
  requestUserPrefSave(getAllPricesPrefsScope().ec, next)
  return { blocked: false }
}

export function loadRates() {
  try {
    const p = readBundle().rates
    if (!p || typeof p !== 'object') return { ...DEFAULT_RATES }
    return normalizeAllPricesRates(p)
  } catch {
    return { ...DEFAULT_RATES }
  }
}

export function saveRates(rates, meta = {}) {
  const bundle = readBundle()
  const existingRows = resolveAllPricesRowsFromBundle(bundle)
  return saveAllPricesEcommerceBundle(
    { ...bundle, rates, rows: existingRows },
    { source: meta.source || 'saveRates', action: meta.action || 'save-rates' },
  )
}

export function loadRows() {
  try {
    return resolveAllPricesRowsFromBundle(readBundle())
  } catch {
    return null
  }
}

export function saveRows(rows, meta = {}) {
  const bundle = readBundle()
  const rates = bundle.rates && typeof bundle.rates === 'object' ? bundle.rates : { ...DEFAULT_RATES }
  return saveAllPricesEcommerceBundle(
    { ...bundle, rates, rows },
    { source: meta.source || 'saveRows', action: meta.action || 'save-rows' },
  )
}

export function fmtMoney(n, digits = 2) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(n, digits = 1) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${x.toFixed(digits)}%`
}

/**
 * Profit % of sales colouring.
 * - `target` policy: red below 25%, green above 26%.
 * - `any` policy (special offers): only a loss is red, every positive margin is acceptable.
 *
 * @param {unknown} profitPct
 * @param {import('./allPricesMarket').ProfitPolicy} [policy]
 */
export function profitMarginDisplayClass(profitPct, policy = PROFIT_POLICY_TARGET) {
  const n = Number(profitPct)
  if (!Number.isFinite(n)) return ''
  if (policy === PROFIT_POLICY_ANY) return n < 0 ? 'ap-ec-profit--low' : ''
  if (n < 25) return 'ap-ec-profit--low'
  if (n > 26) return 'ap-ec-profit--high'
  return ''
}

/**
 * Markup of sales price over purchase price, ignoring VAT/commission/advertising/shipping.
 * Matches the "profit % of purchase" column of the wholesales offer sheets.
 *
 * @param {unknown} salesPrice
 * @param {unknown} purchasePrice
 * @returns {number | null} null when purchase price is missing or zero
 */
export function purchaseMarkupPct(salesPrice, purchasePrice) {
  const sales = Number(salesPrice)
  const purchase = Number(purchasePrice)
  if (!Number.isFinite(sales) || !Number.isFinite(purchase) || purchase <= 0) return null
  return ((sales - purchase) / purchase) * 100
}

/** Split Excel clipboard row into cells (tab-separated). */
export function splitTsvLine(line) {
  return String(line).split('\t').map((c) => c.trim())
}

/**
 * Parse numeric cell from Excel (handles 26,83 → 26.83 and 1,234.56 thousands).
 */
export function normalizePastedNumber(str) {
  let s = String(str ?? '').trim().replace(/\s/g, '')
  if (!s || s === '—' || s === '-') return ''
  const hasDot = s.includes('.')
  const commaCount = (s.match(/,/g) || []).length
  if (!hasDot && commaCount === 1 && /^-?\d+,\d+$/.test(s)) {
    s = s.replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = Number(String(s).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? String(n) : ''
}

function parsePastedDate(str) {
  const s = String(str ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (!m) return ''
  let d = m[1].padStart(2, '0')
  let mo = m[2].padStart(2, '0')
  let y = m[3]
  if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`
  return `${y}-${mo}-${d}`
}

function rowLooksLikeHeader(cells) {
  const joined = cells.join(' ').toLowerCase()
  if (/item\s*no/.test(joined)) return true
  if (/purchase.*price.*ecommerce/.test(joined)) return true
  if (/sales\s*price|website.*noon/i.test(joined) && /vat|commission/i.test(joined)) return true
  return false
}

/**
 * Parse Excel copy-paste (TSV). Supports:
 * - Full sheet row: Item | Sales | VAT | Comm | Adv | Shipping | Purchase | … optional date last col
 * - Three columns: Item | Purchase | Shipping
 * - Two columns: Purchase | Shipping
 * @returns {{ rows: Array<{ itemNo: string, salesPrice: string, purchasePrice: string, shipping: string, dateOfPrices: string }>, skippedHeader: boolean, hint: string }}
 */
export function parseExcelTsvPaste(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '')
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    return { rows: [], skippedHeader: false, hint: 'empty' }
  }

  let skippedHeader = false
  let dataLines = lines
  const firstCells = splitTsvLine(lines[0])
  if (rowLooksLikeHeader(firstCells)) {
    skippedHeader = true
    dataLines = lines.slice(1)
  }

  const rows = []
  for (const line of dataLines) {
    const cells = splitTsvLine(line)
    if (cells.length === 0 || cells.every((c) => c === '')) continue

    let itemNo = ''
    let salesPrice = ''
    let purchasePrice = ''
    let shipping = ''
    let dateOfPrices = ''

    const n = cells.length

    if (n >= 7) {
      itemNo = cells[0] != null ? String(cells[0]) : ''
      salesPrice = normalizePastedNumber(cells[1])
      shipping = normalizePastedNumber(cells[5])
      purchasePrice = normalizePastedNumber(cells[6])
      const last = cells[cells.length - 1]
      const parsedEnd = parsePastedDate(last)
      if (parsedEnd) dateOfPrices = parsedEnd
      else if (cells[10] != null && String(cells[10]).trim()) {
        const d10 = parsePastedDate(cells[10])
        if (d10) dateOfPrices = d10
      }
    } else if (n >= 3) {
      itemNo = cells[0] != null ? String(cells[0]) : ''
      purchasePrice = normalizePastedNumber(cells[1])
      shipping = normalizePastedNumber(cells[2])
      if (cells[3] != null && String(cells[3]).trim()) {
        const d = parsePastedDate(cells[3])
        if (d) dateOfPrices = d
      }
    } else if (n === 2) {
      purchasePrice = normalizePastedNumber(cells[0])
      shipping = normalizePastedNumber(cells[1])
    } else {
      purchasePrice = normalizePastedNumber(cells[0])
    }

    rows.push({ itemNo, salesPrice, purchasePrice, shipping, dateOfPrices })
  }

  let hint = 'ok'
  if (rows.length === 0) hint = 'no-data-rows'

  return { rows, skippedHeader, hint }
}

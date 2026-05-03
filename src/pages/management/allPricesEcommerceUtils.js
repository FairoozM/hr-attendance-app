/** Local persistence for ecommerce price list (UAE AED). */

export const STORAGE_KEY_RATES = 'hr-all-prices-ecommerce-rates-v1'
export const STORAGE_KEY_ROWS = 'hr-all-prices-ecommerce-rows-v1'

export const DEFAULT_RATES = {
  /** Percent values 0–100 for UI; formulas use decimals */
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

/**
 * Required selling price from purchase + shipping.
 * Sales = (Purchase + Shipping) / (1 - VAT - Commission - Advertising - RequiredProfit)
 */
export function computeEcommercePriceRow(row, rates = DEFAULT_RATES) {
  const purchase = Number(row.purchasePrice)
  const shipping = Number(row.shipping)
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)
  const reqProfit = toDec(rates.requiredProfitPct)

  const sumTake = vat + commission + advertising + reqProfit
  const denominator = 1 - sumTake

  const safePurchase = Number.isFinite(purchase) ? purchase : 0
  const safeShipping = Number.isFinite(shipping) ? shipping : 0

  if (denominator <= 0 || denominator >= 1) {
    return {
      denominatorInvalid: true,
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

  const numerator = safePurchase + safeShipping
  const salesPriceRaw = numerator / denominator
  const salesPrice = Math.round(salesPriceRaw)

  const vatAmount = salesPrice * vat
  const commissionAmount = salesPrice * commission
  const advertisingAmount = salesPrice * advertising

  const totalCost = safePurchase + vatAmount + commissionAmount + advertisingAmount + safeShipping
  const profit = salesPrice - totalCost
  const profitPct = salesPrice > 0 ? (profit / salesPrice) * 100 : 0

  return {
    denominatorInvalid: false,
    salesPriceRaw,
    salesPrice,
    vatAmount,
    commissionAmount,
    advertisingAmount,
    totalCost,
    profit,
    profitPct,
  }
}

export function makeRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function seedEcommerceRows() {
  return Array.from({ length: 17 }, (_, i) => ({
    id: makeRowId(),
    itemNo: `BRKH-64-${i + 1}`,
    purchasePrice: i === 0 ? 26.83 : '',
    shipping: i === 0 ? 21 : '',
    dateOfPrices: '',
  }))
}

export function loadRates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RATES)
    if (!raw) return { ...DEFAULT_RATES }
    const p = JSON.parse(raw)
    return {
      vatPct: Number.isFinite(Number(p.vatPct)) ? Number(p.vatPct) : DEFAULT_RATES.vatPct,
      commissionPct: Number.isFinite(Number(p.commissionPct)) ? Number(p.commissionPct) : DEFAULT_RATES.commissionPct,
      advertisingPct: Number.isFinite(Number(p.advertisingPct)) ? Number(p.advertisingPct) : DEFAULT_RATES.advertisingPct,
      requiredProfitPct: Number.isFinite(Number(p.requiredProfitPct)) ? Number(p.requiredProfitPct) : DEFAULT_RATES.requiredProfitPct,
    }
  } catch {
    return { ...DEFAULT_RATES }
  }
}

export function saveRates(rates) {
  try {
    localStorage.setItem(STORAGE_KEY_RATES, JSON.stringify(rates))
  } catch {
    /* ignore */
  }
}

export function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ROWS)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.map((r) => ({
      id: r.id || makeRowId(),
      itemNo: r.itemNo != null ? String(r.itemNo) : '',
      purchasePrice: r.purchasePrice ?? '',
      shipping: r.shipping ?? '',
      dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
    }))
  } catch {
    return null
  }
}

export function saveRows(rows) {
  try {
    localStorage.setItem(STORAGE_KEY_ROWS, JSON.stringify(rows))
  } catch {
    /* ignore */
  }
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
 * One logical row for the app (ids assigned by caller).
 * @typedef {{ itemNo: string, purchasePrice: string, shipping: string, dateOfPrices: string }} PastedRowPatch
 */

/**
 * Parse Excel copy-paste (TSV). Supports:
 * - Full sheet row: Item | Sales | VAT | Comm | Adv | Shipping | Purchase | … optional date last col
 * - Three columns: Item | Purchase | Shipping
 * - Two columns: Purchase | Shipping
 * @returns {{ rows: PastedRowPatch[], skippedHeader: boolean, hint: string }}
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
    let purchasePrice = ''
    let shipping = ''
    let dateOfPrices = ''

    const n = cells.length

    if (n >= 7) {
      itemNo = cells[0] != null ? String(cells[0]) : ''
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

    rows.push({ itemNo, purchasePrice, shipping, dateOfPrices })
  }

  let hint = 'ok'
  if (rows.length === 0) hint = 'no-data-rows'

  return { rows, skippedHeader, hint }
}

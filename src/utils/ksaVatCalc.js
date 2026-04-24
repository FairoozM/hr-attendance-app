/**
 * Pure KSA VAT calculation helpers — no React, no API calls.
 *
 * KSA standard VAT rate: 15% (effective 1 July 2020).
 *
 * Zoho Books may or may not return a `tax_amount` / `invoice_tax` figure on
 * list-level responses. When available we always prefer the Zoho figure;
 * when it is zero or missing we fall back to taxable_amount × KSA_VAT_RATE.
 */

export const KSA_VAT_RATE = 0.15

/**
 * Format a number as SAR currency.
 * e.g. 12345.6  → "SAR 12,345.60"
 *
 * @param {number|null|undefined} val
 * @returns {string}
 */
export function formatSAR(val) {
  if (val == null) return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  return `SAR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Resolve the effective VAT amount for a group of documents.
 *
 * If Zoho returned a non-zero `zohoTaxAmount`, use it directly.
 * Otherwise derive it as `taxableAmount × KSA_VAT_RATE`.
 *
 * @param {number} taxableAmount  Sum of taxable (sub-total) amounts
 * @param {number} zohoTaxAmount  Sum of tax amounts as returned by Zoho
 * @returns {number}
 */
export function resolveVatAmount(taxableAmount, zohoTaxAmount) {
  if (zohoTaxAmount > 0) return zohoTaxAmount
  return taxableAmount * KSA_VAT_RATE
}

/**
 * Compute the full KSA VAT summary for display.
 *
 * @param {{
 *   invoiceTaxable: number,
 *   invoiceTax:     number,   // from Zoho (0 means "use rate")
 *   cnTaxable:      number,
 *   cnTax:          number,   // from Zoho (0 means "use rate")
 *   otherInputVat:  number,   // user-entered manual adjustment
 * }} params
 *
 * @returns {{
 *   outputVat:          number,  // VAT on invoices
 *   cnVatAdjustment:    number,  // VAT on credit notes (reduces payable)
 *   netOutputVat:       number,  // outputVat - cnVatAdjustment
 *   otherInputVat:      number,  // user-entered
 *   netVatPayable:      number,  // netOutputVat - otherInputVat
 *   invoiceTaxUsedRate: boolean, // true when Zoho tax was missing → rate used
 *   cnTaxUsedRate:      boolean,
 * }}
 */
export function calcVatSummary({ invoiceTaxable, invoiceTax, cnTaxable, cnTax, otherInputVat }) {
  const taxable  = Number(invoiceTaxable) || 0
  const invTax   = Number(invoiceTax)     || 0
  const cnTaxAmt = Number(cnTaxable)      || 0
  const cnTaxIn  = Number(cnTax)          || 0
  const other    = Number(otherInputVat)  || 0

  const invoiceTaxUsedRate = invTax === 0 && taxable > 0
  const cnTaxUsedRate      = cnTaxIn === 0 && cnTaxAmt > 0

  const outputVat       = resolveVatAmount(taxable,  invTax)
  const cnVatAdjustment = resolveVatAmount(cnTaxAmt, cnTaxIn)
  const netOutputVat    = outputVat - cnVatAdjustment
  const netVatPayable   = netOutputVat - other

  return {
    outputVat,
    cnVatAdjustment,
    netOutputVat,
    otherInputVat:      other,
    netVatPayable,
    invoiceTaxUsedRate,
    cnTaxUsedRate,
  }
}

/**
 * Return the start/end dates for a given quarter number (1-4) and year.
 *
 * @param {number} q     1-based quarter (1 = Jan-Mar, 2 = Apr-Jun, …)
 * @param {number} year  e.g. 2026
 * @returns {{ from: string, to: string }}  YYYY-MM-DD strings
 */
export function quarterRange(q, year) {
  const startMonth = (q - 1) * 3           // 0, 3, 6, 9  (0-indexed)
  const endMonth   = startMonth + 2
  const start = new Date(year, startMonth, 1)
  const end   = new Date(year, endMonth + 1, 0)  // last day of endMonth
  const iso   = (d) => d.toISOString().slice(0, 10)
  return { from: iso(start), to: iso(end) }
}

/**
 * Default to the PREVIOUS complete quarter.
 * When filing VAT in April 2026, we default to Q1 2026 (Jan–Mar).
 *
 * @returns {{ from: string, to: string }}  YYYY-MM-DD strings
 */
export function defaultQuarterRange() {
  const now   = new Date()
  const year  = now.getFullYear()
  const curQ  = Math.floor(now.getMonth() / 3) + 1  // 1-based current quarter

  const prevQ    = curQ === 1 ? 4 : curQ - 1
  const prevYear = curQ === 1 ? year - 1 : year

  return quarterRange(prevQ, prevYear)
}

/**
 * Return Q1–Q4 presets for the current and previous year.
 * Used by the date preset buttons in KsaVatReportPage.
 *
 * @returns {Array<{ label: string, from: string, to: string }>}
 */
export function quarterPresets() {
  const now      = new Date()
  const year     = now.getFullYear()
  const curQ     = Math.floor(now.getMonth() / 3) + 1  // 1-based

  const presets = []
  // Show quarters from most-recent-past to oldest
  for (let q = curQ - 1; q >= 1; q--) {
    const r = quarterRange(q, year)
    presets.push({ label: `Q${q} ${year}`, ...r })
  }
  // Fill remaining quarters from previous year
  for (let q = 4; q >= curQ; q--) {
    const r = quarterRange(q, year - 1)
    presets.push({ label: `Q${q} ${year - 1}`, ...r })
  }
  return presets.slice(0, 4)  // show at most 4 presets
}

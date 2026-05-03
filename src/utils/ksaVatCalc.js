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
 * Compute VAT at the KSA rate on a taxable amount.
 * VAT is always calculated — Zoho does not store tax amounts for this org.
 *
 * @param {number} taxableAmount
 * @returns {number}
 */
export function resolveVatAmount(taxableAmount) {
  return (Number(taxableAmount) || 0) * KSA_VAT_RATE
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
export function calcVatSummary({ invoiceTaxable, cnTaxable, otherInputVat }) {
  const taxable  = Number(invoiceTaxable) || 0
  const cnTaxAmt = Number(cnTaxable)      || 0
  const other    = Number(otherInputVat)  || 0

  const outputVat       = resolveVatAmount(taxable)
  const cnVatAdjustment = resolveVatAmount(cnTaxAmt)
  const netOutputVat    = outputVat - cnVatAdjustment
  const netVatPayable   = netOutputVat - other

  return {
    outputVat,
    cnVatAdjustment,
    netOutputVat,
    otherInputVat: other,
    netVatPayable,
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
  const startMonth = (q - 1) * 3  // 0, 3, 6, 9
  const endMonth   = startMonth + 2
  // Build YYYY-MM-DD directly (no Date object) to avoid UTC timezone shift.
  const pad2  = (n) => String(n).padStart(2, '0')
  const lastDay = new Date(year, endMonth + 1, 0).getDate()  // safe: only .getDate() used
  return {
    from: `${year}-${pad2(startMonth + 1)}-01`,
    to:   `${year}-${pad2(endMonth + 1)}-${pad2(lastDay)}`,
  }
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
/**
 * Return Q1–Q4 presets for the current year only, in natural order.
 * e.g. in April 2026 → [Q1 2026, Q2 2026, Q3 2026, Q4 2026]
 *
 * @returns {Array<{ label: string, from: string, to: string }>}
 */
export function quarterPresets() {
  const year = new Date().getFullYear()
  return [1, 2, 3, 4].map((q) => ({ label: `Q${q} ${year}`, ...quarterRange(q, year) }))
}

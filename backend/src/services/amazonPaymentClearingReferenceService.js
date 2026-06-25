// Builds consistent, audit-friendly Zoho reference numbers and descriptions for
// every accounting entry generated from an Amazon settlement batch. The goal is
// that a finance user opening Zoho months later can immediately identify the
// Amazon settlement period, the settlement/report IDs, and the HR & BI batch
// that produced the entry.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Short, stable suffixes appended to the settlement reference base so each entry
// type stays uniquely identifiable in Zoho while still carrying the period.
const ENTRY_TYPE_CODES = Object.freeze({
  net_balance: 'NET',
  commission: 'COMM',
  shipping_fba: 'SHIP',
  advertising: 'ADV',
  storage: 'STG',
  refund_return: 'CN',
  adjustment: 'ADJ',
})

const ENTRY_TYPE_LABELS = Object.freeze({
  net_balance: 'Net Balance Clearing',
  commission: 'Commission Clearing',
  shipping_fba: 'Shipping/FBA Clearing',
  advertising: 'Advertising Fee Clearing',
  storage: 'Storage Fee Clearing',
  refund_return: 'Refund / Credit Note Clearing',
  adjustment: 'Adjustment Clearing',
})

function parseYmd(value) {
  if (!value) return null
  const s = String(value).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
  const dt = new Date(s)
  if (!Number.isNaN(dt.getTime())) {
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
  }
  return null
}

// Compact YYYYMMDD used inside the reference number (e.g. 20260601).
function compactYmd(value) {
  const p = parseYmd(value)
  if (!p) return ''
  return `${p.y}${String(p.mo).padStart(2, '0')}${String(p.d).padStart(2, '0')}`
}

// Human readable "01 Jun 2026" used in descriptions. Parsed manually to avoid
// timezone shifting of date-only strings.
function displayYmd(value) {
  const p = parseYmd(value)
  if (!p) return ''
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1] || ''} ${p.y}`.trim()
}

function displayZohoYmd(value) {
  return displayYmd(value).replace(/ /g, '-')
}

/**
 * Derive the settlement reference metadata for a batch.
 * @returns {{marketplace,settlementId,reportId,startDate,endDate,startDisplay,endDisplay,periodText,referenceBase,batchId}}
 */
function buildSettlementReference(batch) {
  const report = batch?.report || {}
  const marketplace = String(batch?.marketplace || report.marketplace || 'KSA').toUpperCase()
  const settlementId = String(report.settlementId || batch?.settlementId || '').trim()
  const reportId = String(report.reportId || batch?.reportId || '').trim()
  const startDate = report.settlementStartDate || ''
  const endDate = report.settlementEndDate || ''
  const startCompact = compactYmd(startDate)
  const endCompact = compactYmd(endDate)
  const startDisplay = displayYmd(startDate)
  const endDisplay = displayYmd(endDate)
  const startZohoDisplay = displayZohoYmd(startDate)
  const endZohoDisplay = displayZohoYmd(endDate)

  let referenceBase
  if (startCompact && endCompact) {
    referenceBase = `AMZ-${marketplace}-${startCompact}-${endCompact}`
  } else if (settlementId) {
    referenceBase = `AMZ-${marketplace}-SETTLEMENT-${settlementId}`
  } else {
    referenceBase = `AMZ-${marketplace}-BATCH-${batch?.batchId ?? 'NA'}`
  }

  const periodText =
    startDisplay && endDisplay
      ? `${startDisplay} - ${endDisplay}`
      : startDisplay || endDisplay || ''
  const zohoReferenceNumber =
    startZohoDisplay && endZohoDisplay
      ? `${startZohoDisplay} to ${endZohoDisplay}`
      : ''

  return {
    marketplace,
    settlementId,
    reportId,
    startDate,
    endDate,
    startDisplay,
    endDisplay,
    periodText,
    zohoReferenceNumber,
    referenceBase,
    batchId: batch?.batchId ?? null,
  }
}

function entryTypeLabel(paymentType) {
  return ENTRY_TYPE_LABELS[paymentType] || 'Settlement Clearing'
}

// Reference number for a specific entry type, e.g. AMZ-KSA-20260601-20260615-NET.
function referenceNumberFor(reference, paymentType) {
  if (reference?.zohoReferenceNumber) return reference.zohoReferenceNumber
  const code =
    ENTRY_TYPE_CODES[paymentType] ||
    String(paymentType || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 6) ||
    'ENTRY'
  return `${reference.referenceBase}-${code}`
}

// Multi-line description sent to Zoho with full settlement traceability.
function descriptionFor(reference, entryLabel) {
  const lines = [`Amazon ${reference.marketplace} Settlement`]
  if (reference.periodText) lines.push(`Period: ${reference.periodText}`)
  if (reference.settlementId) lines.push(`Settlement ID: ${reference.settlementId}`)
  if (reference.reportId) lines.push(`Report ID: ${reference.reportId}`)
  if (entryLabel) lines.push(`Entry: ${entryLabel}`)
  if (reference.batchId != null) lines.push(`Batch: #${reference.batchId}`)
  return lines.join('\n')
}

/**
 * Build the reference + description pair for a single posting entry type.
 */
function buildEntryReference(reference, paymentType, entryLabelOverride) {
  const entryLabel = entryLabelOverride || entryTypeLabel(paymentType)
  return {
    paymentType,
    entryLabel,
    referenceNumber: referenceNumberFor(reference, paymentType),
    description: descriptionFor(reference, entryLabel),
  }
}

module.exports = {
  ENTRY_TYPE_CODES,
  ENTRY_TYPE_LABELS,
  buildSettlementReference,
  referenceNumberFor,
  descriptionFor,
  entryTypeLabel,
  buildEntryReference,
  compactYmd,
  displayYmd,
  displayZohoYmd,
}

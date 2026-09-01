const { clean } = require('./noonOrderIdHelper')

/** Zoho Books customer payment reference_number max length. */
const ZOHO_REFERENCE_MAX_LEN = 50

function formatDayMonYear(isoDate) {
  const s = clean(isoDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = s.split('-')
  return `${d}-${months[Number(m) - 1]}-${y}`
}

/**
 * Every Zoho entry for a statement carries its Noon statement number, so a ledger
 * row can always be traced back to the settlement that produced it. The date range
 * is only a fallback: it does not identify the statement and will not fit alongside
 * the number inside Zoho's 50-character reference limit.
 */
function buildSettlementReference(metadata = {}) {
  if (typeof metadata === 'string') return clean(metadata) || 'NOON-AE Settlement'
  const ref = clean(metadata.referenceNr)
  if (ref) return `NOON-AE ${ref}`
  const start = formatDayMonYear(metadata.statementStartDate || metadata.startDate)
  const end = formatDayMonYear(metadata.statementEndDate || metadata.endDate)
  if (start && end) return `NOON-AE ${start} to ${end}`
  return 'NOON-AE Settlement'
}

/** Short suffixes so Zoho reference_number stays under 50 chars. */
function shortReferenceLabel(label = '') {
  const raw = clean(label)
  const key = raw.toLowerCase().replace(/\s+/g, '_')
  const map = {
    net_balance: 'net',
    net_undeposited: 'net',
    net: 'net',
    commission: 'comm',
    fulfillment_shipping: 'ship',
    fulfillment: 'ship',
    shipping: 'ship',
  }
  if (map[key]) return map[key]
  if (key.startsWith('uncleared_reclass')) return 'reclass'
  if (key.startsWith('fee_journal') || key.includes('advertising')) return 'fee'
  // Keep short readable stub
  return raw.length <= 12 ? raw : raw.slice(0, 12)
}

function truncateZohoReference(value, maxLen = ZOHO_REFERENCE_MAX_LEN) {
  const s = clean(value)
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen)
}

/**
 * @param {object|string} metadata statement metadata, or an already-built base reference
 * @param {string} label entry type, shortened to keep the statement number intact
 * @param {string} detail optional discriminator (item order id) — added only if it fits
 */
function buildEntryReference(metadata = {}, label = '', detail = '') {
  const base = buildSettlementReference(metadata)
  const suffix = shortReferenceLabel(label)
  const full = suffix ? `${base} ${suffix}` : base
  const withDetail = clean(detail) ? `${full} ${clean(detail)}` : full
  // Truncating would cut the discriminator mid-id, which reads as a different item.
  if (withDetail.length <= ZOHO_REFERENCE_MAX_LEN) return withDetail
  return truncateZohoReference(full, ZOHO_REFERENCE_MAX_LEN)
}

module.exports = {
  ZOHO_REFERENCE_MAX_LEN,
  buildSettlementReference,
  buildEntryReference,
  shortReferenceLabel,
  truncateZohoReference,
  formatDayMonYear,
}

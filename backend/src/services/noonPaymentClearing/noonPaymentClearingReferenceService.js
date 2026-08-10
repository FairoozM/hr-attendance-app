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

function buildSettlementReference(metadata = {}) {
  const start = formatDayMonYear(metadata.statementStartDate || metadata.startDate)
  const end = formatDayMonYear(metadata.statementEndDate || metadata.endDate)
  if (start && end) return `NOON-AE ${start} to ${end}`
  const ref = clean(metadata.referenceNr)
  return ref ? `NOON-AE ${ref}` : 'NOON-AE Settlement'
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

function buildEntryReference(metadata = {}, label = '') {
  const base = buildSettlementReference(metadata)
  const suffix = shortReferenceLabel(label)
  const full = suffix ? `${base} ${suffix}` : base
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

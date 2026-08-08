const { clean } = require('./noonOrderIdHelper')

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

function buildEntryReference(metadata = {}, label = '') {
  const base = buildSettlementReference(metadata)
  const suffix = clean(label)
  return suffix ? `${base} ${suffix}` : base
}

module.exports = {
  buildSettlementReference,
  buildEntryReference,
  formatDayMonYear,
}

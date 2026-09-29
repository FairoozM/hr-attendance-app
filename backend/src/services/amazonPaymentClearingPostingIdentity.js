/**
 * Stable posting identities for grouped journal entries. Identities derive from what
 * the journal represents, never from its position in a list, so reordering or adding
 * mappings cannot make a posted journal look unposted.
 */
const crypto = require('crypto')

const FEE_JOURNAL_PREFIX = 'fee_journal:'
const RETURN_FEE_JOURNAL_PREFIX = 'return_fee_journal:'
const LEGACY_FEE_JOURNAL = /^fee_journal_\d+$/
const LEGACY_RETURN_FEE_JOURNAL = /^return_fee_journal_\d+$/
const MAX_PAYMENT_TYPE_LENGTH = 64

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function shortHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)
}

/**
 * @param {{ normalizedFeeType?: string, feeType?: string, rawTransactionType?: string, description?: string }} line
 * @param {string} marketplace
 */
function feeJournalIdentity(line, marketplace) {
  const parts = [
    clean(marketplace).toUpperCase(),
    clean(line.normalizedFeeType || line.feeType).toUpperCase(),
    clean(line.rawTransactionType).toLowerCase(),
    clean(line.description).toLowerCase(),
  ]
  return `${FEE_JOURNAL_PREFIX}${shortHash(parts.join('|'))}`
}

/** @param {{ normalizedFeeType?: string, feeType?: string }} line */
function returnFeeJournalIdentity(line) {
  const type = clean(line.normalizedFeeType || line.feeType).toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  const identity = `${RETURN_FEE_JOURNAL_PREFIX}${type}`
  if (type && identity.length <= MAX_PAYMENT_TYPE_LENGTH) return identity
  return `${RETURN_FEE_JOURNAL_PREFIX}${shortHash(type)}`
}

function duplicateIdentityError(kind, identity, labels) {
  const err = new Error(
    `Two ${kind} entries resolve to the same posting identity (${labels.join(' / ')}). ` +
      'Merge or split the mapping so each journal is distinct. Nothing was posted.'
  )
  err.code = 'AMAZON_PAYMENT_CLEARING_DUPLICATE_JOURNAL_IDENTITY'
  err.status = 422
  err.identity = identity
  return err
}

/**
 * @template T
 * @param {T[]} lines
 * @param {(line: T) => string} identityOf
 * @param {(line: T) => string} labelOf
 * @param {string} kind
 * @returns {Array<T & { paymentType: string }>}
 */
function assignIdentities(lines, identityOf, labelOf, kind) {
  const seen = new Map()
  return lines.map((line) => {
    const paymentType = identityOf(line)
    if (seen.has(paymentType)) throw duplicateIdentityError(kind, paymentType, [seen.get(paymentType), labelOf(line)])
    seen.set(paymentType, labelOf(line))
    return { ...line, paymentType }
  })
}

/**
 * Map legacy positional rows (fee_journal_1, return_fee_journal_2, ...) to the stable
 * identity they were created for, using the snapshot stored with each row.
 * Rows that cannot be mapped unambiguously are returned in `unmapped`.
 * @param {any[]} postings
 * @param {'fee'|'return_fee'} kind
 * @param {string} marketplace
 * @param {Array<{ paymentType: string, referenceNumber?: string, amount?: number, totalAmount?: number }>} currentLines
 */
function mapLegacyJournalPostings(postings, kind, marketplace, currentLines) {
  const pattern = kind === 'fee' ? LEGACY_FEE_JOURNAL : LEGACY_RETURN_FEE_JOURNAL
  /** @type {Map<string, any>} */
  const byIdentity = new Map()
  const unmapped = []
  /** @type {Set<string>} */
  const ambiguous = new Set()
  for (const posting of postings) {
    if (!pattern.test(clean(posting.paymentType))) continue
    const snap = posting.mappingSnapshot || {}
    let identity = ''
    if (kind === 'fee' && (snap.normalizedFeeType || snap.feeType)) {
      identity = feeJournalIdentity(snap, marketplace)
    } else if (kind === 'return_fee' && (snap.normalizedFeeType || snap.feeType)) {
      identity = returnFeeJournalIdentity(snap)
    } else {
      const matches = currentLines.filter(
        (line) =>
          clean(line.referenceNumber) === clean(posting.referenceNumber) &&
          Math.abs(Math.abs(Number(line.amount ?? line.totalAmount) || 0) - Math.abs(Number(posting.amount) || 0)) < 0.01
      )
      if (matches.length === 1) identity = matches[0].paymentType
    }
    if (!identity) {
      unmapped.push(posting)
      continue
    }
    if (byIdentity.has(identity)) ambiguous.add(identity)
    else byIdentity.set(identity, posting)
  }
  return { byIdentity, unmapped, ambiguous }
}

module.exports = {
  FEE_JOURNAL_PREFIX,
  RETURN_FEE_JOURNAL_PREFIX,
  LEGACY_FEE_JOURNAL,
  LEGACY_RETURN_FEE_JOURNAL,
  feeJournalIdentity,
  returnFeeJournalIdentity,
  assignIdentities,
  mapLegacyJournalPostings,
}

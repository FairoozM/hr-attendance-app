/**
 * Idempotent Zoho accounting write for one clearing entry.
 *
 * Local posting row states:
 *   pending               write-ahead row; a create was (or is about to be) sent
 *   posted                Zoho record id known and verified
 *   failed                Zoho definitively rejected the create; safe to try again
 *   verification_required Zoho state is uncertain or does not match; never auto-reposted
 */

const { isAmbiguousWriteError } = require('./amazonPaymentClearingZohoRecovery')

const STATUS = Object.freeze({
  PENDING: 'pending',
  POSTED: 'posted',
  FAILED: 'failed',
  VERIFICATION_REQUIRED: 'verification_required',
})

const DEFAULT_STALE_ATTEMPT_MS = 15 * 60 * 1000

/**
 * @typedef {import('./amazonPaymentClearingZohoRecovery').LookupResult} LookupResult
 * @typedef {{
 *   status: 'posted'|'failed'|'verification_required',
 *   alreadyPosted: boolean,
 *   created: boolean,
 *   zohoId: string,
 *   zohoNumber: string,
 *   message: string,
 *   posting: any,
 *   verification: any,
 * }} SafeWriteResult
 */

function errorText(err) {
  return String(err?.message || err || 'Unknown error').slice(0, 1000)
}

function verificationRecord(result, reason, now) {
  return {
    reason,
    outcome: result?.outcome || 'error',
    message: result?.message || '',
    candidates: result?.candidates || [],
    checkedAt: now(),
  }
}

/**
 * @param {{
 *   store: { findPostingByKey: Function, beginPosting: Function, updatePostingOutcome: Function, insertPosting: Function },
 *   row: Record<string, any>,
 *   label: string,
 *   lookup: (localRow: any|null) => Promise<LookupResult>,
 *   verifyById?: ((zohoId: string, localRow: any) => Promise<LookupResult>) | null,
 *   create: () => Promise<{ zohoId: string, zohoNumber?: string, extra?: Record<string, any> }>,
 *   now?: () => string,
 *   force?: boolean,
 *   staleAttemptMs?: number,
 * }} input
 * `force` (admin force repost): a single exact Zoho match is linked as posted, a recorded
 * entry whose Zoho record is gone is posted again, and an uncertain earlier attempt with no
 * Zoho record is resent only once it is older than `staleAttemptMs`, because Zoho can
 * finish saving a timed-out payment well after the request fails.
 * @returns {Promise<SafeWriteResult>}
 */
async function runSafeWrite(input) {
  const { store, row, label, lookup, create } = input
  const verifyById = input.verifyById || null
  const now = input.now || (() => new Date().toISOString())
  const force = input.force === true
  const staleAttemptMs = Number.isFinite(input.staleAttemptMs) ? input.staleAttemptMs : DEFAULT_STALE_ATTEMPT_MS

  /** @returns {SafeWriteResult} */
  const result = (status, posting, extra = {}) => ({
    status,
    alreadyPosted: false,
    created: false,
    zohoId: posting?.zohoPaymentId || '',
    zohoNumber: posting?.zohoJournalNumber || '',
    message: posting?.errorMessage || '',
    posting,
    verification: posting?.mappingSnapshot?.verification || null,
    ...extra,
  })

  const needsVerification = async (posting, lookupResult, reason) => {
    const verification = verificationRecord(lookupResult, reason, now)
    const message = `${label}: verification required — ${lookupResult?.message || reason}`
    let saved
    if (posting) {
      saved = await store.updatePostingOutcome(posting.id, {
        status: STATUS.VERIFICATION_REQUIRED,
        errorMessage: message,
        snapshotPatch: { verification },
      })
    } else {
      saved = await store.insertPosting({
        ...row,
        zohoPaymentId: null,
        status: STATUS.VERIFICATION_REQUIRED,
        errorMessage: message,
        mappingSnapshot: { ...(row.mappingSnapshot || {}), attempted: false, verification },
      })
    }
    return result(STATUS.VERIFICATION_REQUIRED, saved, { message, verification })
  }

  const markPosted = async (posting, match, snapshotPatch, flags) => {
    const saved = await store.updatePostingOutcome(posting.id, {
      status: STATUS.POSTED,
      zohoPaymentId: match.zohoId,
      zohoJournalNumber: match.zohoNumber || null,
      errorMessage: null,
      snapshotPatch,
    })
    return result(STATUS.POSTED, saved, {
      zohoId: match.zohoId,
      zohoNumber: match.zohoNumber || saved?.zohoJournalNumber || '',
      message: '',
      ...flags,
    })
  }

  const safeLookup = async (localRow) => {
    try {
      return await lookup(localRow || null)
    } catch (err) {
      return { outcome: 'error', match: null, candidates: [], message: `Zoho lookup failed: ${errorText(err)}` }
    }
  }

  const adopt = async (posting, check) => {
    const snapshotPatch = { adopted: true, verification: verificationRecord(check, 'force repost linked the matching Zoho record', now) }
    if (posting) return markPosted(posting, check.match, snapshotPatch, { alreadyPosted: true })
    const saved = await store.insertPosting({
      ...row,
      zohoPaymentId: check.match.zohoId,
      zohoJournalNumber: check.match.zohoNumber || null,
      status: STATUS.POSTED,
      errorMessage: null,
      mappingSnapshot: { ...(row.mappingSnapshot || {}), attempted: false, ...snapshotPatch },
    })
    return result(STATUS.POSTED, saved, {
      alreadyPosted: true,
      zohoId: check.match.zohoId,
      zohoNumber: check.match.zohoNumber || '',
      message: '',
    })
  }

  const release = (posting, check, why) =>
    store.updatePostingOutcome(posting.id, {
      status: STATUS.FAILED,
      errorMessage: `${label}: ${why}`,
      snapshotPatch: { verification: verificationRecord(check, why, now) },
    })

  const attemptIsStale = (posting) => {
    if (!posting.mappingSnapshot?.attempted || posting.zohoPaymentId) return true
    const at = Date.parse(posting.mappingSnapshot?.attemptedAt || posting.createdAt || '')
    return !Number.isFinite(at) || Date.now() - at >= staleAttemptMs
  }

  let existing = await store.findPostingByKey(row.batchId, row)

  if (existing && existing.status === STATUS.POSTED && existing.zohoPaymentId) {
    let check
    try {
      check = verifyById ? await verifyById(existing.zohoPaymentId, existing) : await lookup(existing)
    } catch (err) {
      check = { outcome: 'error', match: null, candidates: [], message: `Zoho re-check failed: ${errorText(err)}` }
    }
    const ok = check.outcome === 'exact' && (!check.match || check.match.zohoId === existing.zohoPaymentId)
    if (ok) {
      return result(STATUS.POSTED, existing, { alreadyPosted: true, message: '' })
    }
    if (check.outcome === 'error') {
      return result(STATUS.FAILED, existing, { alreadyPosted: true, message: `${label}: ${check.message}` })
    }
    if (!force || (check.outcome !== 'missing' && check.outcome !== 'none')) {
      return needsVerification(existing, check, 'recorded Zoho entry no longer matches')
    }
    existing = await release(existing, check, 'the recorded Zoho entry was deleted; posting it again')
  }

  if (existing && (existing.status === STATUS.PENDING || existing.status === STATUS.VERIFICATION_REQUIRED || existing.status === STATUS.POSTED)) {
    const check = await safeLookup(existing)
    const attempted = Boolean(existing.mappingSnapshot?.attempted)
    const sameAsRecorded = existing.zohoPaymentId && check.match?.zohoId === existing.zohoPaymentId
    if (check.outcome === 'exact' && (attempted || sameAsRecorded)) {
      return markPosted(
        existing,
        check.match,
        { verification: verificationRecord(check, 'recovered after uncertain outcome', now) },
        { alreadyPosted: true }
      )
    }
    if (check.outcome === 'exact' && force) return adopt(existing, check)
    if (check.outcome === 'error') {
      return result(existing.status === STATUS.PENDING ? STATUS.VERIFICATION_REQUIRED : existing.status, existing, {
        message: `${label}: ${check.message}`,
      })
    }
    if (check.outcome === 'none' && force && attemptIsStale(existing)) {
      existing = await release(existing, check, 'no Zoho record exists; posting it again')
    } else {
      const reason =
        check.outcome === 'none'
          ? force
            ? 'an earlier create timed out a few minutes ago and Zoho may still be saving it; run Force Repost again in 15 minutes'
            : 'an earlier create was sent but no Zoho record was found; release it after checking Zoho'
          : check.outcome === 'exact'
            ? 'a matching Zoho record exists but was not created by this run; link it to continue'
            : 'Zoho records do not exactly match'
      return needsVerification(existing, check, reason)
    }
  }

  const preflight = await safeLookup(existing)
  if (preflight.outcome === 'error') {
    return result(STATUS.FAILED, existing, { message: `${label}: ${preflight.message}. Nothing was posted.` })
  }
  if (preflight.outcome === 'exact' && force) return adopt(existing, preflight)
  if (preflight.outcome !== 'none') {
    const reason =
      preflight.outcome === 'exact'
        ? 'a matching Zoho record already exists; link it instead of posting again'
        : 'related Zoho records already exist and do not exactly match'
    return needsVerification(existing, preflight, reason)
  }

  const posting = await store.beginPosting({
    ...row,
    mappingSnapshot: { ...(row.mappingSnapshot || {}), attempted: true, attemptedAt: now(), verification: null },
  })

  let created
  try {
    created = await create()
    if (!created?.zohoId) {
      const err = new Error('Zoho accepted the request but returned no record id.')
      err.code = 'ZOHO_WRITE_RESPONSE_WITHOUT_ID'
      throw err
    }
  } catch (err) {
    if (!isAmbiguousWriteError(err)) {
      const message = `${label}: ${errorText(err)}`
      const saved = await store.updatePostingOutcome(posting.id, {
        status: STATUS.FAILED,
        errorMessage: message,
        snapshotPatch: { lastError: { message: errorText(err), code: err?.code || '', at: now() } },
      })
      return result(STATUS.FAILED, saved, { message })
    }
    const check = await safeLookup(posting)
    const patch = { lastError: { message: errorText(err), code: err?.code || '', ambiguous: true, at: now() } }
    if (check.outcome === 'exact') {
      return markPosted(
        posting,
        check.match,
        { ...patch, verification: verificationRecord(check, 'confirmed in Zoho after uncertain response', now) },
        { created: true }
      )
    }
    const saved = await store.updatePostingOutcome(posting.id, {
      status: STATUS.VERIFICATION_REQUIRED,
      errorMessage: `${label}: outcome unknown after "${errorText(err)}" — ${check.message}`,
      snapshotPatch: { ...patch, verification: verificationRecord(check, 'uncertain create response', now) },
    })
    return result(STATUS.VERIFICATION_REQUIRED, saved, { message: saved?.errorMessage || '' })
  }

  return markPosted(
    posting,
    { zohoId: String(created.zohoId), zohoNumber: created.zohoNumber || '' },
    { createdAt: now(), ...(created.extra || {}) },
    { created: true }
  )
}

module.exports = { STATUS, runSafeWrite }

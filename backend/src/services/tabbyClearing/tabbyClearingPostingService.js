'use strict'

/**
 * Posts one Tabby statement to Zoho, component by component, exactly as the preview the admin
 * reviewed (same posting fingerprint). Guards: posting enabled on the server, an admin actor, the
 * reviewed fingerprint, no blockers, the per-statement lock.
 *
 * For each component in phase order (sales → refunds → settlement journal → bank):
 *   - Zoho is searched directly (deep) first. One matching record: link it, never re-post.
 *     More than one: AMBIGUOUS_RECOVERY, stop. A differing record: NEEDS_REVIEW, stop.
 *   - An earlier attempt with an unknown result is only re-sent when Zoho still has nothing
 *     after the settle window; before that the run stops.
 *   - After a POST: a rejected request is FAILED (retry-eligible). An unknown result (timeout,
 *     5xx, no ID) triggers an immediate Zoho search: one match → VERIFIED, several →
 *     AMBIGUOUS_RECOVERY, none → POSTING_UNCERTAIN (rechecked on the next run).
 * The run stops at the first component that is not VERIFIED; a rerun posts only what is missing.
 */

const model = require('./tabbyClearingModel')
const zohoChecks = require('./tabbyClearingZoho')
const { buildTabbyPreview, publicPreview, RECOVERY_ACTION } = require('./tabbyClearingPreviewService')
const { COMPONENT_STATUS, BATCH_STATUS, EVENT, storeError } = require('./tabbyClearingStore')
const { postErrorKind } = require('../stripeClearing/stripeClearingPostingService')

const { COMPONENT, BANK_STATUS } = model
const { ZOHO_STATE } = zohoChecks
const S = COMPONENT_STATUS

function writeErrorKind(err) {
  if (Number(err && err.httpStatus) === 408) return 'ambiguous'
  return postErrorKind(err)
}

function safeMessage(err) {
  const msg = err && err.message ? String(err.message) : String(err)
  return msg.replace(/(access_token|refresh_token|client_secret)=[^&\s]+/gi, '$1=…').slice(0, 500)
}

async function write(writer, c) {
  if (c.zohoRecordType === 'customer_payment') return writer.createCustomerPayment(c.payload)
  if (c.zohoRecordType === 'journal') return writer.createJournal(c.payload)
  if (c.zohoRecordType === 'creditnote_refund') return writer.createCreditNoteRefund(c.creditNoteId, c.payload)
  if (c.zohoRecordType === 'bank_transfer') return writer.createBankTransfer(c.payload)
  throw new Error(`${c.zohoRecordType} is never posted.`)
}

/** Read the record just created by ID and compare it to the plan. */
async function verifyById(sources, c, recordId) {
  try {
    if (c.zohoRecordType === 'customer_payment') return zohoChecks.compareCustomerPayment(await sources.getCustomerPayment(recordId), c)
    if (c.zohoRecordType === 'journal') return zohoChecks.compareJournal(await sources.getJournal(recordId, { critical: true }), c)
    if (c.zohoRecordType === 'creditnote_refund') return zohoChecks.compareCreditNoteRefund(await sources.getCreditNoteRefund(c.creditNoteId, recordId, { critical: true }), c)
    if (c.zohoRecordType === 'bank_transfer') return zohoChecks.compareBankTransfer(await sources.getBankTransaction(recordId, { critical: true }), c)
  } catch (err) {
    return null
  }
  return null
}

function snapshotOf(c) {
  return {
    key: c.key,
    component: c.component,
    zohoRecordType: c.zohoRecordType,
    amount: c.amount,
    currency: c.currency,
    reference: c.reference,
    date: c.date,
    customerId: c.customerId || null,
    invoiceId: c.invoiceId || null,
    allocations: c.allocations || null,
    creditNoteId: c.creditNoteId || null,
    depositAccountId: c.depositAccountId || null,
    fromAccountId: c.fromAccountId || null,
    toAccountId: c.toAccountId || null,
    lines: c.lines || null,
    payload: c.payload,
  }
}

function fail(status, code, message, extra = {}) {
  const err = storeError(status, code, message)
  Object.assign(err, extra)
  return err
}

/** Progress is informational; a failing reporter must never interrupt posting. */
async function report(onProgress, progress) {
  if (typeof onProgress !== 'function') return
  try {
    await onProgress(progress)
  } catch (err) {
    console.error('[tabby-clearing] progress report failed:', err && err.message)
  }
}

/**
 * @param {{ batchId: string, store: object, sources: object, writer: object, config: object,
 *   actor: string, fingerprint: string, now?: () => Date,
 *   onProgress?: (p: { phase: string, done: number, total: number | null, current: string | null }) => unknown }} input
 */
async function postTabbyBatch({ batchId, store, sources, writer, config, actor, fingerprint, now = () => new Date(), onProgress }) {
  if (config.postingEnabled !== true) throw fail(403, 'POSTING_DISABLED', 'Tabby posting is disabled on this server (TABBY_CLEARING_POSTING_ENABLED is not true).')
  if (!actor) throw fail(401, 'ACTOR_REQUIRED', 'An authenticated admin is required to post.')
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Preview the statement and post the reviewed preview.')
  const batch = await store.getBatch(batchId)
  if (!batch) throw fail(404, 'BATCH_NOT_FOUND', `Tabby batch ${batchId} was not found.`)

  const lock = await store.acquireStatementLock(batch.statementNumber)
  const log = []
  let stoppedAt = null
  let stopReason = null
  try {
    await report(onProgress, { phase: 'CHECKING', done: 0, total: null, current: null })
    const preview = await buildTabbyPreview({ batchId, store, sources, config, now: now(), persist: false })
    if (preview.fingerprint !== fingerprint) {
      throw fail(409, 'PREVIEW_CHANGED', 'The statement, Zoho or the posting date changed since this preview. Review the new preview before posting.', { preview: publicPreview(preview) })
    }
    if (preview.blockers.length > 0) {
      await store.logEvent({ batchId, statementNumber: batch.statementNumber, eventType: EVENT.POSTING_BLOCKED, detail: preview.blockers.map((b) => b.message).slice(0, 10).join(' | '), actor })
      throw fail(409, 'POSTING_BLOCKED', `Posting is blocked: ${preview.blockers.map((b) => b.message).slice(0, 5).join(' ')}`, { preview: publicPreview(preview) })
    }
    await store.updateBatch(batchId, { status: BATCH_STATUS.POSTING, postingFingerprint: fingerprint })
    const settleMs = config.uncertainSettleMinutes * 60000

    const total = preview._plan.length
    for (const [i, c] of preview._plan.entries()) {
      await report(onProgress, { phase: 'POSTING', done: i, total, current: c.reference })
      const outcome = await postOne({ c, batchId, store, sources, writer, actor, now, settleMs })
      log.push({ key: c.key, component: c.component, reference: c.reference, amount: c.amount, ...outcome })
      if (outcome.status !== S.VERIFIED) {
        stoppedAt = c.key
        stopReason = outcome.message
        break
      }
    }
    await report(onProgress, { phase: 'FINISHING', done: stoppedAt ? log.length - 1 : total, total, current: null })

    const bank = preview._bank
    if (!stoppedAt && bank.status === BANK_STATUS.BANK_MATCHED && bank.matched && batch.bankTransactionId !== bank.matched.transactionId) {
      await store.setBankMatch(batchId, { status: BANK_STATUS.BANK_MATCHED, transactionId: bank.matched.transactionId, evidence: { ...bank.matched, window: bank.window }, actor })
      log.push({ key: `${batch.statementNumber}|BANK_SETTLEMENT|STATEMENT`, component: COMPONENT.BANK_SETTLEMENT, status: 'BANK_MATCHED', message: `Linked existing Zoho transfer ${bank.matched.referenceNumber || bank.matched.transactionId}; nothing posted.` })
    } else if (!stoppedAt && (bank.status === BANK_STATUS.BANK_MATCH_AMBIGUOUS || bank.status === BANK_STATUS.BANK_LOOKUP_FAILED)) {
      stopReason = `Bank step waiting: ${bank.reason}`
    }
  } finally {
    await lock.release()
  }

  const after = await buildTabbyPreview({ batchId, store, sources, config, now: now(), persist: true })
  if (after.status === BATCH_STATUS.POSTED) await store.updateBatch(batchId, { postedAt: now().toISOString() })
  return { batchId: String(batchId), status: after.status, stoppedAt, stopReason, log, preview: publicPreview(after) }
}

async function postOne({ c, batchId, store, sources, writer, actor, now, settleMs }) {
  const { component: planned } = await store.upsertPlannedComponent(batchId, c, actor)
  let local = planned
  if (local.status === S.VERIFIED) return { status: S.VERIFIED, zohoRecordId: local.zohoRecordId, message: 'Already verified.' }
  if (local.status === S.NEEDS_REVIEW) return { status: S.NEEDS_REVIEW, message: local.lastError || 'Flagged for review.' }

  const zoho = await zohoChecks.componentZohoState({ ...c, requestSnapshot: local.requestSnapshot }, sources, { deep: true })
  const stamp = () => now().toISOString()

  if (zoho.state === ZOHO_STATE.LOOKUP_FAILED) {
    if (local.status === S.POSTING_UNCERTAIN) {
      await store.transitionComponent(local.id, [S.POSTING_UNCERTAIN], S.POSTING_UNCERTAIN, { event: EVENT.RECOVERY_LOOKUP_FAILED, evidence: zoho }, `Zoho could not be searched: ${zoho.reason}`, actor)
    }
    return { status: local.status, message: zoho.reason }
  }
  if (zoho.state === ZOHO_STATE.AMBIGUOUS || zoho.state === ZOHO_STATE.CONFLICT) {
    const code = zoho.state === ZOHO_STATE.AMBIGUOUS ? 'AMBIGUOUS_RECOVERY' : 'ZOHO_RECORD_CONFLICT'
    await store.transitionComponent(local.id, [S.PLANNED, S.FAILED, S.POSTING, S.POSTING_UNCERTAIN, S.POSTED], S.NEEDS_REVIEW, { lastError: zoho.reason, recoveryStatus: code, event: zoho.state === ZOHO_STATE.AMBIGUOUS ? EVENT.AMBIGUOUS_RECOVERY : S.NEEDS_REVIEW, evidence: zoho }, zoho.reason, actor)
    return { status: S.NEEDS_REVIEW, code, message: zoho.reason }
  }
  if (zoho.state === ZOHO_STATE.VERIFIED) {
    if (local.zohoRecordId && local.zohoRecordId !== zoho.recordId) {
      const msg = `Local record points to Zoho ${local.zohoRecordId}, but Zoho has ${zoho.recordId}.`
      await store.transitionComponent(local.id, [local.status], S.NEEDS_REVIEW, { lastError: msg, event: S.NEEDS_REVIEW }, msg, actor)
      return { status: S.NEEDS_REVIEW, message: msg }
    }
    const recovered = local.status === S.POSTING_UNCERTAIN || local.status === S.POSTING
    await store.transitionComponent(local.id, [S.PLANNED, S.FAILED, S.POSTING, S.POSTING_UNCERTAIN, S.POSTED], S.VERIFIED, {
      zohoRecordId: zoho.recordId,
      verifiedAt: stamp(),
      recoveryStatus: recovered ? 'RECOVERED' : null,
      recoveryCheckAt: recovered ? stamp() : null,
      event: recovered ? EVENT.RECOVERY_MATCH_FOUND : EVENT.VERIFIED,
      evidence: zoho,
      clearError: true,
    }, c.zohoRecordType === 'creditnote_link' ? `Credit note ${c.creditNoteNumber || c.creditNoteId} checked; nothing posted.` : `Zoho ${zoho.recordId} matches ${c.reference}; not re-posted.`, actor)
    return { status: S.VERIFIED, zohoRecordId: zoho.recordId, message: recovered ? 'Recovered existing Zoho record.' : 'Already in Zoho; linked.' }
  }

  // MISSING
  if (c.zohoRecordType === 'creditnote_link') return { status: local.status, message: 'Credit note not found.' }
  if (local.status === S.POSTED || local.status === S.VERIFIED) {
    const msg = `Recorded as ${local.status} (${local.zohoRecordId}) but Zoho no longer has it.`
    await store.transitionComponent(local.id, [local.status], S.NEEDS_REVIEW, { lastError: msg, event: S.NEEDS_REVIEW }, msg, actor)
    return { status: S.NEEDS_REVIEW, message: msg }
  }
  if (local.status === S.POSTING || local.status === S.POSTING_UNCERTAIN) {
    const since = Date.parse(local.uncertainSince || local.updatedAt)
    if (now().getTime() - since < settleMs) {
      const msg = `Earlier attempt's result is unknown and Zoho has no record yet; recheck after ${new Date(since + settleMs).toISOString()}.`
      if (local.status === S.POSTING) {
        await store.transitionComponent(local.id, [S.POSTING], S.POSTING_UNCERTAIN, { uncertainAt: local.updatedAt, recoveryCheckAt: stamp(), recoveryStatus: 'AWAITING_RECHECK', event: EVENT.RECOVERY_STILL_MISSING }, msg, actor)
      } else {
        await store.transitionComponent(local.id, [S.POSTING_UNCERTAIN], S.POSTING_UNCERTAIN, { recoveryCheckAt: stamp(), event: EVENT.RECOVERY_STILL_MISSING }, msg, actor)
      }
      return { status: S.POSTING_UNCERTAIN, message: msg }
    }
    local = await store.transitionComponent(local.id, [S.POSTING, S.POSTING_UNCERTAIN], S.FAILED, {
      recoveryCheckAt: stamp(),
      recoveryStatus: 'SAFE_TO_RETRY',
      lastError: `Zoho had no record ${Math.round((now().getTime() - since) / 60000)} min after the unknown attempt; retry allowed.`,
      event: EVENT.RETRY_ALLOWED,
      evidence: zoho,
    }, null, actor)
  }

  const retry = local.attemptCount > 0
  local = await store.transitionComponent(local.id, [S.PLANNED, S.FAILED], S.POSTING, {
    incrementAttempt: true,
    requestSnapshot: snapshotOf(c),
    event: retry ? 'POSTING_RETRIED' : EVENT.POSTING_STARTED,
  }, `Posting ${c.component} ${c.amount.toFixed(2)} (${c.reference}).`, actor)

  let result
  let error = null
  try {
    result = await write(writer, c)
  } catch (err) {
    error = err
  }
  if (error && writeErrorKind(error) === 'rejected') {
    const msg = `Zoho rejected ${c.component}: ${safeMessage(error)}`
    await store.transitionComponent(local.id, [S.POSTING], S.FAILED, { lastError: msg, event: EVENT.POSTING_FAILED }, msg, actor)
    return { status: S.FAILED, message: msg }
  }
  if (error || !result || !result.recordId) {
    const why = error ? safeMessage(error) : 'Zoho answered without a record ID'
    const found = await zohoChecks.componentZohoState({ ...c, requestSnapshot: snapshotOf(c) }, sources, { deep: true })
    if (found.state === ZOHO_STATE.VERIFIED) {
      await store.transitionComponent(local.id, [S.POSTING], S.VERIFIED, { zohoRecordId: found.recordId, postedAt: stamp(), verifiedAt: stamp(), recoveryStatus: 'RECOVERED', recoveryCheckAt: stamp(), event: EVENT.RECOVERY_MATCH_FOUND, evidence: found }, `Response uncertain (${why}); Zoho ${found.recordId} found by reference.`, actor)
      return { status: S.VERIFIED, zohoRecordId: found.recordId, message: 'Response uncertain; record recovered from Zoho.' }
    }
    if (found.state === ZOHO_STATE.AMBIGUOUS || found.state === ZOHO_STATE.CONFLICT) {
      const code = found.state === ZOHO_STATE.AMBIGUOUS ? 'AMBIGUOUS_RECOVERY' : 'ZOHO_RECORD_CONFLICT'
      await store.transitionComponent(local.id, [S.POSTING], S.NEEDS_REVIEW, { lastError: `${why}; ${found.reason}`, recoveryStatus: code, recoveryCheckAt: stamp(), event: found.state === ZOHO_STATE.AMBIGUOUS ? EVENT.AMBIGUOUS_RECOVERY : S.NEEDS_REVIEW, evidence: found }, found.reason, actor)
      return { status: S.NEEDS_REVIEW, code, message: found.reason }
    }
    const msg = `Zoho response uncertain (${why}); ${found.state === ZOHO_STATE.MISSING ? 'no record found yet' : found.reason}. Not re-sent; rechecked on the next run.`
    await store.transitionComponent(local.id, [S.POSTING], S.POSTING_UNCERTAIN, { uncertainAt: stamp(), recoveryCheckAt: stamp(), recoveryStatus: 'AWAITING_RECHECK', lastError: msg, event: EVENT.POSTING_RESPONSE_UNCERTAIN, evidence: found }, msg, actor)
    return { status: S.POSTING_UNCERTAIN, message: msg }
  }

  await store.transitionComponent(local.id, [S.POSTING], S.POSTED, { zohoRecordId: result.recordId, postedAt: stamp(), event: EVENT.POSTED, clearError: true }, `Created Zoho ${result.recordId}.`, actor)
  const diffs = await verifyById(sources, c, result.recordId)
  if (diffs == null) return { status: S.POSTED, zohoRecordId: result.recordId, message: `Created Zoho ${result.recordId}; it could not be read back yet. The next run verifies it before anything else is posted.` }
  if (diffs.length) {
    const msg = `Zoho ${result.recordId} differs from the plan: ${diffs.join(' ')}`
    await store.transitionComponent(local.id, [S.POSTED], S.NEEDS_REVIEW, { lastError: msg, event: S.NEEDS_REVIEW }, msg, actor)
    return { status: S.NEEDS_REVIEW, message: msg }
  }
  await store.transitionComponent(local.id, [S.POSTED], S.VERIFIED, { verifiedAt: stamp(), event: EVENT.VERIFIED }, `Verified Zoho ${result.recordId}.`, actor)
  return { status: S.VERIFIED, zohoRecordId: result.recordId, message: `Posted and verified Zoho ${result.recordId}.` }
}

module.exports = { postTabbyBatch, postOne, writeErrorKind, RECOVERY_ACTION }

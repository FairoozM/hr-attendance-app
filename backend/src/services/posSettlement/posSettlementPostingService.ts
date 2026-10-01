'use strict'

/**
 * Approval and posting of one Mashreq payout.
 *
 * Approve: an admin approves the exact preview (its fingerprint); any later change in the
 * statement, Zoho, mappings or plan changes the fingerprint and voids the approval.
 *
 * Post (guards): POS_SETTLEMENT_POSTING_ENABLED=true, an admin actor, an approval whose
 * fingerprint equals the posted fingerprint and the fresh preview, no blockers, the per-payout lock.
 * Each component goes through the shared recovery engine (Tabby `postOne`): Zoho is searched by
 * reference first, an existing match is linked and never re-posted, an unknown result is never
 * re-sent until a full search after the settle window finds nothing. The run stops at the first
 * component that is not VERIFIED.
 */

const { buildPosPreview, publicPreview } = require('./posSettlementPreviewService.ts')
const { SETTLEMENT_STATUS, COMPONENT_STATUS, EVENT, storeError } = require('./posSettlementStore.ts')
const { BANK_STATUS, COMPONENT } = require('./posSettlementModel.ts')
const { postOne } = require('../tabbyClearing/tabbyClearingPostingService')

const S = COMPONENT_STATUS

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(storeError(status, code, message), extra)
}

async function report(onProgress: any, progress: any) {
  if (typeof onProgress !== 'function') return
  try {
    await onProgress(progress)
  } catch (err: any) {
    console.error('[pos-settlement] progress report failed:', err && err.message)
  }
}

/** Record that `actor` reviewed and approved exactly this preview. */
async function approvePosSettlement({ settlementId, store, sources, config, actor, fingerprint, note, now = () => new Date() }: any) {
  if (!actor) throw fail(401, 'ACTOR_REQUIRED', 'An authenticated admin is required to approve.')
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Approve the preview you reviewed.')
  const preview = await buildPosPreview({ settlementId, store, sources, config, now: now(), persist: true })
  if (preview.fingerprint !== fingerprint) throw fail(409, 'PREVIEW_CHANGED', 'The payout, Zoho or a mapping changed since this preview. Review the new preview.', { preview: publicPreview(preview) })
  if (preview.blockers.length) throw fail(409, 'APPROVAL_BLOCKED', `Cannot approve while blocked: ${preview.blockers.slice(0, 5).map((b: any) => b.message).join(' ')}`, { preview: publicPreview(preview) })
  const approval = { fingerprint, by: actor, at: now().toISOString(), note: note ? String(note).slice(0, 500) : null, totals: preview.totals, components: preview.components.map((c: any) => ({ key: c.key, amount: c.amount, reference: c.reference })) }
  await store.updateSettlement(settlementId, { approval })
  await store.logEvent({ settlementId, settlementCode: preview.settlementCode, eventType: EVENT.APPROVED, detail: `Approved ${preview.components.length} Zoho record(s), net ${preview.totals.net.toFixed(2)}${approval.note ? `: ${approval.note}` : ''}.`, evidence: { fingerprint }, actor })
  return { approval, preview: publicPreview({ ...preview, approval, approved: true, canPost: config.postingEnabled === true }) }
}

async function revokeApproval({ settlementId, store, actor, reason }: any) {
  const s = await store.getSettlement(settlementId)
  if (!s) throw fail(404, 'SETTLEMENT_NOT_FOUND', `POS settlement ${settlementId} was not found.`)
  await store.updateSettlement(settlementId, { approval: null })
  await store.logEvent({ settlementId, settlementCode: s.settlementCode, eventType: EVENT.APPROVAL_REVOKED, detail: reason ? `Approval revoked: ${reason}` : 'Approval revoked.', actor })
}

async function postPosSettlement({ settlementId, store, sources, writer, config, actor, fingerprint, now = () => new Date(), onProgress }: any) {
  if (config.postingEnabled !== true) throw fail(403, 'POSTING_DISABLED', 'POS settlement posting is disabled on this server (POS_SETTLEMENT_POSTING_ENABLED is not true).')
  if (!actor) throw fail(401, 'ACTOR_REQUIRED', 'An authenticated admin is required to post.')
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Preview and approve the payout, then post the approved preview.')
  const settlement = await store.getSettlement(settlementId)
  if (!settlement) throw fail(404, 'SETTLEMENT_NOT_FOUND', `POS settlement ${settlementId} was not found.`)
  if (!settlement.approval || settlement.approval.fingerprint !== fingerprint) throw fail(409, 'NOT_APPROVED', 'This exact preview has not been approved; approve it before posting.')

  const lock = await store.acquireSettlementLock(settlement.settlementCode)
  const log: any[] = []
  let stoppedAt: string | null = null
  let stopReason: string | null = null
  try {
    await report(onProgress, { phase: 'CHECKING', done: 0, total: null, current: null })
    const preview = await buildPosPreview({ settlementId, store, sources, config, now: now(), persist: false })
    if (preview.fingerprint !== fingerprint) throw fail(409, 'PREVIEW_CHANGED', 'The payout, Zoho or a mapping changed since approval. Review and approve the new preview.', { preview: publicPreview(preview) })
    if (preview.blockers.length) {
      await store.logEvent({ settlementId, settlementCode: settlement.settlementCode, eventType: EVENT.POSTING_BLOCKED, detail: preview.blockers.map((b: any) => b.message).slice(0, 10).join(' | '), actor })
      throw fail(409, 'POSTING_BLOCKED', `Posting is blocked: ${preview.blockers.map((b: any) => b.message).slice(0, 5).join(' ')}`, { preview: publicPreview(preview) })
    }
    await store.updateSettlement(settlementId, { status: SETTLEMENT_STATUS.POSTING, postingFingerprint: fingerprint })
    const settleMs = config.uncertainSettleMinutes * 60000
    const total = preview._plan.length
    for (const [i, c] of preview._plan.entries()) {
      await report(onProgress, { phase: 'POSTING', done: i, total, current: c.reference })
      const outcome = await postOne({ c, batchId: settlementId, store, sources, writer, actor, now, settleMs })
      log.push({ key: c.key, component: c.component, reference: c.reference, amount: c.amount, ...outcome })
      if (outcome.status !== S.VERIFIED) {
        stoppedAt = c.key
        stopReason = outcome.message
        break
      }
    }
    await report(onProgress, { phase: 'FINISHING', done: stoppedAt ? log.length - 1 : total, total, current: null })
    const bank = preview._bank
    if (!stoppedAt && bank.status === BANK_STATUS.BANK_MATCHED && bank.matched && settlement.bankTransactionId !== bank.matched.transactionId) {
      await store.setBankMatch(settlementId, { status: BANK_STATUS.BANK_MATCHED, transactionId: bank.matched.transactionId, evidence: { ...bank.matched, window: bank.window }, actor })
      log.push({ key: `${settlement.settlementCode}|${COMPONENT.BANK_CLEARING}|PAYOUT`, component: COMPONENT.BANK_CLEARING, status: 'BANK_MATCHED', message: `Linked existing Zoho transfer ${bank.matched.referenceNumber || bank.matched.transactionId}; nothing posted.` })
    } else if (!stoppedAt && bank.status !== BANK_STATUS.BANK_MATCHED && !bank.recordedByWorkflow && bank.status !== BANK_STATUS.BANK_DEPOSIT_SEEN) {
      stopReason = `Bank step waiting: ${bank.reason}`
    }
  } finally {
    await lock.release()
  }
  const after = await buildPosPreview({ settlementId, store, sources, config, now: now(), persist: true, refreshIndex: false })
  if (after.status === SETTLEMENT_STATUS.POSTED) await store.updateSettlement(settlementId, { postedAt: now().toISOString() })
  return { settlementId: String(settlementId), status: after.status, stoppedAt, stopReason, log, preview: publicPreview(after) }
}

module.exports = { approvePosSettlement, revokeApproval, postPosSettlement }

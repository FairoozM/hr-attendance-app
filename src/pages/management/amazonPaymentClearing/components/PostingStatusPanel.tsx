import { useState } from 'react'
import {
  linkPosting,
  releasePosting,
  reverifyPosting,
  type PaymentClearingMarketplace,
  type PostingGroupKey,
  type PostingGroupStatus,
  type PostingOverallStatus,
  type PostingRecoveryAction,
  type PostingStatus,
  type PostingStatusEntry,
  type PostingSubStep,
  type PostingVerification,
} from '../../../../api/amazonPaymentClearing'
import { money, safeError } from '../clearingShared'

const ENTRY_STATUS_LABEL: Record<string, string> = {
  posted: 'Posted',
  failed: 'Failed',
  verification_required: 'Verification required',
  not_started: 'Not started',
  partially_posted: 'Partially posted',
  not_required: 'Not required',
  existing: 'Existing in Zoho',
}

const ENTRY_STATUS_CLASS: Record<string, string> = {
  posted: 'apc-pill--success',
  failed: 'apc-pill--danger',
  verification_required: 'apc-pill--warn',
  partially_posted: 'apc-pill--warn',
  not_started: 'apc-pill--neutral',
  not_required: 'apc-pill--neutral',
  existing: 'apc-pill--info',
}

const OVERALL_TEXT: Record<PostingOverallStatus, { label: string; tone: 'ok' | 'warn' | 'error' | 'neutral' }> = {
  completed: { label: 'Settlement fully posted and verified in Zoho', tone: 'ok' },
  sales_posted: { label: 'Sales payments posted — settlement not complete yet', tone: 'warn' },
  partially_posted: { label: 'Partially posted', tone: 'warn' },
  verification_required: { label: 'Verification required', tone: 'error' },
  failed: { label: 'Posting failed — nothing is recorded as posted', tone: 'error' },
  not_started: { label: 'Not posted yet', tone: 'neutral' },
}

const RESUME_STEP: Record<PostingGroupKey, number> = {
  sales_payment: 9,
  fee_journal: 9,
  credit_note: 10,
  return_fee_journal: 11,
}

export function PostingStatusPill({ status }: { status: PostingGroupStatus | PostingSubStep['status'] | string }) {
  return (
    <span className={`apc-pill ${ENTRY_STATUS_CLASS[status] || 'apc-pill--neutral'}`}>
      {ENTRY_STATUS_LABEL[status] || status}
    </span>
  )
}

function VerificationDetail({ verification }: { verification: PostingVerification | null }) {
  if (!verification?.message) return null
  const candidates = verification.candidates || []
  return (
    <div className="apc-muted apc-cell-sub">
      {verification.message}
      {candidates.length > 1 ? (
        <ul>
          {candidates.map((candidate) => (
            <li key={candidate.zohoId}>
              <code>{candidate.zohoNumber || candidate.zohoId}</code>
              {candidate.diffs?.length ? ` — differs in ${candidate.diffs.map((diff) => diff.field).join(', ')}` : ' — exact'}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type PendingForm = { entryKey: string; action: 'link' | 'release'; zohoId: string; reason: string }

function entryKeyOf(entry: PostingStatusEntry) {
  return `${entry.group}:${entry.paymentType}:${entry.orderId || ''}`
}

export function PostingStatusPanel({
  marketplace,
  batchId,
  status,
  currency,
  groups,
  loading,
  onChanged,
  onResume,
}: {
  marketplace: PaymentClearingMarketplace
  batchId: number | string
  status: PostingStatus | null
  currency: string
  groups?: PostingGroupKey[]
  loading?: boolean
  onChanged: (message: string) => Promise<void> | void
  onResume: (stepId: number) => void
}) {
  const [busyKey, setBusyKey] = useState('')
  const [form, setForm] = useState<PendingForm | null>(null)
  const [actionError, setActionError] = useState('')

  if (!status) {
    return loading ? <p className="apc-muted">Loading Zoho posting status…</p> : null
  }

  const overall = OVERALL_TEXT[status.overall] || OVERALL_TEXT.not_started
  const visibleGroups = status.groups.filter(
    (group) => (!groups || groups.includes(group.key)) && (group.entries.length > 0 || group.status !== 'not_required')
  )

  async function runAction(entry: PostingStatusEntry, action: PostingRecoveryAction) {
    const key = entryKeyOf(entry)
    setActionError('')
    if (action.action === 'resume') {
      onResume(RESUME_STEP[entry.group])
      return
    }
    if (action.action === 'link' || action.action === 'release') {
      setForm({ entryKey: key, action: action.action, zohoId: entry.zohoId || '', reason: '' })
      return
    }
    if (!entry.postingId) return
    setBusyKey(key)
    try {
      const result = await reverifyPosting(marketplace, batchId, entry.postingId)
      await onChanged(
        result.posting?.status === 'posted'
          ? `${entry.label}: confirmed in Zoho and marked posted.`
          : `${entry.label}: ${result.verification?.message || 'still needs verification.'}`
      )
    } catch (e) {
      setActionError(safeError(e))
    } finally {
      setBusyKey('')
    }
  }

  async function submitForm(entry: PostingStatusEntry) {
    if (!form) return
    const key = entryKeyOf(entry)
    setBusyKey(key)
    setActionError('')
    try {
      if (form.action === 'link') {
        await linkPosting(marketplace, batchId, {
          postingId: entry.postingId,
          paymentType: entry.postingId ? undefined : entry.paymentType,
          zohoId: form.zohoId.trim(),
          reason: form.reason.trim(),
        })
        await onChanged(`${entry.label}: linked to Zoho record ${form.zohoId.trim()} after an exact match.`)
      } else if (entry.postingId) {
        await releasePosting(marketplace, batchId, entry.postingId, form.reason.trim())
        await onChanged(`${entry.label}: Zoho re-checked, nothing found; the entry can be posted again.`)
      }
      setForm(null)
    } catch (e) {
      setActionError(safeError(e))
    } finally {
      setBusyKey('')
    }
  }

  return (
    <section className="apc-step-stack">
      <div
        className={`apc-alert ${overall.tone === 'ok' ? 'apc-approved-panel' : overall.tone === 'error' ? 'apc-alert--error' : ''}`}
        role="status"
      >
        <strong>Zoho posting status: {overall.label}.</strong>
        <div className="apc-muted">
          Sales payments &amp; fee journals: {status.salesComplete ? 'complete' : 'not complete'} · Credit notes &amp; refunds:{' '}
          {status.creditNotesComplete ? 'complete' : 'not complete'} · Return fee journals:{' '}
          {status.returnFeesComplete ? 'complete' : 'not complete'}
        </div>
        {status.blockers.length ? (
          <ul>
            {status.blockers.map((blocker, index) => (
              <li key={`${blocker.step}-${index}`}>{blocker.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {actionError ? <div className="apc-alert apc-alert--error">{actionError}</div> : null}

      {visibleGroups.map((group) => (
        <details key={group.key} className="apc-details" open={group.status !== 'posted' && group.status !== 'not_required'}>
          <summary>
            {group.label} <PostingStatusPill status={group.status} /> ({group.entries.filter((e) => e.status === 'posted').length}/
            {group.entries.length} posted)
          </summary>
          <div className="apc-table-wrap apc-table-wrap--wide">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th className="apc-money">Amount</th>
                  <th>Status</th>
                  <th>Zoho record</th>
                  <th>Details</th>
                  <th>Recovery</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => {
                  const key = entryKeyOf(entry)
                  const formOpen = form?.entryKey === key
                  return (
                    <tr key={key}>
                      <td>
                        {entry.label}
                        {entry.referenceNumber ? <div className="apc-muted apc-cell-sub"><code className="apc-ref">{entry.referenceNumber}</code></div> : null}
                      </td>
                      <td className="apc-money">{money(entry.amount, currency)}</td>
                      <td>
                        <PostingStatusPill status={entry.status} />
                        {entry.creditNote ? (
                          <div className="apc-cell-sub">
                            Credit note: <PostingStatusPill status={entry.creditNote.status} />
                          </div>
                        ) : null}
                        {entry.refund ? (
                          <div className="apc-cell-sub">
                            Refund: <PostingStatusPill status={entry.refund.status} />
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {entry.zohoNumber || entry.zohoId || '-'}
                        {entry.creditNote?.zohoId ? <div className="apc-muted apc-cell-sub">CN {entry.creditNote.zohoId}</div> : null}
                        {entry.refund?.zohoId ? <div className="apc-muted apc-cell-sub">Refund {entry.refund.zohoId}</div> : null}
                      </td>
                      <td>
                        {entry.error ? <div>{entry.error}</div> : null}
                        <VerificationDetail verification={entry.verification} />
                        {!entry.error && !entry.verification?.message ? '-' : null}
                      </td>
                      <td>
                        {formOpen && form ? (
                          <div className="apc-step-stack">
                            {form.action === 'link' ? (
                              <input
                                className="ainv-input"
                                placeholder="Zoho record id"
                                value={form.zohoId}
                                onChange={(e) => setForm({ ...form, zohoId: e.target.value })}
                              />
                            ) : (
                              <p className="apc-muted">
                                Confirm in Zoho that nothing was created. Zoho is re-checked before the entry is released.
                              </p>
                            )}
                            <input
                              className="ainv-input"
                              placeholder="Reason (required, kept in the audit log)"
                              value={form.reason}
                              onChange={(e) => setForm({ ...form, reason: e.target.value })}
                            />
                            <div className="apc-button-row">
                              <button className="ainv-btn" type="button" onClick={() => setForm(null)} disabled={busyKey === key}>
                                Cancel
                              </button>
                              <button
                                className="ainv-btn ainv-btn--danger"
                                type="button"
                                onClick={() => void submitForm(entry)}
                                disabled={
                                  busyKey === key || form.reason.trim().length < 4 || (form.action === 'link' && !form.zohoId.trim())
                                }
                              >
                                {busyKey === key ? 'Checking Zoho…' : form.action === 'link' ? 'Verify & link' : 'Re-check & release'}
                              </button>
                            </div>
                          </div>
                        ) : entry.actions.length ? (
                          <div className="apc-button-row">
                            {entry.actions.map((action) => (
                              <button
                                key={action.action}
                                className="ainv-btn"
                                type="button"
                                title={action.description}
                                onClick={() => void runAction(entry, action)}
                                disabled={Boolean(busyKey)}
                              >
                                {busyKey === key && action.action === 'reverify' ? 'Checking…' : action.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {status.unmappedLegacyPostings.length ? (
        <div className="apc-alert apc-alert--error">
          Earlier journal rows that could not be matched to a current journal:{' '}
          {status.unmappedLegacyPostings
            .map((row) => `${row.paymentType} ${money(row.amount, currency)}${row.zohoId ? ` (Zoho ${row.zohoId})` : ''}`)
            .join('; ')}
          . Review them in Zoho before posting more journals.
        </div>
      ) : null}
    </section>
  )
}

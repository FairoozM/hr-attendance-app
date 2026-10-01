import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  approvePosSettlement,
  dismissPosConflict,
  getPosPostJob,
  getPosPreview,
  linkPosBank,
  listPosSettlements,
  posErrorBody,
  postPosSettlement,
  revokePosApproval,
  unlinkPosBank,
  uploadPosFile,
  type PosFile,
  type PosPostJob,
  type PosPreview,
  type PosSettlement,
  type PosSourceFormat,
  type PosTransaction,
} from '../../../api/posSettlements'
import { Pill } from '../tabby/TabbyPreviewPanel'
import { PosManualMappingDialog } from './PosManualMappingDialog'
import { PosPreviewPanel } from './PosPreviewPanel'
import { PosAccountMapping, PosTerminalMapping } from './PosSetupPanels'
import { bankTone, channelLabel, formatAed, formatDateTime, humanize, settlementStatusTone, zohoLimitReached } from './posFormat'
import '../tabby/TabbyClearingPage.css'
import './PosSettlementsPage.css'

const BASE_PATH = '/management/pos-settlements'
const POLL_FAILURES_BEFORE_WARNING = 3

const FORMAT_LABEL: Record<PosSourceFormat, string> = {
  ENRICH_CSV: 'Enrich CSV',
  SIMPLE_CSV: 'csv1',
  DETAIL_TXT: 'Detailed batch TXT',
  MSA: 'MSA statement (control only)',
}

type Notice = { tone: 'info' | 'warning' | 'error'; text: string }

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function jobProgressText(job: PosPostJob): string {
  const p = job.progress
  if (p.phase === 'POSTING' && p.total) return `Posting ${Math.min(p.done + 1, p.total)} of ${p.total}${p.current ? ` · ${p.current}` : ''}`
  if (p.phase === 'FINISHING') return 'Re-checking Zoho after posting…'
  return 'Checking the payout against Zoho before posting…'
}

function jobOutcomeNotice(job: PosPostJob): Notice {
  if (job.status === 'SUCCEEDED') return { tone: 'info', text: `${job.settlementCode} is ${humanize(job.result?.status)}.` }
  if (job.status === 'STOPPED') return { tone: 'warning', text: `Posting stopped: ${job.result?.stopReason || 'see the posting result below.'}` }
  return { tone: 'error', text: job.error?.message || 'Posting failed.' }
}

export function PosSettlementsPage({ pollMs = 2000 }: { pollMs?: number } = {}) {
  const { settlementId } = useParams<{ settlementId?: string }>()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)

  const [settlements, setSettlements] = useState<PosSettlement[]>([])
  const [files, setFiles] = useState<PosFile[]>([])
  const [postingEnabled, setPostingEnabled] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [preview, setPreview] = useState<PosPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<PosPostJob | null>(null)
  const [pollTick, setPollTick] = useState(0)
  const [pollFailures, setPollFailures] = useState(0)
  const [setup, setSetup] = useState<'none' | 'accounts' | 'terminals'>('none')
  const [mapping, setMapping] = useState<PosTransaction | null>(null)
  const [approvalNote, setApprovalNote] = useState('')
  const jobRunning = job?.status === 'RUNNING'

  const loadList = useCallback(async () => {
    try {
      const res = await listPosSettlements()
      setSettlements(res.settlements)
      setFiles(res.files.filter((f) => f.role !== 'CONTROL'))
      setPostingEnabled(res.postingEnabled)
      setListError(null)
    } catch (err) {
      setListError(errorMessage(err, 'Could not load POS settlements.'))
    }
  }, [])

  const loadPreview = useCallback(
    async (id: string, opts: { deep?: boolean; deepScan?: boolean } = {}) => {
      setLoadingPreview(true)
      try {
        const res = await getPosPreview(id, opts)
        setPreview(res.preview)
        void loadList()
      } catch (err) {
        setNotice({ tone: 'error', text: errorMessage(err, 'Could not build the preview.') })
      } finally {
        setLoadingPreview(false)
      }
    },
    [loadList]
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    setJob(null)
    setPollFailures(0)
    if (!settlementId) {
      setPreview(null)
      return
    }
    let alive = true
    getPosPostJob(settlementId)
      .then((res) => {
        if (alive) setJob(res.job)
      })
      .catch(() => {})
    if (preview?.settlementId !== settlementId) {
      setPreview(null)
      void loadPreview(settlementId)
    }
    return () => {
      alive = false
    }
  }, [settlementId])

  useEffect(() => {
    if (!settlementId || !jobRunning) return
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const res = await getPosPostJob(settlementId)
        if (!alive) return
        setPollFailures(0)
        setJob(res.job)
        if (res.job && res.job.status !== 'RUNNING') {
          setNotice(jobOutcomeNotice(res.job))
          await loadPreview(settlementId)
        } else {
          setPollTick((n) => n + 1)
        }
      } catch {
        if (!alive) return
        setPollFailures((n) => n + 1)
        setPollTick((n) => n + 1)
      }
    }, pollMs)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [settlementId, jobRunning, pollTick, pollMs, loadPreview])

  async function act(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      const body = posErrorBody(err)
      if (body?.preview) setPreview(body.preview)
      if (body?.job) setJob(body.job)
      const message = errorMessage(err, fallback)
      const extra = body?.code === 'FILE_REFUSED' ? (body.problems || []).slice(0, 5).map((p) => p.message).filter((m) => !message.includes(m)) : []
      setNotice({ tone: 'error', text: [message, ...extra].join(' ') })
    } finally {
      setBusy(false)
    }
  }

  const upload = () =>
    act(async () => {
      if (!file) return
      const res = await uploadPosFile(file)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await loadList()
      if (res.role === 'CONTROL') {
        const facts = res.warnings.map((w) => w.message).join(' ')
        setNotice({ tone: 'info', text: res.result === 'ALREADY_IMPORTED' ? `${file.name} was already stored; nothing changed.` : `${file.name} stored as a control document; it does not create or change payouts. ${facts}`.trim() })
        return
      }
      const counts = res.counts ? ` ${res.counts.NEW} new, ${res.counts.DUPLICATE} duplicate, ${res.counts.CONFLICT} conflicting.` : ''
      const warn = res.warnings.length ? ` ${res.warnings.length} warning(s): ${res.warnings.slice(0, 3).map((w) => w.message).join(' ')}` : ''
      setNotice({
        tone: res.counts?.CONFLICT || res.warnings.length ? 'warning' : 'info',
        text: res.result === 'ALREADY_IMPORTED' ? `${file.name} was already imported (same file); nothing changed.` : `${file.name} imported.${counts}${warn}`,
      })
      if (res.settlementIds.length === 1) navigate(`${BASE_PATH}/${res.settlementIds[0]}`)
    }, 'Upload failed.')

  const approve = () =>
    act(async () => {
      if (!preview) return
      const res = await approvePosSettlement(preview.settlementId, preview.fingerprint, approvalNote)
      setPreview(res.preview)
      setApprovalNote('')
      setNotice({ tone: 'info', text: `Approved ${preview.settlementCode}. ${preview.postingEnabled ? 'It can now be posted.' : 'Posting is switched off on this server.'}` })
      await loadList()
    }, 'Approval failed.')

  const revoke = () =>
    act(async () => {
      if (!preview) return
      const reason = window.prompt('Why is the approval revoked?') || ''
      if (!reason.trim()) return
      await revokePosApproval(preview.settlementId, reason.trim())
      await loadPreview(preview.settlementId)
    }, 'Could not revoke the approval.')

  const post = () =>
    act(async () => {
      if (!preview || !preview.canPost) return
      const t = preview.totals
      const ok = window.confirm(
        [
          `Post ${preview.settlementCode} to Zoho?`,
          '',
          `${preview.counts.toPost} record(s) will be created.`,
          `Gross ${formatAed(t.gross)} · Commission ${formatAed(t.commission)} · VAT ${formatAed(t.vat)} · Net ${formatAed(t.net)}`,
          `Bank: ${humanize(preview.bank.status)}`,
          '',
          'Existing Zoho records are verified and skipped. This cannot be undone from here.',
        ].join('\n')
      )
      if (!ok) return
      const res = await postPosSettlement(preview.settlementId, preview.fingerprint)
      setPollFailures(0)
      setJob(res.job)
    }, 'Posting could not start.')

  const linkBank = (transactionId: string) =>
    act(async () => {
      if (!preview) return
      setPreview((await linkPosBank(preview.settlementId, transactionId)).preview)
      await loadList()
    }, 'Could not link the bank transfer.')

  const unlinkBank = () =>
    act(async () => {
      if (!preview) return
      await unlinkPosBank(preview.settlementId)
      await loadPreview(preview.settlementId)
    }, 'Could not unlink the bank transfer.')

  const dismissConflict = (transactionId: string) =>
    act(async () => {
      if (!preview) return
      const reason = window.prompt('Why are the earlier values correct?') || ''
      if (reason.trim().length < 5) return
      await dismissPosConflict(transactionId, reason.trim())
      await loadPreview(preview.settlementId)
    }, 'Could not dismiss the conflict.')

  const actionReason = !preview
    ? ''
    : preview.status === 'POSTED'
      ? 'Everything in this payout is already in Zoho.'
      : zohoLimitReached([...preview.blockers, ...preview.warnings])
        ? 'Waiting for Zoho (daily request limit reached).'
        : preview.blockers.length
        ? `${preview.blockers.length} blocker(s) must be resolved first.`
        : !preview.approved
          ? 'Review the preview below, then approve it.'
          : !preview.postingEnabled
            ? 'Approved. Posting to Zoho is switched off on this server (POS_SETTLEMENT_POSTING_ENABLED).'
            : ''

  return (
    <div className="tabby-page">
      <header className="tabby-page__header">
        <div>
          <h1 className="tabby-page__title">Mashreq POS settlements</h1>
          <p className="tabby-page__note">
            Upload a Mashreq settlement file, match each card transaction to its Zoho invoice by RRN, review and approve the exact Zoho records, then post once.
          </p>
        </div>
        <div className="tabby-page__actions">
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => setSetup(setup === 'terminals' ? 'none' : 'terminals')}>
            Terminals
          </button>
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => setSetup(setup === 'accounts' ? 'none' : 'accounts')}>
            Account mapping
          </button>
        </div>
      </header>

      {!postingEnabled ? (
        <div className="tabby-page__banner tabby-page__banner--warning">
          Posting to Zoho is switched off on this server. Uploads, previews and approvals work; nothing can be written to Zoho.
        </div>
      ) : null}

      {setup === 'accounts' ? <PosAccountMapping onChanged={() => preview && void loadPreview(preview.settlementId)} /> : null}
      {setup === 'terminals' ? <PosTerminalMapping onChanged={() => preview && void loadPreview(preview.settlementId)} /> : null}

      <section className="tabby-page__card">
        <h2>Upload Mashreq Enrich CSV</h2>
        <div className="tabby-page__upload">
          <input ref={fileInput} type="file" aria-label="Mashreq file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={!file || busy} onClick={upload}>
            {busy && file ? 'Reading…' : 'Upload'}
          </button>
        </div>
        <p className="tabby-page__sub">
          One file per day: the Enrich CSV from the Mashreq portal (name ends with _Enrich_csv1.csv), uploaded as downloaded, not re-saved in Excel. Uploading the same file again changes nothing.
        </p>
      </section>

      {notice ? <div className={`tabby-page__banner tabby-page__banner--${notice.tone}`}>{notice.text}</div> : null}

      <section className="tabby-page__card">
        <header className="tabby-page__card-head">
          <h2>Payouts</h2>
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => void loadList()}>
            Refresh
          </button>
        </header>
        {listError ? <div className="tabby-page__banner tabby-page__banner--error">{listError}</div> : null}
        {settlements.length ? (
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Payout</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Channels</th>
                  <th>Bank</th>
                  <th className="num">Net</th>
                  <th>Approved</th>
                  <th>Last reviewed</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className={`tabby-page__clickable${s.id === settlementId ? ' tabby-page__selected' : ''}`} onClick={() => navigate(`${BASE_PATH}/${s.id}`)}>
                    <td>
                      <strong className="tabby-page__mono">{s.settlementCode}</strong>
                      <div className="tabby-page__sub">{humanize(s.basis)}</div>
                    </td>
                    <td>{s.payoutDate || '—'}</td>
                    <td>
                      <Pill tone={settlementStatusTone(s.status)}>{humanize(s.status)}</Pill>
                    </td>
                    <td>{s.review?.byChannel ? Object.keys(s.review.byChannel).map(channelLabel).join(', ') : '—'}</td>
                    <td>{s.review?.bankStatus || s.bankStatus ? <Pill tone={bankTone(s.review?.bankStatus || s.bankStatus)}>{humanize(s.review?.bankStatus || s.bankStatus)}</Pill> : '—'}</td>
                    <td className="num">{formatAed(s.review?.totals?.net)}</td>
                    <td>{s.approval ? `${s.approval.by} · ${formatDateTime(s.approval.at)}` : '—'}</td>
                    <td>{formatDateTime(s.review?.at || s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tabby-page__note">No Mashreq payouts imported yet.</p>
        )}
        {files.length ? (
          <details>
            <summary className="tabby-page__sub">Imported files ({files.length})</summary>
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Format</th>
                  <th className="num">Rows</th>
                  <th className="num">New</th>
                  <th className="num">Duplicate</th>
                  <th className="num">Conflict</th>
                  <th>Imported</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.fileName || '—'}
                      <div className="tabby-page__sub tabby-page__mono">{f.fileHash.slice(0, 12)}</div>
                    </td>
                    <td>{FORMAT_LABEL[f.sourceFormat] || f.sourceFormat}</td>
                    <td className="num">{f.transactionCount}</td>
                    <td className="num">{f.newCount}</td>
                    <td className="num">{f.duplicateCount}</td>
                    <td className="num">{f.conflictCount}</td>
                    <td>
                      {formatDateTime(f.createdAt)}
                      <div className="tabby-page__sub">{f.importedBy || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </section>

      {settlementId && loadingPreview && !preview ? <p className="tabby-page__note">Reading Zoho invoices for RRNs and checking the payout…</p> : null}

      {preview ? (
        <>
          <section className="tabby-page__card tabby-page__postbar">
            <div>
              {jobRunning && job ? (
                <>
                  <strong>Posting to Zoho…</strong>
                  <div className="tabby-page__sub">{jobProgressText(job)}</div>
                  {job.progress.total ? <progress className="tabby-page__progress" max={job.progress.total} value={job.progress.done} /> : null}
                  <div className="tabby-page__sub">Runs on the server; you can leave or reload this page and come back.</div>
                  {pollFailures >= POLL_FAILURES_BEFORE_WARNING ? <div className="tabby-page__issue">Can't reach the server to check progress; still retrying.</div> : null}
                </>
              ) : (
                <>
                  <strong>{preview.canPost ? 'Approved and ready to post' : preview.approved ? 'Approved' : preview.canApprove ? 'Ready for approval' : 'Not ready'}</strong>
                  <div className="tabby-page__sub">{actionReason || `${preview.counts.toPost} Zoho record(s) will be created.`}</div>
                  {preview.approval && !preview.approved ? <div className="tabby-page__issue">An earlier approval no longer matches this preview (something changed); approve again.</div> : null}
                  {preview.approved && preview.approval ? (
                    <div className="tabby-page__sub">
                      Approved by {preview.approval.by} {formatDateTime(preview.approval.at)}
                      {preview.approval.note ? ` · ${preview.approval.note}` : ''}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className="tabby-page__actions">
              <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy || loadingPreview || jobRunning} onClick={() => void loadPreview(preview.settlementId)}>
                {loadingPreview ? 'Refreshing…' : 'Refresh preview'}
              </button>
              <button
                type="button"
                className="ainv-btn ainv-btn--ghost"
                disabled={busy || loadingPreview || jobRunning}
                onClick={() => void loadPreview(preview.settlementId, { deep: true, deepScan: true })}
                title="Index every invoice of the shop and website customers in the window and search Zoho directly for every planned record"
              >
                Deep Zoho check
              </button>
              {preview.canApprove && !preview.approved ? (
                <>
                  <input aria-label="Approval note" placeholder="Approval note (optional)" value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} disabled={busy} />
                  <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy || loadingPreview || jobRunning} onClick={approve}>
                    Approve
                  </button>
                </>
              ) : null}
              {preview.approval ? (
                <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy || jobRunning} onClick={revoke}>
                  Revoke approval
                </button>
              ) : null}
              <button type="button" className="ainv-btn ainv-btn--primary-emerald" disabled={!preview.canPost || busy || loadingPreview || jobRunning} onClick={post} title={actionReason || undefined}>
                {jobRunning ? 'Posting…' : 'Post to Zoho'}
              </button>
            </div>
          </section>

          {job && !jobRunning && (job.status === 'FAILED' || job.status === 'INTERRUPTED') ? (
            <section className="tabby-page__card">
              <h2>Last posting run: {humanize(job.status)}</h2>
              <p className="tabby-page__issue">{job.error?.message}</p>
              <p className="tabby-page__sub">
                Started {formatDateTime(job.startedAt)} by {job.actor} · ended {formatDateTime(job.finishedAt)}
              </p>
            </section>
          ) : null}

          {job && !jobRunning && job.result ? (
            <section className="tabby-page__card">
              <h2>Posting result: {humanize(job.result.status)}</h2>
              <p className="tabby-page__sub">
                Started {formatDateTime(job.startedAt)} by {job.actor} · finished {formatDateTime(job.finishedAt)}
              </p>
              {job.result.stopReason ? <p className="tabby-page__issue">{job.result.stopReason}</p> : null}
              <div className="tabby-page__scroll">
                <table className="tabby-page__table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Reference</th>
                      <th className="num">Amount</th>
                      <th>Result</th>
                      <th>Zoho ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.result.log.map((l) => (
                      <tr key={l.key}>
                        <td>{humanize(l.component)}</td>
                        <td className="tabby-page__mono">{l.reference || '—'}</td>
                        <td className="num">{formatAed(l.amount)}</td>
                        <td>
                          {humanize(l.status)}
                          {l.message ? <div className="tabby-page__sub">{l.message}</div> : null}
                        </td>
                        <td className="tabby-page__mono">{l.zohoRecordId || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <PosPreviewPanel preview={preview} busy={busy || jobRunning} onMap={setMapping} onDismissConflict={dismissConflict} onLinkBank={linkBank} onUnlinkBank={unlinkBank} />
        </>
      ) : null}

      {mapping ? (
        <PosManualMappingDialog
          txn={mapping}
          onClose={() => setMapping(null)}
          onSaved={() => {
            setMapping(null)
            if (preview) void loadPreview(preview.settlementId)
          }}
        />
      ) : null}
    </div>
  )
}

export default PosSettlementsPage

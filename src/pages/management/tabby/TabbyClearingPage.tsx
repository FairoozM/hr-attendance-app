import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  chooseTabbyBankMatch,
  getTabbyPostJob,
  getTabbyPreview,
  listTabbyBatches,
  postTabbyBatch,
  tabbyErrorBody,
  uploadTabbyStatement,
  type TabbyBatch,
  type TabbyPostJob,
  type TabbyPreview,
} from '../../../api/tabbyClearing'
import { TabbyAccountMapping } from './TabbyAccountMapping'
import { Pill, TabbyPreviewPanel } from './TabbyPreviewPanel'
import { bankStatusTone, batchStatusTone, formatAed, formatDateTime, humanize } from './tabbyFormat'
import './TabbyClearingPage.css'

const BASE_PATH = '/management/tabby-clearing'

const POLL_FAILURES_BEFORE_WARNING = 3

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function jobProgressText(job: TabbyPostJob): string {
  const p = job.progress
  if (p.phase === 'POSTING' && p.total) return `Posting ${Math.min(p.done + 1, p.total)} of ${p.total}${p.current ? ` · ${p.current}` : ''}`
  if (p.phase === 'FINISHING') return 'Re-checking Zoho after posting…'
  return 'Checking the statement against Zoho before posting…'
}

function jobOutcomeNotice(job: TabbyPostJob): { tone: 'info' | 'warning' | 'error'; text: string } {
  if (job.status === 'SUCCEEDED') return { tone: 'info', text: `${job.statementNumber} is ${humanize(job.result?.status)}.` }
  if (job.status === 'STOPPED') return { tone: 'warning', text: `Posting stopped: ${job.result?.stopReason || 'see the posting result below.'}` }
  return { tone: 'error', text: job.error?.message || 'Posting failed.' }
}

export function TabbyClearingPage({ pollMs = 2000 }: { pollMs?: number } = {}) {
  const { batchId } = useParams<{ batchId?: string }>()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)

  const [batches, setBatches] = useState<TabbyBatch[]>([])
  const [postingEnabled, setPostingEnabled] = useState(false)
  const [batchesError, setBatchesError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null)
  const [preview, setPreview] = useState<TabbyPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<TabbyPostJob | null>(null)
  const [pollTick, setPollTick] = useState(0)
  const [pollFailures, setPollFailures] = useState(0)
  const [showAccounts, setShowAccounts] = useState(false)
  const jobRunning = job?.status === 'RUNNING'

  const loadBatches = useCallback(async () => {
    try {
      const res = await listTabbyBatches()
      setBatches(res.batches)
      setPostingEnabled(res.postingEnabled)
      setBatchesError(null)
    } catch (err) {
      setBatchesError(errorMessage(err, 'Could not load saved statements.'))
    }
  }, [])

  const loadPreview = useCallback(async (id: string, deep = false) => {
    setLoadingPreview(true)
    try {
      const res = await getTabbyPreview(id, { deep })
      setPreview(res.preview)
      void loadBatches()
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not build the preview.') })
    } finally {
      setLoadingPreview(false)
    }
  }, [loadBatches])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

  useEffect(() => {
    setJob(null)
    setPollFailures(0)
    if (!batchId) {
      setPreview(null)
      return
    }
    let alive = true
    getTabbyPostJob(batchId)
      .then((res) => {
        if (alive) setJob(res.job)
      })
      .catch(() => {})
    if (preview?.batchId !== batchId) {
      setPreview(null)
      void loadPreview(batchId)
    }
    return () => {
      alive = false
    }
  }, [batchId])

  useEffect(() => {
    if (!batchId || !jobRunning) return
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const res = await getTabbyPostJob(batchId)
        if (!alive) return
        setPollFailures(0)
        setJob(res.job)
        if (res.job && res.job.status !== 'RUNNING') {
          setNotice(jobOutcomeNotice(res.job))
          await loadPreview(batchId)
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
  }, [batchId, jobRunning, pollTick, pollMs, loadPreview])

  async function upload() {
    if (!file) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await uploadTabbyStatement(file)
      setPreview(res.preview)
      setNotice(
        res.result === 'ALREADY_IMPORTED'
          ? { tone: 'info', text: `${res.preview.statementNumber} was already imported from this exact file; reopened it.` }
          : { tone: 'info', text: `${res.preview.statementNumber} imported. Review the preview before posting.` }
      )
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await loadBatches()
      navigate(`${BASE_PATH}/batch/${res.batchId}`)
    } catch (err) {
      const body = tabbyErrorBody(err)
      const problems = body?.problems?.length ? ` ${body.problems.map((p) => p.message).join(' ')}` : ''
      setNotice({ tone: 'error', text: `${errorMessage(err, 'Upload failed.')}${body?.code === 'STATEMENT_UNREADABLE' ? problems : ''}` })
    } finally {
      setBusy(false)
    }
  }

  async function chooseBank(transactionId: string) {
    if (!preview) return
    setBusy(true)
    try {
      const res = await chooseTabbyBankMatch(preview.batchId, transactionId)
      setPreview(res.preview)
      await loadBatches()
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not link the bank transfer.') })
    } finally {
      setBusy(false)
    }
  }

  async function post() {
    if (!preview || !preview.canPost) return
    const s = preview.sections
    const ok = window.confirm(
      [
        `Post ${preview.statementNumber} to Zoho?`,
        '',
        `${preview.counts.toPost} record(s) will be created, dated ${preview.date}.`,
        `Sales ${formatAed(s.sales.gross)} · Commission ${formatAed(s.commission.net)} · Fees ${formatAed(s.fees.feesExpense)} · Input VAT ${formatAed(s.vat.inputVat)}`,
        `Bank payout ${formatAed(preview.bank.amount)} (${humanize(preview.bank.status)})`,
        '',
        'Existing Zoho records are verified and skipped. This cannot be undone from here.',
      ].join('\n')
    )
    if (!ok) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await postTabbyBatch(preview.batchId, preview.fingerprint)
      setPollFailures(0)
      setJob(res.job)
    } catch (err) {
      const body = tabbyErrorBody(err)
      if (body?.job) {
        setJob(body.job)
        setNotice({ tone: 'info', text: 'This statement is already being posted; showing its progress.' })
      } else {
        if (body?.preview) setPreview(body.preview)
        setNotice({ tone: 'error', text: errorMessage(err, 'Posting could not start.') })
      }
    } finally {
      setBusy(false)
      void loadBatches()
    }
  }

  const postDisabledReason = !preview
    ? ''
    : !preview.postingEnabled
      ? 'Posting to Zoho is switched off on this server (TABBY_CLEARING_POSTING_ENABLED).'
      : preview.status === 'POSTED'
        ? 'Everything in this statement is already in Zoho.'
        : preview.blockers.length
          ? `${preview.blockers.length} blocker(s) must be resolved first.`
          : ''

  return (
    <div className="tabby-page">
      <header className="tabby-page__header">
        <div>
          <h1 className="tabby-page__title">Tabby settlement clearing</h1>
          <p className="tabby-page__note">
            Upload a Tabby settlement report, review how every sale, refund, fee and payout lands in Zoho, then post once.
          </p>
        </div>
        <div className="tabby-page__actions">
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => setShowAccounts((v) => !v)}>
            {showAccounts ? 'Hide account mapping' : 'Account mapping'}
          </button>
        </div>
      </header>

      {!postingEnabled ? (
        <div className="tabby-page__banner tabby-page__banner--warning">
          Posting to Zoho is switched off on this server. Uploads and previews work; nothing can be written to Zoho.
        </div>
      ) : null}

      {showAccounts ? <TabbyAccountMapping onChanged={() => preview && void loadPreview(preview.batchId)} /> : null}

      <section className="tabby-page__card">
        <h2>Upload statement</h2>
        <div className="tabby-page__upload">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={busy}
          />
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={!file || busy} onClick={upload}>
            {busy && file ? 'Reading…' : 'Upload and preview'}
          </button>
        </div>
        <p className="tabby-page__sub">
          The same statement file can be uploaded again safely. A different file for an already-imported statement number is refused.
        </p>
      </section>

      {notice ? <div className={`tabby-page__banner tabby-page__banner--${notice.tone}`}>{notice.text}</div> : null}

      <section className="tabby-page__card">
        <header className="tabby-page__card-head">
          <h2>Saved statements</h2>
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => void loadBatches()}>
            Refresh
          </button>
        </header>
        {batchesError ? <div className="tabby-page__banner tabby-page__banner--error">{batchesError}</div> : null}
        {batches.length ? (
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Transfer date</th>
                  <th>Status</th>
                  <th>Bank</th>
                  <th className="num">Bank payout</th>
                  <th>Last reviewed</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    className={`tabby-page__clickable${b.id === batchId ? ' tabby-page__selected' : ''}`}
                    onClick={() => navigate(`${BASE_PATH}/batch/${b.id}`)}
                  >
                    <td>
                      <strong>{b.statementNumber}</strong>
                      <div className="tabby-page__sub">{b.fileName || '—'}</div>
                    </td>
                    <td>{b.transferDate || b.statementDate || '—'}</td>
                    <td>
                      <Pill tone={batchStatusTone(b.status)}>{humanize(b.status)}</Pill>
                    </td>
                    <td>
                      {b.review?.bankStatus || b.bankStatus ? (
                        <Pill tone={bankStatusTone(b.review?.bankStatus || b.bankStatus)}>
                          {humanize(b.review?.bankStatus || b.bankStatus)}
                        </Pill>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{formatAed(b.review?.totals?.bankPayout)}</td>
                    <td>{formatDateTime(b.review?.at || b.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tabby-page__note">No statements imported yet.</p>
        )}
      </section>

      {batchId && loadingPreview && !preview ? <p className="tabby-page__note">Checking the website and Zoho…</p> : null}

      {preview ? (
        <>
          <section className="tabby-page__card tabby-page__postbar">
            <div>
              {jobRunning && job ? (
                <>
                  <strong>Posting to Zoho…</strong>
                  <div className="tabby-page__sub">{jobProgressText(job)}</div>
                  {job.progress.total ? (
                    <progress className="tabby-page__progress" max={job.progress.total} value={job.progress.done} />
                  ) : null}
                  <div className="tabby-page__sub">
                    Runs on the server; you can leave or reload this page and come back.
                  </div>
                  {pollFailures >= POLL_FAILURES_BEFORE_WARNING ? (
                    <div className="tabby-page__issue">Can't reach the server to check progress; still retrying.</div>
                  ) : null}
                </>
              ) : (
                <>
                  <strong>{preview.canPost ? 'Ready to post' : 'Not ready to post'}</strong>
                  <div className="tabby-page__sub">
                    {postDisabledReason || `${preview.counts.toPost} Zoho record(s) will be created dated ${preview.date}.`}
                  </div>
                </>
              )}
            </div>
            <div className="tabby-page__actions">
              <button
                type="button"
                className="ainv-btn ainv-btn--ghost"
                disabled={busy || loadingPreview || jobRunning}
                onClick={() => void loadPreview(preview.batchId)}
              >
                {loadingPreview ? 'Refreshing…' : 'Refresh preview'}
              </button>
              <button
                type="button"
                className="ainv-btn ainv-btn--ghost"
                disabled={busy || loadingPreview || jobRunning}
                onClick={() => void loadPreview(preview.batchId, true)}
                title="Also reads every invoice payment and journal in Zoho, not just by reference"
              >
                Deep Zoho check
              </button>
              <button
                type="button"
                className="ainv-btn ainv-btn--primary-emerald"
                disabled={!preview.canPost || busy || loadingPreview || jobRunning}
                onClick={post}
              >
                {jobRunning ? 'Posting…' : busy ? 'Starting…' : 'Post to Zoho'}
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
                      <th>Component</th>
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

          <TabbyPreviewPanel preview={preview} busy={busy} onChooseBank={chooseBank} />
        </>
      ) : null}
    </div>
  )
}

export default TabbyClearingPage

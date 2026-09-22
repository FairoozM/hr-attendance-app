/**
 * Daily Accounting Details — Zoho Books opening / day movements / closing.
 * Route: /#/reports/daily-accounting-details?date=YYYY-MM-DD
 *
 * Nothing loads until a date is requested: the loaded date lives in the URL, so
 * a refresh or shared link rebuilds exactly that day and a bare visit stays idle.
 *
 * Build can take >25s (many Zoho bank pages), so the page starts a background
 * job and polls — same pattern as Daily Ecommerce Report refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { api } from '../../api/client'
import { mergeSearchParams } from '../../lib/urlSearchParams'
import { LedgerSection, type LedgerSectionData } from './LedgerSection'
import { exportDailyEcommerceLedgerXlsx } from './dailyEcommerceLedgerExport'
import './DailyEcommerceLedgerPage.css'

const IANA_UAE = 'Asia/Dubai'
const POLL_MS = 1500
const MAX_WAIT_MS = 5 * 60 * 1000

function todayUaeYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IANA_UAE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function addDaysYmd(dateYmd: string, delta: number) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const noon = new Date(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+04:00`
  )
  return todayUaeYmd(new Date(noon.getTime() + delta * 86400000))
}

function formatDisplayDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  return dt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** Only a well-formed, non-future UAE date is worth sending to Zoho. */
export function isLoadableYmd(value: string | null | undefined, today = todayUaeYmd()) {
  if (!value || !YMD_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false
  return value <= today
}

type LedgerReport = {
  reportDate: string
  dayName: string
  generatedAt: string
  sections: {
    sales: LedgerSectionData
    cashInHand: LedgerSectionData
    expenses: LedgerSectionData
    purchasePayments: LedgerSectionData
    basmatPayable: LedgerSectionData
    banks: LedgerSectionData[]
    creditCards: LedgerSectionData[]
  }
}

type LedgerJob = {
  jobId: string
  date: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress?: string
  error?: string | null
  report?: LedgerReport | null
}

export function DailyEcommerceLedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlDate = searchParams.get('date') || ''
  const [date, setDate] = useState(() => (isLoadableYmd(urlDate) ? urlDate : todayUaeYmd()))
  const [loadedDate, setLoadedDate] = useState(() => (isLoadableYmd(urlDate) ? urlDate : ''))
  const [report, setReport] = useState<LedgerReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const printRef = useRef<HTMLDivElement>(null)
  const loadTokenRef = useRef<symbol | null>(null)

  const load = useCallback(async (ymd: string) => {
    setLoading(true)
    setError('')
    setProgress('Starting…')
    setReport(null)
    const token = Symbol('ledger-load')
    loadTokenRef.current = token
    const cancelled = () => loadTokenRef.current !== token
    try {
      const started = (await api.post('/api/reports/daily-ecommerce-ledger/build', {
        date: ymd,
      })) as LedgerJob
      let job = started
      const deadline = Date.now() + MAX_WAIT_MS
      while (job.status === 'queued' || job.status === 'running') {
        if (cancelled()) return
        if (Date.now() > deadline) {
          throw new Error(
            'Accounting details are still building on the server. Wait a minute and load this date again.'
          )
        }
        setProgress(job.progress || 'Loading Zoho ledgers…')
        await sleep(POLL_MS)
        if (cancelled()) return
        job = (await api.get(
          `/api/reports/daily-ecommerce-ledger/build/${encodeURIComponent(job.jobId)}`,
          { timeoutMs: 15_000 }
        )) as LedgerJob
      }
      if (cancelled()) return
      if (job.status === 'failed') {
        throw new Error(job.error || 'Accounting details build failed')
      }
      if (!job.report) {
        throw new Error('Build finished without a report')
      }
      setReport(job.report)
      setProgress('')
    } catch (err: unknown) {
      if (!cancelled()) {
        const message = err instanceof Error ? err.message : 'Failed to load accounting details'
        setError(message)
        setReport(null)
      }
    } finally {
      if (!cancelled()) setLoading(false)
    }
  }, [])

  /** Requesting a date puts it in the URL so refresh and sharing rebuild the same day. */
  const requestDate = useCallback(
    (ymd: string) => {
      if (!isLoadableYmd(ymd)) return
      setDate(ymd)
      setLoadedDate(ymd)
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            params.set('date', ymd)
          }),
        { replace: true }
      )
      void load(ymd)
    },
    [load, setSearchParams]
  )

  // Deep link only: a bare visit stays idle until the user asks for a date.
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    if (isLoadableYmd(urlDate)) void load(urlDate)
  }, [urlDate, load])

  useEffect(
    () => () => {
      loadTokenRef.current = null
    },
    []
  )

  const exportPdf = async () => {
    if (!printRef.current || !report) return
    const canvas = await html2canvas(printRef.current, {
      backgroundColor: '#0f1419',
      scale: 2,
      useCORS: true,
    })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgHeight = (canvas.height * pageWidth) / canvas.width
    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(img, 'PNG', 0, position, pageWidth, imgHeight)
    heightLeft -= pageHeight
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(img, 'PNG', 0, position, pageWidth, imgHeight)
      heightLeft -= pageHeight
    }
    pdf.save(`daily-accounting-details-${report.reportDate}.pdf`)
  }

  const sections = report?.sections

  return (
    <div className="del-page">
      <header className="del-header">
        <div>
          <h1>Daily Accounting Details</h1>
          <p className="del-subtitle">
            {loadedDate
              ? `${formatDisplayDate(loadedDate)} · ${report?.dayName || '—'}`
              : 'Pick a date, then press Load Report'}
          </p>
        </div>
        <div className="del-controls">
          <button
            type="button"
            onClick={() => requestDate(addDaysYmd(loadedDate || date, -1))}
            disabled={loading}
          >
            Previous Day
          </button>
          <input
            type="date"
            value={date}
            max={todayUaeYmd()}
            onChange={(e) => setDate(e.target.value)}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => requestDate(addDaysYmd(loadedDate || date, 1))}
            disabled={loading || (loadedDate || date) >= todayUaeYmd()}
          >
            Next Day
          </button>
          <button type="button" onClick={() => requestDate(todayUaeYmd())} disabled={loading}>
            Today
          </button>
          <button
            type="button"
            className="del-controls__primary"
            onClick={() => requestDate(date)}
            disabled={loading || !isLoadableYmd(date)}
          >
            {loading ? 'Building…' : loadedDate === date && report ? 'Reload' : 'Load Report'}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!report}>
            Print
          </button>
          <button type="button" onClick={() => void exportPdf()} disabled={!report}>
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => report && exportDailyEcommerceLedgerXlsx(report)}
            disabled={!report}
          >
            Export Excel
          </button>
        </div>
      </header>

      {loading && (
        <div className="del-skeleton">
          Building {formatDisplayDate(loadedDate || date)} from Zoho…
          {progress ? ` ${progress}` : ''}
        </div>
      )}
      {error && <div className="del-error">{error}</div>}
      {!loading && !error && !report && (
        <div className="del-empty">
          {loadedDate
            ? 'No accounting details for this date.'
            : 'Choose a date and press Load Report. Nothing is fetched from Zoho until then.'}
        </div>
      )}

      {report && sections && (
        <div className="del-print-root" ref={printRef}>
          <div className="del-print-meta">
            <strong>Daily Accounting Details</strong>
            <span>
              {formatDisplayDate(report.reportDate)} ({report.dayName})
            </span>
            <span>Generated {new Date(report.generatedAt).toLocaleString()}</span>
          </div>
          <LedgerSection section={sections.sales} defaultExpanded showSaleColumn />
          <LedgerSection section={sections.cashInHand} defaultExpanded={!sections.cashInHand.rows?.length} />
          <LedgerSection section={sections.expenses} defaultExpanded={(sections.expenses.rows?.length || 0) > 0} />
          <LedgerSection section={sections.purchasePayments} />
          <LedgerSection
            section={sections.basmatPayable}
            defaultExpanded={(sections.basmatPayable.rows?.length || 0) > 0}
          />
          {(sections.banks || []).map((b) => (
            <LedgerSection key={b.key || b.title} section={b} defaultExpanded={(b.rows?.length || 0) > 0} />
          ))}
          {(sections.creditCards || []).map((c) => (
            <LedgerSection key={c.key || c.title} section={c} defaultExpanded={(c.rows?.length || 0) > 0} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Ecommerce Report (management summary) — DAY / MONTH / YEAR / expenses / returns / ratios.
 * Route: /#/reports/ecommerce-report?date=YYYY-MM-DD&view=day
 *
 * Opening/refresh restores the URL date but does **not** auto-build (Zoho is expensive).
 * Explicit Load / Build fetches; in-memory server cache may hydrate a recent build.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { api } from '../../api/client'
import {
  addDaysYmd,
  mergeEcommerceReportSearchParams,
  parseEcommerceReportSearchParams,
  todayUaeYmd,
  type EcommerceReportView,
} from './ecommerceReportUrl'
import './EcommerceReportPage.css'

const POLL_MS = 1500
const MAX_WAIT_MS = 5 * 60 * 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n))}%`
}

type SummaryReport = {
  reportDate: string
  dayName: string
  totalDays: number
  warnings?: string[]
  day: Record<string, number>
  month: Record<string, number | null | undefined> & { daysWithSalesDenominator?: number }
  year: Record<string, number | null | undefined>
  expenses: Record<string, number | null | undefined>
  returns: Record<string, number | null | undefined>
  ratios: { day: number | null; month: number | null; year: number | null }
  limitations?: Record<string, string>
}

type SummaryJob = {
  jobId: string
  date: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress?: string
  error?: string | null
  report?: SummaryReport | null
}

type CachedProbe = {
  status: 'ready' | 'missing' | 'building'
  date: string
  jobId?: string | null
  progress?: string
  report?: SummaryReport | null
}

function MetricRows({ rows }: { rows: { label: string; value: number | null | undefined; deduct?: boolean }[] }) {
  return (
    <dl className="er-metrics">
      {rows.map((r) => (
        <div key={r.label} className="er-metrics__row">
          <dt>{r.label}</dt>
          <dd className={r.deduct ? 'neg' : undefined}>{r.deduct ? `(${fmt(r.value)})` : fmt(r.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function EcommerceReportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { date, view } = useMemo(
    () => parseEcommerceReportSearchParams(searchParams),
    [searchParams]
  )

  const [report, setReport] = useState<SummaryReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [cacheChecking, setCacheChecking] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [printRoot, setPrintRoot] = useState<HTMLDivElement | null>(null)
  const loadTokenRef = useRef(0)
  const selectedDateRef = useRef(date)
  selectedDateRef.current = date

  const setUrlDate = useCallback(
    (nextDate: string, opts?: { replace?: boolean; view?: EcommerceReportView | null }) => {
      setSearchParams(
        (prev) =>
          mergeEcommerceReportSearchParams(prev, {
            date: nextDate,
            view: opts?.view === undefined ? view : opts.view,
          }),
        { replace: Boolean(opts?.replace) }
      )
    },
    [setSearchParams, view]
  )

  // Ensure a valid date is always present in the URL (replace — no history spam).
  useEffect(() => {
    if (searchParams.get('date') === date) return
    setSearchParams(
      (prev) => mergeEcommerceReportSearchParams(prev, { date, view }),
      { replace: true }
    )
  }, [date, view, searchParams, setSearchParams])

  const applyReportIfCurrent = useCallback((ymd: string, next: SummaryReport | null) => {
    if (selectedDateRef.current !== ymd) return false
    if (next && next.reportDate && next.reportDate !== ymd) return false
    setReport(next)
    return true
  }, [])

  const pollExistingJob = useCallback(
    async (ymd: string, jobId: string, token: number) => {
      const cancelled = () => token !== loadTokenRef.current || selectedDateRef.current !== ymd
      try {
        let job = (await api.get(
          `/api/reports/ecommerce/build/${encodeURIComponent(jobId)}`,
          { timeoutMs: 20_000 }
        )) as SummaryJob
        const deadline = Date.now() + MAX_WAIT_MS
        while (job.status === 'queued' || job.status === 'running') {
          if (cancelled()) return
          if (Date.now() > deadline) {
            throw new Error(
              'Report is still building on the server. Wait a minute and open this date again.'
            )
          }
          setProgress(job.progress || 'Loading Zoho summary…')
          await sleep(POLL_MS)
          if (cancelled()) return
          job = (await api.get(
            `/api/reports/ecommerce/build/${encodeURIComponent(job.jobId)}`,
            { timeoutMs: 20_000 }
          )) as SummaryJob
        }
        if (cancelled()) return
        if (job.status === 'failed') {
          throw new Error(job.error || 'Summary build failed')
        }
        if (!job.report?.day || job.date !== ymd) {
          throw new Error('Summary job finished without a matching report for this date.')
        }
        applyReportIfCurrent(ymd, job.report)
        setProgress('')
      } catch (err: unknown) {
        if (!cancelled()) {
          setError(err instanceof Error ? err.message : 'Failed to load report')
          applyReportIfCurrent(ymd, null)
        }
      } finally {
        if (!cancelled()) setLoading(false)
      }
    },
    [applyReportIfCurrent]
  )

  /** Lightweight cache probe — never POST /build. */
  const probeCache = useCallback(
    async (ymd: string) => {
      const token = ++loadTokenRef.current
      setCacheChecking(true)
      setError('')
      setProgress('')
      setReport((prev) => (prev?.reportDate === ymd ? prev : null))
      try {
        const cached = (await api.get(
          `/api/reports/ecommerce/cached?date=${encodeURIComponent(ymd)}`,
          { timeoutMs: 15_000 }
        )) as CachedProbe
        if (token !== loadTokenRef.current || selectedDateRef.current !== ymd) return
        if (cached.status === 'ready' && cached.report?.day) {
          applyReportIfCurrent(ymd, cached.report)
        } else if (cached.status === 'building' && cached.jobId) {
          setLoading(true)
          setProgress(cached.progress || 'Build already in progress…')
          void pollExistingJob(ymd, cached.jobId, token)
        } else {
          applyReportIfCurrent(ymd, null)
        }
      } catch {
        if (token === loadTokenRef.current && selectedDateRef.current === ymd) {
          applyReportIfCurrent(ymd, null)
        }
      } finally {
        if (token === loadTokenRef.current) setCacheChecking(false)
      }
    },
    [applyReportIfCurrent, pollExistingJob]
  )

  const buildReport = useCallback(
    async (ymd: string) => {
      const token = ++loadTokenRef.current
      const cancelled = () => token !== loadTokenRef.current || selectedDateRef.current !== ymd
      setLoading(true)
      setError('')
      setProgress('Starting…')
      applyReportIfCurrent(ymd, null)
      try {
        const started = (await api.post(
          '/api/reports/ecommerce/build',
          { date: ymd },
          { timeoutMs: 20_000 }
        )) as SummaryJob
        if (cancelled()) return
        let job = started
        const deadline = Date.now() + MAX_WAIT_MS
        while (job.status === 'queued' || job.status === 'running') {
          if (cancelled()) return
          if (Date.now() > deadline) {
            throw new Error(
              'Report is still building on the server. Wait a minute and open this date again.'
            )
          }
          setProgress(job.progress || 'Loading Zoho summary…')
          await sleep(POLL_MS)
          if (cancelled()) return
          job = (await api.get(
            `/api/reports/ecommerce/build/${encodeURIComponent(job.jobId)}`,
            { timeoutMs: 20_000 }
          )) as SummaryJob
        }
        if (cancelled()) return
        if (job.status === 'failed') {
          const errMsg = job.error || 'Summary build failed'
          if (/429|rate limit|sync paused/i.test(errMsg)) {
            throw new Error(
              'Zoho is rate-limiting right now. Wait about a minute, then hit Load Report again.'
            )
          }
          throw new Error(errMsg)
        }
        if (!job.report?.day || job.date !== ymd) {
          throw new Error('Summary job finished without a matching report for this date.')
        }
        applyReportIfCurrent(ymd, job.report)
        setProgress('')
      } catch (err: unknown) {
        if (!cancelled()) {
          setError(err instanceof Error ? err.message : 'Failed to load report')
          applyReportIfCurrent(ymd, null)
        }
      } finally {
        if (!cancelled()) setLoading(false)
      }
    },
    [applyReportIfCurrent]
  )

  // On date (URL) change: cancel prior work, probe cache only — never auto-build.
  useEffect(() => {
    void probeCache(date)
    return () => {
      loadTokenRef.current += 1
    }
  }, [date, probeCache])

  // Optional section deep-link
  useEffect(() => {
    if (!view || !report) return
    const el = document.getElementById(`er-section-${view}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [view, report])

  const exportPdf = async () => {
    if (!printRoot || !report || report.reportDate !== date) return
    const canvas = await html2canvas(printRoot, { backgroundColor: '#0f1419', scale: 2 })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    const h = (canvas.height * w) / canvas.width
    pdf.addImage(img, 'PNG', 0, 0, w, h)
    pdf.save(`ecommerce-report-${report.reportDate}.pdf`)
  }

  const displayReport = report?.reportDate === date ? report : null
  const today = todayUaeYmd()

  return (
    <div className="er-page">
      <header className="er-header">
        <div>
          <h1>Ecommerce Report</h1>
          <p className="er-subtitle">
            {displayReport?.dayName || '—'} · {date.split('-').reverse().join('.')} · Total Days:{' '}
            {displayReport?.totalDays ?? '—'}
          </p>
        </div>
        <div className="er-controls">
          <button type="button" onClick={() => setUrlDate(addDaysYmd(date, -1))}>
            Previous Day
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              const v = e.target.value
              if (v) setUrlDate(v)
            }}
          />
          <button
            type="button"
            onClick={() => setUrlDate(addDaysYmd(date, 1))}
            disabled={date >= today}
          >
            Next Day
          </button>
          <button type="button" onClick={() => setUrlDate(today)}>
            Today
          </button>
          <button
            type="button"
            className="er-btn-primary"
            onClick={() => void buildReport(date)}
            disabled={loading}
          >
            {loading ? 'Building…' : displayReport ? 'Rebuild Report' : 'Load Report'}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!displayReport}>
            Print
          </button>
          <button type="button" onClick={() => void exportPdf()} disabled={!displayReport}>
            Export PDF
          </button>
        </div>
      </header>

      {(loading || cacheChecking) && (
        <div className="er-banner">
          {loading
            ? `Loading…${progress ? ` ${progress}` : ''}`
            : 'Checking for a saved report…'}
        </div>
      )}
      {error && <div className="er-banner er-banner--err">{error}</div>}
      {(displayReport?.warnings || []).map((w) => (
        <div key={w} className="er-banner er-banner--warn">
          {w}
        </div>
      ))}

      {!loading && !cacheChecking && !displayReport && (
        <div className="er-empty" role="status">
          <p>No report loaded for this date ({date.split('-').reverse().join('.')})</p>
          <p className="er-empty__hint">
            Opening or refreshing this page does not call Zoho. Click Load Report when you want to
            build.
          </p>
          <button type="button" className="er-btn-primary" onClick={() => void buildReport(date)}>
            Load Report
          </button>
        </div>
      )}

      {displayReport && (
        <div ref={setPrintRoot} className="er-grid">
          <section id="er-section-day" className="er-card">
            <h2>Day</h2>
            <MetricRows
              rows={[
                { label: 'Cash Sales', value: displayReport.day.cashSales },
                { label: 'Credit Sales', value: displayReport.day.creditSales },
                { label: 'Sale Return', value: displayReport.day.saleReturn, deduct: true },
                { label: 'Total Sales', value: displayReport.day.totalSales },
              ]}
            />
          </section>
          <section id="er-section-month" className="er-card">
            <h2>Month</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sales', value: displayReport.month.openingSales },
                { label: 'Today Sales', value: displayReport.month.todaySales },
                { label: 'Today Sale Return', value: displayReport.month.todaySaleReturn, deduct: true },
                { label: 'Total Sales', value: displayReport.month.totalSales },
                { label: 'Avg Sale / Day', value: displayReport.month.averageSalePerDay },
              ]}
            />
            <p className="er-hint">
              Denominator: {displayReport.month.daysWithSalesDenominator} calendar days in month
            </p>
          </section>
          <section id="er-section-year" className="er-card">
            <h2>Year</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sales', value: displayReport.year.openingSales },
                { label: 'Today Sales', value: displayReport.year.todaySales },
                { label: 'Today Sale Return', value: displayReport.year.todaySaleReturn, deduct: true },
                { label: 'Total Sales', value: displayReport.year.totalSales },
                { label: 'Avg Sale / Day', value: displayReport.year.averageSalePerDay },
                { label: 'Avg Sale / Month', value: displayReport.year.averageSalePerMonth },
              ]}
            />
          </section>
          <section id="er-section-expenses" className="er-card er-card--wide">
            <h2>Expenses</h2>
            <div className="er-split">
              <MetricRows
                rows={[
                  { label: 'Opening Flexible Exp', value: displayReport.expenses.openingFlexible },
                  { label: 'Today Flexible Exp', value: displayReport.expenses.todayFlexible },
                  { label: 'Total Flexible Exp', value: displayReport.expenses.totalFlexible },
                  { label: 'Avg Flexible / Day', value: displayReport.expenses.averageFlexiblePerDay },
                  {
                    label: 'Avg Flexible / Month',
                    value: displayReport.expenses.averageFlexiblePerMonth,
                  },
                ]}
              />
              <MetricRows
                rows={[
                  { label: 'Opening Fixed Exp', value: displayReport.expenses.openingFixed },
                  { label: 'Today Fixed Exp', value: displayReport.expenses.todayFixed },
                  { label: 'Total Fixed Exp', value: displayReport.expenses.totalFixed },
                  { label: 'Avg Fixed / Day', value: displayReport.expenses.averageFixedPerDay },
                  { label: 'Avg Fixed / Month', value: displayReport.expenses.averageFixedPerMonth },
                ]}
              />
            </div>
          </section>
          <section id="er-section-returns" className="er-card">
            <h2>Year Sale Returns</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sale Return', value: displayReport.returns.opening },
                { label: 'Today Sale Return', value: displayReport.returns.today },
                { label: 'Total Sale Return', value: displayReport.returns.total },
                { label: 'Avg Sale Return / Day', value: displayReport.returns.averagePerDay },
                { label: 'Avg Sale Return / Month', value: displayReport.returns.averagePerMonth },
              ]}
            />
          </section>
          <section id="er-section-ratios" className="er-card er-card--ratios">
            <h2>Return / Sale Ratios</h2>
            <div className="er-ratio-grid">
              <div>
                <span>Day</span>
                <strong>{fmtPct(displayReport.ratios.day)}</strong>
              </div>
              <div>
                <span>Month</span>
                <strong>{fmtPct(displayReport.ratios.month)}</strong>
              </div>
              <div>
                <span>Year</span>
                <strong>{fmtPct(displayReport.ratios.year)}</strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

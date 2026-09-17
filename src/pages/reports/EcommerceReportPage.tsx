/**
 * Ecommerce Report (management summary) — DAY / MONTH / YEAR / expenses / returns / ratios.
 * Route: /#/reports/ecommerce-report
 *
 * Build often exceeds the 25s client / ~30s CloudFront window (month day-by-day Zoho
 * sales), so the page starts a background job and polls — same pattern as the ledger.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { api } from '../../api/client'
import './EcommerceReportPage.css'

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
  const [date, setDate] = useState(todayUaeYmd)
  const [report, setReport] = useState<SummaryReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [printRoot, setPrintRoot] = useState<HTMLDivElement | null>(null)
  const loadTokenRef = useRef<symbol | null>(null)

  const load = useCallback(async (ymd: string) => {
    setLoading(true)
    setError('')
    setProgress('Starting…')
    setReport(null)
    const token = Symbol('summary-load')
    loadTokenRef.current = token
    const cancelled = () => loadTokenRef.current !== token
    try {
      const started = (await api.post('/api/reports/ecommerce/build', { date: ymd })) as SummaryJob
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
          { timeoutMs: 15_000 }
        )) as SummaryJob
      }
      if (cancelled()) return
      if (job.status === 'failed') {
        throw new Error(job.error || 'Summary build failed')
      }
      if (!job.report) {
        throw new Error('Summary job finished without a report')
      }
      setReport(job.report)
      setProgress('')
    } catch (err: unknown) {
      if (!cancelled()) {
        setError(err instanceof Error ? err.message : 'Failed to load report')
        setReport(null)
      }
    } finally {
      if (!cancelled()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(date)
    return () => {
      loadTokenRef.current = null
    }
  }, [date, load])

  const exportPdf = async () => {
    if (!printRoot || !report) return
    const canvas = await html2canvas(printRoot, { backgroundColor: '#0f1419', scale: 2 })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const w = pdf.internal.pageSize.getWidth()
    const h = (canvas.height * w) / canvas.width
    pdf.addImage(img, 'PNG', 0, 0, w, h)
    pdf.save(`ecommerce-report-${report.reportDate}.pdf`)
  }

  return (
    <div className="er-page">
      <header className="er-header">
        <div>
          <h1>Ecommerce Report</h1>
          <p className="er-subtitle">
            {report?.dayName || '—'} · {date.split('-').reverse().join('.')} · Total Days:{' '}
            {report?.totalDays ?? '—'}
          </p>
        </div>
        <div className="er-controls">
          <button type="button" onClick={() => setDate((d) => addDaysYmd(d, -1))} disabled={loading}>
            Previous Day
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setDate((d) => addDaysYmd(d, 1))}
            disabled={loading || date >= todayUaeYmd()}
          >
            Next Day
          </button>
          <button type="button" onClick={() => setDate(todayUaeYmd())} disabled={loading}>
            Today
          </button>
          <button type="button" onClick={() => void load(date)} disabled={loading}>
            {loading ? 'Building…' : 'Reload'}
          </button>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" onClick={() => void exportPdf()} disabled={!report}>
            Export PDF
          </button>
        </div>
      </header>

      {loading && (
        <div className="er-banner">
          Loading…{progress ? ` ${progress}` : ''}
        </div>
      )}
      {error && <div className="er-banner er-banner--err">{error}</div>}
      {(report?.warnings || []).map((w) => (
        <div key={w} className="er-banner er-banner--warn">
          {w}
        </div>
      ))}

      {report && (
        <div ref={setPrintRoot} className="er-grid">
          <section className="er-card">
            <h2>Day</h2>
            <MetricRows
              rows={[
                { label: 'Cash Sales', value: report.day.cashSales },
                { label: 'Credit Sales', value: report.day.creditSales },
                { label: 'Sale Return', value: report.day.saleReturn, deduct: true },
                { label: 'Total Sales', value: report.day.totalSales },
              ]}
            />
          </section>
          <section className="er-card">
            <h2>Month</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sales', value: report.month.openingSales },
                { label: 'Today Sales', value: report.month.todaySales },
                { label: 'Today Sale Return', value: report.month.todaySaleReturn, deduct: true },
                { label: 'Total Sales', value: report.month.totalSales },
                { label: 'Avg Sale / Day', value: report.month.averageSalePerDay },
              ]}
            />
            <p className="er-hint">Denominator: {report.month.daysWithSalesDenominator} days with sales</p>
          </section>
          <section className="er-card">
            <h2>Year</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sales', value: report.year.openingSales },
                { label: 'Today Sales', value: report.year.todaySales },
                { label: 'Today Sale Return', value: report.year.todaySaleReturn, deduct: true },
                { label: 'Total Sales', value: report.year.totalSales },
                { label: 'Avg Sale / Day', value: report.year.averageSalePerDay },
                { label: 'Avg Sale / Month', value: report.year.averageSalePerMonth },
              ]}
            />
          </section>
          <section className="er-card er-card--wide">
            <h2>Expenses</h2>
            <div className="er-split">
              <MetricRows
                rows={[
                  { label: 'Opening Flexible Exp', value: report.expenses.openingFlexible },
                  { label: 'Today Flexible Exp', value: report.expenses.todayFlexible },
                  { label: 'Total Flexible Exp', value: report.expenses.totalFlexible },
                  { label: 'Avg Flexible / Day', value: report.expenses.averageFlexiblePerDay },
                  { label: 'Avg Flexible / Month', value: report.expenses.averageFlexiblePerMonth },
                ]}
              />
              <MetricRows
                rows={[
                  { label: 'Opening Fixed Exp', value: report.expenses.openingFixed },
                  { label: 'Today Fixed Exp', value: report.expenses.todayFixed },
                  { label: 'Total Fixed Exp', value: report.expenses.totalFixed },
                  { label: 'Avg Fixed / Day', value: report.expenses.averageFixedPerDay },
                  { label: 'Avg Fixed / Month', value: report.expenses.averageFixedPerMonth },
                ]}
              />
            </div>
          </section>
          <section className="er-card">
            <h2>Year Sale Returns</h2>
            <MetricRows
              rows={[
                { label: 'Opening Sale Return', value: report.returns.opening },
                { label: 'Today Sale Return', value: report.returns.today },
                { label: 'Total Sale Return', value: report.returns.total },
                { label: 'Avg Sale Return / Day', value: report.returns.averagePerDay },
                { label: 'Avg Sale Return / Month', value: report.returns.averagePerMonth },
              ]}
            />
          </section>
          <section className="er-card er-card--ratios">
            <h2>Return / Sale Ratios</h2>
            <div className="er-ratio-grid">
              <div>
                <span>Day</span>
                <strong>{fmtPct(report.ratios.day)}</strong>
              </div>
              <div>
                <span>Month</span>
                <strong>{fmtPct(report.ratios.month)}</strong>
              </div>
              <div>
                <span>Year</span>
                <strong>{fmtPct(report.ratios.year)}</strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

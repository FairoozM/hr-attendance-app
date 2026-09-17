/**
 * Daily Ecommerce Ledger — Zoho Books opening / day movements / closing.
 * Route: /#/reports/daily-ecommerce-ledger
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { api } from '../../api/client'
import { LedgerSection, type LedgerSectionData } from './LedgerSection'
import './DailyEcommerceLedgerPage.css'

const IANA_UAE = 'Asia/Dubai'

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

export function DailyEcommerceLedgerPage() {
  const [date, setDate] = useState(todayUaeYmd)
  const [report, setReport] = useState<LedgerReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const printRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (ymd: string) => {
    setLoading(true)
    setError('')
    try {
      const data = (await api.get(`/api/reports/daily-ecommerce-ledger?date=${encodeURIComponent(ymd)}`)) as LedgerReport
      setReport(data)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load ledger'
      setError(message)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(date)
  }, [date, load])

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
    pdf.save(`daily-ecommerce-ledger-${report.reportDate}.pdf`)
  }

  const sections = report?.sections

  return (
    <div className="del-page">
      <header className="del-header">
        <div>
          <h1>Daily Ecommerce Ledger</h1>
          <p className="del-subtitle">
            {formatDisplayDate(date)} · {report?.dayName || '—'}
          </p>
        </div>
        <div className="del-controls">
          <button type="button" onClick={() => setDate((d) => addDaysYmd(d, -1))}>
            Previous Day
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" onClick={() => setDate((d) => addDaysYmd(d, 1))} disabled={date >= todayUaeYmd()}>
            Next Day
          </button>
          <button type="button" onClick={() => setDate(todayUaeYmd())}>
            Today
          </button>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" onClick={() => void exportPdf()} disabled={!report}>
            Export PDF
          </button>
        </div>
      </header>

      {loading && <div className="del-skeleton">Loading ledger from Zoho…</div>}
      {error && <div className="del-error">{error}</div>}
      {!loading && !error && !report && <div className="del-empty">No ledger data.</div>}

      {report && sections && (
        <div className="del-print-root" ref={printRef}>
          <div className="del-print-meta">
            <strong>Daily Ecommerce Ledger</strong>
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

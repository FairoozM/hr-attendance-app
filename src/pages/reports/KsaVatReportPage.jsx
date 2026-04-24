import { useState, useMemo, useCallback } from 'react'
import { useVatCustomers, useKsaVatReport } from '../../hooks/useKsaVatReport'
import { calcVatSummary, defaultQuarterRange, formatSAR } from '../../utils/ksaVatCalc'
import { formatDateLabel, NotConfiguredCallout, ErrorCallout } from './WeeklySalesReportPage'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'
import './KsaVatReportPage.css'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNum(val) {
  if (val == null) return '—'
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// ── Sub-components ───────────────────────────────────────────────────────────

function InvoiceTable({ invoices, dateLabel }) {
  if (invoices.length === 0) {
    return (
      <div className="wsr-empty">
        <strong>No invoices found for this period.</strong>
        <span className="wsr-empty__sub">
          No Zoho Books invoices matched the selected date range
          {dateLabel ? ` (${dateLabel})` : ''}.
        </span>
      </div>
    )
  }
  return (
    <div className="war-table-wrap">
      <table className="war-table">
        <thead>
          <tr>
            <th className="war-th wsr-th--sr">SR. NO</th>
            <th className="war-th wsr-th--item">Customer Name</th>
            <th className="war-th">Invoice Count</th>
            <th className="war-th">Taxable Amount (SAR)</th>
            <th className="war-th">VAT Amount (SAR)</th>
            <th className="war-th">Gross Total (SAR)</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((row, idx) => (
            <tr key={row.customer_id || idx} className="war-tr">
              <td className="war-td wsr-td--sr">{idx + 1}</td>
              <td className="war-td wsr-td--item">{row.customer_name || '—'}</td>
              <td className="war-td">{formatNum(row.count)}</td>
              <td className="war-td">{formatSAR(row.taxable_amount)}</td>
              <td className="war-td">{formatSAR(row.tax_amount)}</td>
              <td className="war-td">{formatSAR(row.total)}</td>
            </tr>
          ))}
        </tbody>
        {invoices.length > 1 && (() => {
          const totTaxable = invoices.reduce((s, r) => s + (r.taxable_amount || 0), 0)
          const totTax     = invoices.reduce((s, r) => s + (r.tax_amount     || 0), 0)
          const totTotal   = invoices.reduce((s, r) => s + (r.total          || 0), 0)
          const totCount   = invoices.reduce((s, r) => s + (r.count          || 0), 0)
          return (
            <tfoot>
              <tr className="war-tr war-tr--total">
                <td className="war-td wsr-td--sr" />
                <td className="war-td wsr-td--item">Total</td>
                <td className="war-td">{formatNum(totCount)}</td>
                <td className="war-td">{formatSAR(totTaxable)}</td>
                <td className="war-td">{formatSAR(totTax)}</td>
                <td className="war-td">{formatSAR(totTotal)}</td>
              </tr>
            </tfoot>
          )
        })()}
      </table>
    </div>
  )
}

function CreditNoteTable({ creditNotes, dateLabel }) {
  if (creditNotes.length === 0) {
    return (
      <div className="wsr-empty">
        <strong>No credit notes found for this period.</strong>
        <span className="wsr-empty__sub">
          No Zoho Books credit notes matched the selected date range
          {dateLabel ? ` (${dateLabel})` : ''}.
        </span>
      </div>
    )
  }
  return (
    <div className="war-table-wrap">
      <table className="war-table">
        <thead>
          <tr>
            <th className="war-th wsr-th--sr">SR. NO</th>
            <th className="war-th wsr-th--item">Customer Name</th>
            <th className="war-th">Credit Note Count</th>
            <th className="war-th">Taxable Amount (SAR)</th>
            <th className="war-th">VAT Amount (SAR)</th>
            <th className="war-th">Gross Total (SAR)</th>
          </tr>
        </thead>
        <tbody>
          {creditNotes.map((row, idx) => (
            <tr key={row.customer_id || idx} className="war-tr">
              <td className="war-td wsr-td--sr">{idx + 1}</td>
              <td className="war-td wsr-td--item">{row.customer_name || '—'}</td>
              <td className="war-td">{formatNum(row.count)}</td>
              <td className="war-td">{formatSAR(row.taxable_amount)}</td>
              <td className="war-td">{formatSAR(row.tax_amount)}</td>
              <td className="war-td">{formatSAR(row.total)}</td>
            </tr>
          ))}
        </tbody>
        {creditNotes.length > 1 && (() => {
          const totTaxable = creditNotes.reduce((s, r) => s + (r.taxable_amount || 0), 0)
          const totTax     = creditNotes.reduce((s, r) => s + (r.tax_amount     || 0), 0)
          const totTotal   = creditNotes.reduce((s, r) => s + (r.total          || 0), 0)
          const totCount   = creditNotes.reduce((s, r) => s + (r.count          || 0), 0)
          return (
            <tfoot>
              <tr className="war-tr war-tr--total">
                <td className="war-td wsr-td--sr" />
                <td className="war-td wsr-td--item">Total</td>
                <td className="war-td">{formatNum(totCount)}</td>
                <td className="war-td">{formatSAR(totTaxable)}</td>
                <td className="war-td">{formatSAR(totTax)}</td>
                <td className="war-td">{formatSAR(totTotal)}</td>
              </tr>
            </tfoot>
          )
        })()}
      </table>
    </div>
  )
}

function VatSummaryRow({ label, value, highlight, note }) {
  return (
    <div className={`kvat-summary__row${highlight ? ' kvat-summary__row--highlight' : ''}`}>
      <span className="kvat-summary__label">{label}</span>
      {note && <span className="kvat-summary__note">{note}</span>}
      <span className="kvat-summary__value">{value}</span>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

/**
 * KSA VAT Tax Report page.
 *
 * - Shared filters: date range (default = current quarter) + customer dropdown
 * - Section A: Invoice VAT Summary table
 * - Section B: Credit Notes Summary table
 * - Section C: VAT Payable summary with manual "Other Input VAT" field
 */
export function KsaVatReportPage() {
  const initial = useMemo(defaultQuarterRange, [])
  const [fromDate, setFromDate]       = useState(initial.from)
  const [toDate, setToDate]           = useState(initial.to)
  const [customerId, setCustomerId]   = useState('')
  const [otherInputVat, setOtherInputVat] = useState('')

  const { customers, loading: customersLoading } = useVatCustomers()

  const {
    invoices, creditNotes, totals, meta,
    loading, error, notConfigured, refetch,
  } = useKsaVatReport({ fromDate, toDate, customerId: customerId || null })

  const handleFromChange     = useCallback((e) => setFromDate(e.target.value), [])
  const handleToChange       = useCallback((e) => setToDate(e.target.value), [])
  const handleCustomerChange = useCallback((e) => setCustomerId(e.target.value), [])
  const handleOtherVatChange = useCallback((e) => {
    const v = e.target.value
    if (v === '' || /^-?\d*\.?\d*$/.test(v)) setOtherInputVat(v)
  }, [])

  const datesValid = Boolean(fromDate) && Boolean(toDate) && fromDate <= toDate
  const dateLabel  = formatDateLabel(fromDate, toDate)

  const otherVatNum = parseFloat(otherInputVat) || 0

  const vatSummary = useMemo(() => {
    if (!totals) return null
    return calcVatSummary({
      invoiceTaxable: totals.invoice_taxable || 0,
      invoiceTax:     totals.invoice_tax     || 0,
      cnTaxable:      totals.cn_taxable      || 0,
      cnTax:          totals.cn_tax          || 0,
      otherInputVat:  otherVatNum,
    })
  }, [totals, otherVatNum])

  const showContent = !loading && !error && !notConfigured && datesValid

  const selectedCustomer = customers.find((c) => c.contact_id === customerId)

  return (
    <div className="war-page">
      {/* ── Page header ── */}
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">KSA VAT Tax Report</h1>
          <p className="war-page__sub">
            Quarterly VAT filing summary — invoices, credit notes, and net VAT payable (15% KSA rate)
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <section className="war-section">
        <h2 className="war-section__title">Filters</h2>
        <div className="wsr-toolbar wsr-toolbar--filters">
          {/* Date range */}
          <div className="wsr-toolbar__dates">
            <div className="war-form-field">
              <label className="war-label" htmlFor="kvat-from">Start Date</label>
              <input
                id="kvat-from"
                type="date"
                className="war-input"
                value={fromDate}
                max={toDate || undefined}
                onChange={handleFromChange}
              />
            </div>
            <div className="war-form-field">
              <label className="war-label" htmlFor="kvat-to">End Date</label>
              <input
                id="kvat-to"
                type="date"
                className="war-input"
                value={toDate}
                min={fromDate || undefined}
                onChange={handleToChange}
              />
            </div>
          </div>

          {/* Customer filter */}
          <div className="war-form-field wsr-warehouse-field">
            <label className="war-label" htmlFor="kvat-customer">Customer</label>
            <div className="wsr-warehouse-select-wrap">
              <select
                id="kvat-customer"
                className="war-input wsr-warehouse-select"
                value={customerId}
                onChange={handleCustomerChange}
                disabled={customersLoading}
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.contact_id} value={c.contact_id}>
                    {c.contact_name}
                  </option>
                ))}
              </select>
              {customersLoading && <span className="wsr-warehouse-loading">Loading…</span>}
            </div>
          </div>

          {/* Refresh */}
          <div className="wsr-section-header__actions" style={{ alignSelf: 'flex-end' }}>
            <button
              type="button"
              className="war-btn war-btn--ghost war-btn--sm"
              onClick={refetch}
              disabled={loading || !datesValid}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {dateLabel && <span className="wsr-date-badge">{dateLabel}</span>}
        </div>

        {!datesValid && (
          <div className="wsr-callout wsr-callout--warn" style={{ marginTop: 12 }}>
            <span className="wsr-callout__title">Invalid date range</span>
            <div className="wsr-callout__body">Pick a Start Date before or equal to the End Date.</div>
          </div>
        )}

        {selectedCustomer && (
          <div className="wsr-warehouse-badge">
            Filtered to: <strong>{selectedCustomer.contact_name}</strong>
          </div>
        )}

        {meta?.invoice_truncated && (
          <div className="wsr-callout wsr-callout--warn" style={{ marginTop: 12 }}>
            <span className="wsr-callout__title">Invoice list truncated</span>
            <div className="wsr-callout__body">
              Too many invoices for this period — only the first 50 pages were fetched. Narrow the date range for complete results.
            </div>
          </div>
        )}
      </section>

      {/* ── Error / not-configured states ── */}
      {notConfigured && <NotConfiguredCallout message={error} />}
      {error && !notConfigured && <ErrorCallout message={error} onRetry={refetch} />}
      {loading && (
        <section className="war-section">
          <div className="wsr-loading">Loading VAT report from Zoho Books…</div>
        </section>
      )}

      {showContent && (
        <>
          {/* ── Section A: Invoice VAT Summary ── */}
          <section className="war-section wsr-report-section">
            <div className="wsr-section-header">
              <div className="wsr-section-header__title-wrap">
                <h2 className="wsr-section-heading">Invoice VAT Summary</h2>
                {dateLabel && <span className="wsr-section-header__date">{dateLabel}</span>}
              </div>
            </div>
            <InvoiceTable invoices={invoices} dateLabel={dateLabel} />
            {invoices.length > 0 && (
              <div className="wsr-meta">
                <div className="wsr-meta__item">Customers:<strong>{invoices.length}</strong></div>
                <div className="wsr-meta__item">Source:<strong>Zoho Books (live)</strong></div>
              </div>
            )}
          </section>

          <div className="wsr-section-divider" aria-hidden />

          {/* ── Section B: Credit Notes Summary ── */}
          <section className="war-section wsr-report-section">
            <div className="wsr-section-header">
              <div className="wsr-section-header__title-wrap">
                <h2 className="wsr-section-heading">Credit Notes Summary</h2>
                {dateLabel && <span className="wsr-section-header__date">{dateLabel}</span>}
              </div>
            </div>
            <CreditNoteTable creditNotes={creditNotes} dateLabel={dateLabel} />
            {creditNotes.length > 0 && (
              <div className="wsr-meta">
                <div className="wsr-meta__item">Customers:<strong>{creditNotes.length}</strong></div>
                <div className="wsr-meta__item">Source:<strong>Zoho Books (live)</strong></div>
              </div>
            )}
          </section>

          <div className="wsr-section-divider" aria-hidden />

          {/* ── Section C: VAT Payable Summary ── */}
          <section className="war-section">
            <h2 className="war-section__title">VAT Payable Summary</h2>

            {/* Other Input VAT field */}
            <div className="kvat-input-row">
              <div className="war-form-field kvat-input-field">
                <label className="war-label" htmlFor="kvat-other-input">Other Input VAT (SAR)</label>
                <input
                  id="kvat-other-input"
                  type="text"
                  inputMode="decimal"
                  className="war-input kvat-other-input"
                  value={otherInputVat}
                  onChange={handleOtherVatChange}
                  placeholder="0.00"
                />
              </div>
              <p className="kvat-input-hint">
                Manual input VAT to subtract from the net output VAT (e.g. eligible purchases).
              </p>
            </div>

            {vatSummary ? (
              <div className="kvat-summary">
                <VatSummaryRow
                  label="Total Taxable Invoice Amount"
                  value={formatSAR(totals?.invoice_taxable)}
                />
                <VatSummaryRow
                  label="Output VAT from Invoices"
                  value={formatSAR(vatSummary.outputVat)}
                  note={vatSummary.invoiceTaxUsedRate ? '(calculated at 15%)' : '(from Zoho)'}
                />
                <VatSummaryRow
                  label="Total Taxable Credit Notes"
                  value={formatSAR(totals?.cn_taxable)}
                />
                <VatSummaryRow
                  label="VAT Adjustment from Credit Notes"
                  value={formatSAR(vatSummary.cnVatAdjustment)}
                  note={vatSummary.cnTaxUsedRate ? '(calculated at 15%)' : '(from Zoho)'}
                />
                <VatSummaryRow
                  label="Net Output VAT"
                  value={formatSAR(vatSummary.netOutputVat)}
                />
                <VatSummaryRow
                  label="Other Input VAT"
                  value={formatSAR(vatSummary.otherInputVat)}
                />
                <div className="kvat-summary__divider" aria-hidden />
                <VatSummaryRow
                  label="Net VAT Payable"
                  value={formatSAR(vatSummary.netVatPayable)}
                  highlight
                />
              </div>
            ) : (
              <div className="wsr-empty">
                <strong>No data to calculate.</strong>
                <span className="wsr-empty__sub">Select a date range and load the report first.</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default KsaVatReportPage

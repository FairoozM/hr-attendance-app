import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Download, ExternalLink, RefreshCw, UserRound, X } from 'lucide-react'
import { useAuth, canViewInfluencerPerformanceNetProfit, hasPermission } from '../../contexts/AuthContext'
import { influencerInitials } from '../../components/influencers/influencerPerformanceTableShared'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'
import { INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES, INFLUENCER_CONTRACT_PAYMENT_STATUSES } from '../../types/influencer'
import type { InfluencerContractPaymentFilterStatus, InfluencerContractPaymentStatus } from '../../types/influencer'
import { useInfluencerPaymentsRoi } from './useInfluencerPaymentsRoi'
import {
  influencerProfileUrl,
  performanceContractUrl,
  type InfluencerContractPaymentRow,
  type InfluencerPaymentsProfitFilter,
  type InfluencerPaymentsRoiDatePreset,
} from './influencerPaymentsRoiUtils'
import { exportPaymentsRoiXlsx } from './influencerPaymentsRoiExport'
import './influencers.css'
import './InfluencerDashboard.css'
import './InfluencerPaymentsRoi.css'
import './InfluencerContracts.css'

const DATE_PRESETS: Array<{ id: InfluencerPaymentsRoiDatePreset; label: string }> = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
  { id: 'all_time', label: 'All Time' },
]

const PROFIT_FILTERS: Array<{ id: InfluencerPaymentsProfitFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'profitable', label: 'Profitable' },
  { id: 'loss_making', label: 'Loss-Making' },
]

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

function paymentBadgeClass(status: string): string {
  const map: Record<string, string> = {
    Untracked: 'inf-badge--waiting',
    'Not Due': 'inf-badge--not-requested',
    Pending: 'inf-badge--ready',
    'Partially Paid': 'inf-badge--processing',
    Paid: 'inf-badge--paid',
    Overdue: 'inf-badge--waiting',
    Disputed: 'inf-badge--rejected',
  }
  return map[status] || 'inf-badge--not-requested'
}

function KpiCard({
  label,
  value,
  tone = 'blue',
  hint,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
}) {
  return (
    <div className={`inf-stat inf-stat--${tone}`} title={hint}>
      <div className="inf-stat__value">{value}</div>
      <div className="inf-stat__label">{label}</div>
    </div>
  )
}

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  return (
    <span className="inf-dashboard__avatar" aria-hidden="true">
      {imageUrl ? <img src={imageUrl} alt="" /> : <span>{influencerInitials(name)}</span>}
    </span>
  )
}

function PaymentsSkeleton() {
  return (
    <div>
      <div className="inf-dashboard__skeleton-grid">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="inf-dashboard__skeleton" />
        ))}
      </div>
      <div className="inf-payments-roi__skeleton-table inf-dashboard__skeleton-panel" />
    </div>
  )
}

type EditFormState = {
  amountPaid: string
  paymentStatus: InfluencerContractPaymentStatus
  dueDate: string
  paymentDate: string
  invoiceReference: string
  notes: string
}

function PaymentEditModal({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: InfluencerContractPaymentRow
  saving: boolean
  onClose: () => void
  onSave: (form: EditFormState) => Promise<void>
}) {
  const [form, setForm] = useState<EditFormState>({
    amountPaid: String(row.amountPaid || ''),
    paymentStatus: (row.storedPaymentStatus || 'Not Due') as InfluencerContractPaymentStatus,
    dueDate: row.dueDate || '',
    paymentDate: row.paymentDate || '',
    invoiceReference: row.invoiceReference || '',
    notes: row.notes || '',
  })
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save payment.')
    }
  }

  return (
    <div className="inf-payments-roi__modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="clay-card inf-payments-roi__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="inf-payments-roi__modal-head">
          <div>
            <h2 id="payment-edit-title" className="inf-payments-roi__modal-title">Update payment</h2>
            <p className="inf-payments-roi__modal-sub">
              {row.influencerName} · {row.contractLabel}
            </p>
          </div>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={onClose}>Close</button>
        </div>

        <form className="inf-payments-roi__modal-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Amount paid (AED)
            <input
              className="ip-control"
              type="number"
              min="0"
              step="0.01"
              value={form.amountPaid}
              onChange={(event) => setForm((current) => ({ ...current, amountPaid: event.target.value }))}
            />
          </label>
          <label>
            Payment status
            <select
              className="ip-control"
              value={form.paymentStatus}
              onChange={(event) => setForm((current) => ({
                ...current,
                paymentStatus: event.target.value as InfluencerContractPaymentStatus,
              }))}
            >
              {INFLUENCER_CONTRACT_PAYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input
              className="ip-control"
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </label>
          <label>
            Payment date
            <input
              className="ip-control"
              type="date"
              value={form.paymentDate}
              onChange={(event) => setForm((current) => ({ ...current, paymentDate: event.target.value }))}
            />
          </label>
          <label>
            Invoice reference
            <input
              className="ip-control"
              type="text"
              placeholder="Invoice number or external reference"
              value={form.invoiceReference}
              onChange={(event) => setForm((current) => ({ ...current, invoiceReference: event.target.value }))}
            />
            <span className="inf-payments-roi__field-hint">
              File upload is not available for influencer invoices yet — reference text only.
            </span>
          </label>
          <label>
            Notes
            <textarea
              className="ip-control"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>

          {error ? <p className="inf-payments-roi__form-error">{error}</p> : null}

          <div className="inf-payments-roi__modal-actions">
            <button type="button" className="inf-btn inf-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="inf-btn inf-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function PaymentsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const canEdit = hasPermission(user, 'influencers', 'payments')
    || hasPermission(user, 'influencers', 'manage')

  const {
    loading,
    error,
    savingContractId,
    reload,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    influencerId,
    setInfluencerId,
    paymentStatus,
    setPaymentStatus,
    profitFilter,
    setProfitFilter,
    outstandingOnly,
    setOutstandingOnly,
    influencers,
    filteredRows,
    summary,
    updatePayment,
  } = useInfluencerPaymentsRoi()

  const [editRow, setEditRow] = useState<InfluencerContractPaymentRow | null>(null)
  const [exporting, setExporting] = useState(false)

  const influencerOptions = useMemo(
    () => influencers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((inf) => ({ id: String(inf.id), name: inf.name })),
    [influencers],
  )

  function clearInfluencerFilter() {
    setInfluencerId('All')
  }

  const filteredInfluencer = useMemo(
    () => (influencerId !== 'All' ? influencers.find((inf) => String(inf.id) === String(influencerId)) : null),
    [influencerId, influencers],
  )

  function handleExport() {
    setExporting(true)
    try {
      exportPaymentsRoiXlsx(filteredRows)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <PaymentsSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load payments & ROI</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  if (!summary) return <PaymentsSkeleton />

  return (
    <div className="inf-payments-roi">
      {filteredInfluencer ? (
        <div className="inf-contracts__filter-banner">
          <UserRound size={14} aria-hidden />
          <span>Filtered by: <strong>{filteredInfluencer.name}</strong></span>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={clearInfluencerFilter}>
            <X size={12} aria-hidden /> Clear filter
          </button>
          <Link to={influencerProfileUrl(String(filteredInfluencer.id))} className="inf-btn inf-btn--ghost inf-btn--xs">
            View profile
          </Link>
        </div>
      ) : null}

      <div className="inf-payments-roi__intro clay-card">
        <div>
          <h2 className="inf-payments-roi__title">Payments & ROI</h2>
          <p className="inf-payments-roi__subtitle">
            Contract-level payment tracking and financial performance. Payment statuses are stored per contract — not inferred from cost alone.
          </p>
        </div>
        <button
          type="button"
          className="inf-btn inf-btn--secondary inf-btn--xs"
          onClick={handleExport}
          disabled={exporting || filteredRows.length === 0}
        >
          <Download size={14} aria-hidden />
          {exporting ? 'Exporting…' : 'Export XLSX'}
        </button>
      </div>

      <div className="inf-dashboard__toolbar">
        <div className="inf-dashboard__filters">
          <span className="inf-dashboard__filter-label">Period</span>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`inf-chip ${datePreset === preset.id ? 'inf-chip--active' : ''}`}
              onClick={() => setDatePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {datePreset === 'custom' ? (
        <div className="inf-dashboard__custom-range clay-card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
          <label>
            From
            <input className="ip-control" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label>
            To
            <input className="ip-control" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="inf-dashboard__kpi-grid">
        <KpiCard label="Total Contracted Cost" value={formatAed(summary.totalContractedCost)} tone="amber" />
        <KpiCard label="Total Paid" value={formatAed(summary.totalPaid)} tone="green" />
        <KpiCard
          label="Outstanding Payments"
          value={formatAed(summary.outstandingPayments)}
          tone="red"
          hint="Persisted payment rows only — Untracked contracts excluded"
        />
        <KpiCard label="Total Sales" value={formatAed(summary.totalSales)} tone="purple" />
        {showNetProfit ? (
          <>
            <KpiCard label="Total Net Profit" value={formatAed(summary.totalNetProfit)} tone="pink" />
            <KpiCard label="Overall ROI" value={formatPct(summary.overallRoi)} tone="indigo" hint="Net profit / cost" />
            <KpiCard label="Loss-Making Spend" value={formatAed(summary.lossMakingSpend)} tone="teal" hint="Cost on loss-making contracts" />
          </>
        ) : (
          <>
            <KpiCard label="Total Net Profit" value="—" tone="pink" hint="Admin only" />
            <KpiCard label="Overall ROI" value="—" tone="indigo" hint="Admin only" />
            <KpiCard label="Loss-Making Spend" value="—" tone="teal" hint="Admin only" />
          </>
        )}
      </div>

      <div className="inf-payments-roi__filters clay-card">
        <label>
          Influencer
          <select className="ip-control" value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
            <option value="All">All influencers</option>
            {influencerOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <label>
          Payment status
          <select
            className="ip-control"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as InfluencerContractPaymentFilterStatus | 'All')}
          >
            <option value="All">All statuses</option>
            {INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <div className="inf-payments-roi__chip-group">
          <span className="inf-dashboard__filter-label">Performance</span>
          {PROFIT_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`inf-chip ${profitFilter === filter.id ? 'inf-chip--active' : ''}`}
              onClick={() => setProfitFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="inf-payments-roi__checkbox">
          <input
            type="checkbox"
            checked={outstandingOnly}
            onChange={(e) => setOutstandingOnly(e.target.checked)}
          />
          Outstanding only
        </label>
      </div>

      <div className="inf-table-wrap clay-card">
        {filteredRows.length === 0 ? (
          <div className="inf-empty">
            <div className="inf-empty__icon">💳</div>
            <div className="inf-empty__title">No contracts match these filters</div>
            <div className="inf-empty__desc">
              Adjust the date range or add performance contracts with cost data.
            </div>
          </div>
        ) : (
          <table className="inf-table inf-payments-roi__table">
            <thead>
              <tr>
                <th>Influencer</th>
                <th>Contract</th>
                <th>Contract Cost</th>
                <th>Amount Paid</th>
                <th>Outstanding</th>
                <th>Payment Status</th>
                <th>Due Date</th>
                <th>Payment Date</th>
                <th>Invoice</th>
                <th>Sales</th>
                {showNetProfit ? (
                  <>
                    <th>Net Profit</th>
                    <th>ROI</th>
                  </>
                ) : null}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.contractId}>
                  <td>
                    <button
                      type="button"
                      className="inf-payments-roi__identity"
                      onClick={() => navigate(influencerProfileUrl(row.influencerId))}
                    >
                      <Avatar name={row.influencerName} imageUrl={row.influencerImage} />
                      <span>
                        <strong>{row.influencerName}</strong>
                        <em>{row.influencerHandle || '—'}</em>
                      </span>
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="inf-payments-roi__link"
                      onClick={() => navigate(performanceContractUrl(row.contractId))}
                    >
                      {row.contractLabel}
                    </button>
                    <div className="inf-table__muted">
                      {fmtDMY(row.contractStartDate)} – {fmtDMY(row.contractEndDate)}
                    </div>
                  </td>
                  <td>{formatAed(row.contractCost)}</td>
                  <td>{formatAed(row.amountPaid)}</td>
                  <td className={row.hasPersistedPayment && row.amountOutstanding > 0 ? 'inf-payments-roi__outstanding' : ''}>
                    {row.hasPersistedPayment ? formatAed(row.amountOutstanding) : '—'}
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${paymentBadgeClass(row.effectiveStatus)}`}>
                      {row.effectiveStatus}
                    </span>
                    {row.hasPersistedPayment && row.storedPaymentStatus && row.effectiveStatus !== row.storedPaymentStatus ? (
                      <div className="inf-table__muted">Stored: {row.storedPaymentStatus}</div>
                    ) : null}
                  </td>
                  <td>{row.dueDate ? fmtDMY(row.dueDate) : '—'}</td>
                  <td>{row.paymentDate ? fmtDMY(row.paymentDate) : '—'}</td>
                  <td>
                    {row.invoiceReference ? (
                      <span className="inf-table__muted">{row.invoiceReference}</span>
                    ) : (
                      <span className="inf-table__muted" title="Invoice file upload is not available yet">—</span>
                    )}
                  </td>
                  <td>{formatAed(row.salesAed)}</td>
                  {showNetProfit ? (
                    <>
                      <td className={row.netProfitAed < 0 ? 'inf-payments-roi__loss' : ''}>
                        {formatAed(row.netProfitAed)}
                      </td>
                      <td>{formatPct(row.roi)}</td>
                    </>
                  ) : null}
                  <td>
                    <div className="inf-table__actions">
                      {canEdit ? (
                        <button
                          type="button"
                          className="inf-btn inf-btn--primary inf-btn--xs"
                          disabled={savingContractId === row.contractId}
                          onClick={() => setEditRow(row)}
                        >
                          {savingContractId === row.contractId ? 'Saving…' : 'Update'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inf-btn inf-btn--ghost inf-btn--xs"
                        title="Open contract timeline"
                        onClick={() => navigate(performanceContractUrl(row.contractId))}
                      >
                        <ExternalLink size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inf-btn inf-btn--ghost inf-btn--xs"
                        title="Open influencer profile"
                        onClick={() => navigate(influencerProfileUrl(row.influencerId))}
                      >
                        <UserRound size={14} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editRow ? (
        <PaymentEditModal
          row={editRow}
          saving={savingContractId === editRow.contractId}
          onClose={() => setEditRow(null)}
          onSave={async (form) => {
            await updatePayment(editRow.contractId, {
              influencerId: editRow.influencerId,
              amountPaid: Number(form.amountPaid || 0),
              paymentStatus: form.paymentStatus,
              dueDate: form.dueDate || null,
              paymentDate: form.paymentDate || null,
              invoiceReference: form.invoiceReference,
              notes: form.notes,
            })
          }}
        />
      ) : null}
    </div>
  )
}

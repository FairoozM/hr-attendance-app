import { useState } from 'react'
import { fmtDMY } from '../../utils/dateFormat'
import { leaveStatusDisplay } from './annualLeaveLabels'
import { alPeriodDate } from '../../utils/annualLeaveUtils'
import { getNextAction, getLeaveKeyInfo, NA } from './leaveNextAction'
import { LeaveTimeline } from './LeaveTimeline'
import { IconChevron } from './annualLeaveRowIcons'
import { LeaveLetterActions } from './LeaveLetterActions'
import './LeaveWorkflowCard.css'

/**
 * Single workflow card for an expanded row: one next action, compact facts, optional details.
 */
export function LeaveWorkflowCard({
  row,
  isAdmin,
  isEmployee,
  letterBusyId,
  onPreviewLeaveLetter,
  onDownloadLeaveLetter,
  onRegenerateLeaveLetter,
  onApprove,
  onReject,
  onEdit,
  onOpenEmployeeShop,
  onShopConfirmOpen,
  onShopRescheduleOpen,
  onApplySalaryOpen,
  onShopMarkCompleteOpen,
  onConfirmReturn,
  onExtend,
  onOpenNote,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const es = row.effective_status || row.status
  const na = getNextAction(row, { isAdmin, isEmployee })
  const secondary = na.secondary || []
  const key = getLeaveKeyInfo(row)
  const letterBusy = letterBusyId === row.id

  function run(id) {
    switch (id) {
      case NA.APPROVE:
        onApprove?.(row)
        break
      case NA.REJECT:
        onReject?.(row)
        break
      case NA.EDIT:
        onEdit?.(row)
        break
      case NA.EMPLOYEE_SHOP:
        onOpenEmployeeShop?.(row)
        break
      case NA.CONFIRM_SHOP:
        onShopConfirmOpen?.(row)
        break
      case NA.RESCHEDULE_SHOP:
        onShopRescheduleOpen?.(row)
        break
      case NA.APPLY_SALARY:
        onApplySalaryOpen?.(row)
        break
      case NA.MARK_SHOP_DONE:
        onShopMarkCompleteOpen?.(row)
        break
      case NA.RETURN:
        onConfirmReturn?.(row)
        break
      case NA.EXTEND:
        onExtend?.(row)
        break
      default:
        break
    }
  }

  return (
    <div className="lwc" onClick={(e) => e.stopPropagation()}>
      <header className="lwc__head">
        <div>
          <h3 className="lwc__name">{row.full_name}</h3>
          <p className="lwc__dates">
            {alPeriodDate(row.from_date)} – {alPeriodDate(row.to_date)} · {key.days} day{key.days !== 1 ? 's' : ''}
          </p>
        </div>
        <p className="lwc__badge" title="Current stage">
          {leaveStatusDisplay(es)}
        </p>
      </header>

      <section className="lwc__next" aria-label="Next action">
        <p className="lwc__next-msg">{na.message}</p>
        <div className="lwc__next-btns">
          {na.primaryId && (
            <button
              type="button"
              className="lwc__btn lwc__btn--primary"
              onClick={() => run(na.primaryId)}
            >
              {na.primaryLabel || 'Continue'}
            </button>
          )}
          {secondary.map((b) => (
            <button
              key={b.id}
              type="button"
              className={b.id === NA.REJECT ? 'lwc__btn lwc__btn--mute' : 'lwc__btn lwc__btn--secondary'}
              onClick={() => run(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </section>

      <dl className="lwc__info">
        <div>
          <dt>Expected return</dt>
          <dd>{row.expected_return_date ? fmtDMY(row.expected_return_date) : '—'}</dd>
        </div>
        <div>
          <dt>Alternate</dt>
          <dd>{row.alternate_employee_full_name || '—'}</dd>
        </div>
        {row.status === 'Approved' && key.shopLine && (
          <div>
            <dt>Shop visit</dt>
            <dd>{key.shopLine}</dd>
          </div>
        )}
        {key.salaryLine && (
          <div>
            <dt>Handover amount</dt>
            <dd>{key.salaryLine}</dd>
          </div>
        )}
      </dl>

      {isAdmin && row.status === 'Approved' && row.shop_visit_status && row.shop_visit_status !== 'PendingSubmission' && (
        <p className="lwc__inline-note">
          <button type="button" className="lwc__link" onClick={() => onOpenNote?.(row)}>
            Internal handover note
          </button>
        </p>
      )}

      <button
        type="button"
        className="lwc__toggle"
        onClick={() => setDetailsOpen((o) => !o)}
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? 'Hide details' : 'Show details'}
        <span className={`lwc__toggle-ic ${detailsOpen ? 'lwc__toggle-ic--up' : ''}`}>
          <IconChevron up={detailsOpen} />
        </span>
      </button>

      {detailsOpen && (
        <div className="lwc__more">
          {row.reason && (
            <p className="lwc__line">
              <span className="lwc__k">Reason</span> {row.reason}
            </p>
          )}
          <p className="lwc__line">
            <span className="lwc__k">Submitted</span> {fmtDMY(row.created_at)}
          </p>
          {row.actual_return_date && (
            <p className="lwc__line">
              <span className="lwc__k">Return</span> {fmtDMY(row.actual_return_date)}
            </p>
          )}
          {row.admin_remarks && (
            <p className="lwc__line">
              <span className="lwc__k">Admin</span> {row.admin_remarks}
            </p>
          )}
          {row.overstay_days > 0 && (
            <p className="lwc__line lwc__line--warn">Overstay: {row.overstay_days} day{row.overstay_days !== 1 ? 's' : ''}</p>
          )}
          {row.detected_return_date && !row.actual_return_date && (
            <p className="lwc__line">Attendance seen from {fmtDMY(row.detected_return_date)}</p>
          )}
          {row.shop_visit_note && (
            <p className="lwc__line">
              <span className="lwc__k">Your note (shop)</span> {row.shop_visit_note}
            </p>
          )}
          {row.leave_request_pdf_generated_at && (
            <p className="lwc__line">
              <span className="lwc__k">Saved letter</span> {fmtDMY(row.leave_request_pdf_generated_at)}
            </p>
          )}

          <div className="lwc__tl">
            <LeaveTimeline row={row} />
          </div>

          <div className="lwc__letters">
            <span className="lwc__k">Leave letter</span>
            <LeaveLetterActions
              row={row}
              isAdmin={isAdmin}
              letterBusy={letterBusy}
              onPreview={onPreviewLeaveLetter}
              onDownload={onDownloadLeaveLetter}
              onRegenerate={onRegenerateLeaveLetter}
            />
          </div>
        </div>
      )}
    </div>
  )
}

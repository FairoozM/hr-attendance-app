import { fmtDMY } from '../../utils/dateFormat'
import { leaveStatusDisplay } from './annualLeaveLabels'
import { LeaveWorkflowSteppers } from './LeaveWorkflowSteppers'
import { LeaveTimeline } from './LeaveTimeline'
import { LeaveLetterActions } from './LeaveLetterActions'
import { ShopVisitCard } from './ShopVisitCard'
import { LeaveSalarySnapshotCard } from './LeaveSalarySnapshotCard'
import './AnnualLeaveDetailsPanel.css'

function StopPropagation({ children, className }) {
  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

/**
 * Expanded row: steppers, leave details, main shop, salary. No bottom-of-page forms.
 */
export function AnnualLeaveDetailsPanel({
  row,
  isAdmin,
  isEmployee,
  letterBusyId,
  onPreviewLeaveLetter,
  onDownloadLeaveLetter,
  onRegenerateLeaveLetter,
  onShopConfirmOpen,
  onShopRescheduleOpen,
  onShopApplyOpen,
  onShopMarkCompleteOpen,
  onShopSaveAdminNote,
  onOpenEmployeeShop,
  onPushAnnualLeaveToPayments,
}) {
  const es = row.effective_status || row.status
  const letterBusy = letterBusyId === row.id

  return (
    <div className="al-details al-details--grid">
      <div className="al-details__steppers">
        <LeaveWorkflowSteppers row={row} />
      </div>

      <div className="al-details__cards">
        <section className="al-detail-card" aria-label="Leave details">
          <h4 className="al-detail-card__h">Leave details</h4>
          <div className="al-detail__meta al-detail__meta--card">
            <div>
              <span>Stage</span>
              <span>{leaveStatusDisplay(es)}</span>
            </div>
            <div>
              <span>Reason</span>
              <span>{row.reason || '—'}</span>
            </div>
            <div>
              <span>Applied</span>
              <span>{fmtDMY(row.created_at)}</span>
            </div>
            <div>
              <span>Expected return</span>
              <span>{fmtDMY(row.expected_return_date)}</span>
            </div>
            {row.actual_return_date && (
              <div>
                <span>Actual return</span>
                <span>{fmtDMY(row.actual_return_date)}</span>
              </div>
            )}
            {row.overstay_days > 0 && (
              <div>
                <span>Overstay</span>
                <span>
                  {row.overstay_days} day{row.overstay_days !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {row.admin_remarks && (
              <div>
                <span>Admin notes</span>
                <span>{row.admin_remarks}</span>
              </div>
            )}
            {row.alternate_employee_full_name && (
              <div>
                <span>Alternate (while away)</span>
                <span>{row.alternate_employee_full_name}</span>
              </div>
            )}
            {row.leave_request_pdf_generated_at && (
              <div>
                <span>Letter PDF saved</span>
                <span>{fmtDMY(row.leave_request_pdf_generated_at)}</span>
              </div>
            )}
          </div>
          <div className="al-detail-card__tl">
            <LeaveTimeline row={row} />
          </div>
          {row.overstay_days > 0 && !row.actual_return_date && (
            <p className="al-detail-card__alert">
              Overstayed by <strong>{row.overstay_days}</strong> day{row.overstay_days !== 1 ? 's' : ''} — confirm return when
              possible.
            </p>
          )}
          {row.detected_return_date && !row.actual_return_date && (
            <p className="al-detail-card__hint">
              Attendance suggests return from <strong>{fmtDMY(row.detected_return_date)}</strong> — confirm in Actions.
            </p>
          )}
        </section>

        <section className="al-detail-card al-detail-card--shop" aria-label="Main shop visit">
          <ShopVisitCard
            row={row}
            isAdmin={isAdmin}
            isEmployee={isEmployee}
            onConfirm={onShopConfirmOpen}
            onReschedule={onShopRescheduleOpen}
            onApplyCalculatorOpen={onShopApplyOpen}
            onMarkCompleteOpen={onShopMarkCompleteOpen}
            onSaveAdminNote={onShopSaveAdminNote}
            onOpenEmployeeShop={onOpenEmployeeShop}
          />
        </section>

        <StopPropagation className="al-detail-card">
          <h4 className="al-detail-card__h al-detail-card__h--salary">Salary and payment</h4>
          <LeaveSalarySnapshotCard
            row={row}
            isAdmin={isAdmin}
            onPushToPayments={onPushAnnualLeaveToPayments}
          />
        </StopPropagation>
      </div>

      <div className="al-details__letter">
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
  )
}

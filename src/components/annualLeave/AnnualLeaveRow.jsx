import { fmtDMY } from '../../utils/dateFormat'
import { alDaysBetween, alPeriodDate } from '../../utils/annualLeaveUtils'
import { leaveStatusDisplay } from './annualLeaveLabels'
import { AnnualLeaveDetailsPanel } from './AnnualLeaveDetailsPanel'
import { IconEdit, IconTrash, IconChevron } from './annualLeaveRowIcons'
import { EmpAvatar } from './EmpAvatar'
import { StatusBadge } from './StatusBadge'

export function AnnualLeaveRow({
  row,
  isAdmin,
  isEmployee,
  canEmployeeEditPending,
  onDelete,
  onEdit,
  onApprove,
  onReject,
  onOpenNote,
  onConfirmReturn,
  onExtend,
  expanded,
  onToggle,
  onPreviewLeaveLetter,
  onDownloadLeaveLetter,
  onRegenerateLeaveLetter,
  letterBusyId,
  onShopConfirmOpen,
  onShopRescheduleOpen,
  onShopApplyOpen,
  onShopMarkCompleteOpen,
  onOpenEmployeeShop,
}) {
  const es = row.effective_status || row.status
  const leaveDays = row.leave_days ?? alDaysBetween(row.from_date, row.to_date)
  const employeeCanEditThis = canEmployeeEditPending && row.status === 'Pending'
  const showActions = isAdmin || employeeCanEditThis

  return (
    <>
      <tr className={`al-row ${expanded ? 'al-row--expanded' : ''}`} onClick={onToggle}>
        <td>
          <div className="al-row__emp">
            <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
            <div>
              <span className="al-row__name">{row.full_name}</span>
              <span className="al-row__dept">{row.department}</span>
            </div>
          </div>
        </td>
        <td>
          <div className="al-row__dates">
            <span>
              <span className="al-row__period-from">From</span> {alPeriodDate(row.from_date)}{' '}
              <span className="al-row__period-to">to</span> {alPeriodDate(row.to_date)}
            </span>
          </div>
        </td>
        <td>
          <span>{row.alternate_employee_full_name || '—'}</span>
        </td>
        <td className="al-row__days-cell">
          <span className="al-row__days-num">{leaveDays}</span>
          <span className="al-row__days-label"> days</span>
        </td>
        <td>
          <div className="al-row__status-stack" title={leaveStatusDisplay(es)}>
            <StatusBadge status={es} labelOverride={leaveStatusDisplay(es)} />
          </div>
        </td>
        <td className="al-row__ret">
          {row.actual_return_date ? (
            <span className="al-row__returned">↩ {fmtDMY(row.actual_return_date)}</span>
          ) : row.expected_return_date ? (
            <span className="al-row__expected">Exp. {fmtDMY(row.expected_return_date)}</span>
          ) : (
            '—'
          )}
        </td>
        {showActions && (
          <td onClick={(e) => e.stopPropagation()}>
            <div className="al-row__acts al-row__acts--grouped">
              {(isAdmin || employeeCanEditThis) && (
                <button className="al-icon-btn al-icon-btn--edit" title="Edit" onClick={() => onEdit(row)} type="button">
                  <IconEdit />
                </button>
              )}
              {(isAdmin || employeeCanEditThis) && (row.status === 'Pending' || isAdmin) && (
                <button
                  className="al-icon-btn al-icon-btn--del al-row__act--dest"
                  title="Delete"
                  onClick={() => onDelete(row.id)}
                  type="button"
                >
                  <IconTrash />
                </button>
              )}
            </div>
          </td>
        )}
        <td className="al-row__chevron" aria-hidden>
          <IconChevron up={expanded} />
        </td>
      </tr>
      {expanded && (
        <tr className="al-row-detail">
          <td colSpan={showActions ? 8 : 7}>
            <div className="al-detail" onClick={(e) => e.stopPropagation()}>
              <AnnualLeaveDetailsPanel
                row={row}
                isAdmin={isAdmin}
                isEmployee={isEmployee}
                letterBusyId={letterBusyId}
                onPreviewLeaveLetter={onPreviewLeaveLetter}
                onDownloadLeaveLetter={onDownloadLeaveLetter}
                onRegenerateLeaveLetter={onRegenerateLeaveLetter}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
                onOpenEmployeeShop={onOpenEmployeeShop}
                onShopConfirmOpen={onShopConfirmOpen}
                onShopRescheduleOpen={onShopRescheduleOpen}
                onApplySalaryOpen={onShopApplyOpen}
                onShopMarkCompleteOpen={onShopMarkCompleteOpen}
                onConfirmReturn={onConfirmReturn}
                onExtend={onExtend}
                onOpenNote={onOpenNote}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

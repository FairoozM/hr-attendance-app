import { useState } from 'react'
import { IconChevron } from './annualLeaveRowIcons'
import { AnnualLeaveTableHead } from './AnnualLeaveTableHead'
import { AnnualLeaveRow } from './AnnualLeaveRow'
import { AnnualLeaveEditRowForm } from './AnnualLeaveEditRowForm'
import { ANNUAL_LEAVE_SECTIONS, sectionHeadDot } from './annualLeaveSectionConfig'

function sectionLabel(key) {
  return ANNUAL_LEAVE_SECTIONS.find((s) => s.key === key)?.label || key
}

export function AnnualLeaveSectionGroup({
  sectionKey,
  rows,
  isAdmin,
  isEmployee,
  canEmployeeEditPending,
  showActionsColumn,
  sortBy,
  sortDir,
  onSort,
  expandedId,
  onToggle,
  editingRow,
  setEditingRow,
  employees,
  alternateCandidates,
  empLoading,
  updateRequest,
  onConfirmReturn,
  onExtend,
  onDelete,
  onEditStart,
  onApprove,
  onReject,
  onOpenNote,
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
  const [collapsed, setCollapsed] = useState(false)
  const color = sectionHeadDot(sectionKey)

  if (rows.length === 0) return null

  return (
    <div className="al-section">
      <div
        className="al-section__head"
        onClick={() => setCollapsed((c) => !c)}
        style={{ borderLeftColor: color }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed((c) => !c)
          }
        }}
        aria-expanded={!collapsed}
      >
        <span className="al-section__dot" style={{ background: color }} />
        <span className="al-section__title">{sectionLabel(sectionKey)}</span>
        <span className="al-section__count">{rows.length}</span>
        <span className="al-section__chevron">
          <IconChevron up={!collapsed} />
        </span>
      </div>
      {!collapsed && (
        <div className="al-table-wrap al-table-wrap--section">
          <table className="al-table">
            <AnnualLeaveTableHead
              showActions={showActionsColumn}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <tbody>
              {rows.map((row) =>
                editingRow?.id === row.id ? (
                  <AnnualLeaveEditRowForm
                    key={row.id}
                    row={editingRow}
                    employees={employees}
                    alternateCandidates={alternateCandidates}
                    onSave={updateRequest}
                    onCancel={() => setEditingRow(null)}
                    empLoading={empLoading}
                    isAdmin={isAdmin}
                  />
                ) : (
                  <AnnualLeaveRow
                    key={row.id}
                    row={row}
                    isAdmin={isAdmin}
                    isEmployee={isEmployee}
                    canEmployeeEditPending={!!canEmployeeEditPending}
                    onConfirmReturn={onConfirmReturn}
                    onExtend={onExtend}
                    onDelete={onDelete}
                    onEdit={onEditStart}
                    onApprove={onApprove}
                    onReject={onReject}
                    onOpenNote={onOpenNote}
                    expanded={expandedId === row.id}
                    onToggle={() => onToggle(row.id)}
                    onPreviewLeaveLetter={onPreviewLeaveLetter}
                    onDownloadLeaveLetter={onDownloadLeaveLetter}
                    onRegenerateLeaveLetter={onRegenerateLeaveLetter}
                    letterBusyId={letterBusyId}
                    onShopConfirmOpen={onShopConfirmOpen}
                    onShopRescheduleOpen={onShopRescheduleOpen}
                    onShopApplyOpen={onShopApplyOpen}
                    onShopMarkCompleteOpen={onShopMarkCompleteOpen}
                    onOpenEmployeeShop={onOpenEmployeeShop}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

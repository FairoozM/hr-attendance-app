import { useState, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import { useAnnualLeave } from '../hooks/useAnnualLeave'
import { AnnualLeaveSalaryPage } from './AnnualLeaveSalaryPage'
import { fmtISO } from '../utils/dateFormat'
import { alDaysBetween } from '../utils/annualLeaveUtils'
import { openAnnualLeaveLetterPreview, downloadAnnualLeaveLetterPdf } from '../api/annualLeaveDocuments'
import {
  EmployeeShopVisitModal,
  ShopVisitRescheduleModal,
  ShopVisitConfirmModal,
  ShopMarkCompleteModal,
  shopVisitFilterMatch,
} from '../components/annualLeave/ShopVisitWorkflow'
import { ApplySalaryModal } from '../components/annualLeave/ApplySalaryModal'
import { AdminShopNoteModal } from '../components/annualLeave/AdminShopNoteModal'
import { LeavePendingDecisionModal } from '../components/annualLeave/LeavePendingDecisionModal'
import { AnnualLeaveHeader } from '../components/annualLeave/AnnualLeaveHeader'
import { AnnualLeaveStats } from '../components/annualLeave/AnnualLeaveStats'
import { AnnualLeaveFilters } from '../components/annualLeave/AnnualLeaveFilters'
import { AnnualLeaveNewRequestForm } from '../components/annualLeave/AnnualLeaveNewRequestForm'
import { AnnualLeaveSectionGroup } from '../components/annualLeave/AnnualLeaveSectionGroup'
import { AnnualLeaveTableHead } from '../components/annualLeave/AnnualLeaveTableHead'
import { AnnualLeaveRow } from '../components/annualLeave/AnnualLeaveRow'
import { AnnualLeaveEditRowForm } from '../components/annualLeave/AnnualLeaveEditRowForm'
import { ReturnFromLeaveModal } from '../components/annualLeave/ReturnFromLeaveModal'
import { ExtendLeaveModal } from '../components/annualLeave/ExtendLeaveModal'
import { ANNUAL_LEAVE_SECTIONS } from '../components/annualLeave/annualLeaveSectionConfig'
import { AnnualLeaveCeoView } from '../components/annualLeave/AnnualLeaveCeoView'
import './Page.css'
import './AnnualLeavePage.css'

const PAGE_SIZE = 25

/** Return recorded — effective_status is Completed even when DB status stays Approved. */
function isLeaveEffectivelyCompleted(row) {
  const es = row.effective_status || row.status
  return Boolean(row.actual_return_date) || es === 'Completed' || row.status === 'Completed'
}

function hasOpenShopOrSalaryWork(row, { isAdmin = true } = {}) {
  if (isLeaveEffectivelyCompleted(row)) return false
  if (row.status !== 'Approved') return false
  const sv = row.shop_visit_status || 'PendingSubmission'
  if (!isAdmin && sv === 'PendingSubmission') return true
  if (!isAdmin) return false
  if (sv === 'PendingSubmission') return false
  if (['Submitted', 'Confirmed', 'MoneyCalculated'].includes(sv)) return true
  return sv !== 'Completed' && sv !== 'Cancelled'
}

function isNeedsAction(row, opts = {}) {
  if (isLeaveEffectivelyCompleted(row)) return false
  const es = row.effective_status || row.status
  return (
    row.status === 'Pending' ||
    es === 'ReturnPending' ||
    es === 'Overstayed' ||
    hasOpenShopOrSalaryWork(row, opts)
  )
}

function queueMatches(row, filterStatus, opts = {}) {
  if (filterStatus === 'queue:needsAction') return isNeedsAction(row, opts)
  if (filterStatus === 'queue:shopSalary') return hasOpenShopOrSalaryWork(row, opts)
  return (row.effective_status || row.status) === filterStatus
}

function groupKeyForRow(row, opts = {}) {
  const es = row.effective_status || row.status
  if (isLeaveEffectivelyCompleted(row)) return 'Completed'
  if (isNeedsAction(row, opts)) return 'NeedsAction'
  if (es === 'Ongoing' || es === 'ReturnPending' || es === 'Overstayed') return 'Ongoing'
  if (es === 'Approved') return 'Approved'
  if (es === 'Completed') return 'Completed'
  if (es === 'Rejected') return 'Rejected'
  return es
}

export function AnnualLeavePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isEmployee = user?.role === 'employee'
  const canEmployeeEditPending = isEmployee
  const showActionsColumn = isAdmin || canEmployeeEditPending
  const loggedInEmpId = user?.employeeId ? String(user.employeeId) : null

  const { employees, loading: empLoading } = useEmployees()
  const {
    requests,
    loading,
    error,
    dashboard,
    alternateOptions,
    createRequest,
    updateRequest,
    deleteRequest,
    confirmReturn,
    extendLeave,
    regenerateLeaveLetter,
    submitShopVisit,
    confirmShopVisit,
    rescheduleShopVisit,
    completeShopVisit,
    applyShopVisitCalculator,
    patchShopVisitAdminNote,
  } = useAnnualLeave()

  const [activeTab, setActiveTab] = useState('requests')
  const [filterStatus, setFilterStatus] = useState('All')
  const [shopVisitFilter, setShopVisitFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editingRow, setEditingRow] = useState(null)
  const [confirmRow, setConfirmRow] = useState(null)
  const [extendRow, setExtendRow] = useState(null)
  const [shopConfirmRow, setShopConfirmRow] = useState(null)
  const [shopRescheduleRow, setShopRescheduleRow] = useState(null)
  const [shopApplyRow, setShopApplyRow] = useState(null)
  const [shopCompleteRow, setShopCompleteRow] = useState(null)
  const [employeeShopRow, setEmployeeShopRow] = useState(null)
  const [decisionModal, setDecisionModal] = useState(null)
  const [adminNoteRow, setAdminNoteRow] = useState(null)
  const [markCompleteSubmitting, setMarkCompleteSubmitting] = useState(false)
  const [markCompleteErr, setMarkCompleteErr] = useState('')
  const [sortBy, setSortBy] = useState('from_date')
  const [sortDir, setSortDir] = useState('desc')
  const [letterBusyId, setLetterBusyId] = useState(null)
  const [shopToast, setShopToast] = useState(null)
  const [requestFormOpen, setRequestFormOpen] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)

  const showToast = useCallback((t, type = 'success') => {
    setShopToast({ type, text: t })
    setTimeout(() => setShopToast(null), 5000)
  }, [])

  const handlePreviewLeaveLetter = useCallback(async (id) => {
    try {
      await openAnnualLeaveLetterPreview(id)
    } catch (e) {
      showToast(e.message || 'Could not open the document.', 'error')
    }
  }, [showToast])

  const handleDownloadLeaveLetter = useCallback(async (id) => {
    try {
      await downloadAnnualLeaveLetterPdf(id)
    } catch (e) {
      showToast(e.message || 'Download failed.', 'error')
    }
  }, [showToast])

  const handleRegenerateLeaveLetter = useCallback(
    async (id) => {
      if (!window.confirm('Regenerate the leave request PDF from current employee and leave data?')) return
      setLetterBusyId(id)
      try {
        await regenerateLeaveLetter(id)
        showToast('Leave request PDF regenerated.', 'success')
      } catch (e) {
        showToast(e.message || 'Regeneration failed.', 'error')
      } finally {
        setLetterBusyId(null)
      }
    },
    [regenerateLeaveLetter, showToast]
  )

  const handleSort = useCallback((col) => {
    setSortBy((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return col
      }
      setSortDir('asc')
      return col
    })
  }, [])

  const departments = useMemo(() => {
    const s = new Set(requests.map((r) => r.department).filter(Boolean))
    return Array.from(s).sort()
  }, [requests])

  const visibleRequests = useMemo(() => {
    if (!isEmployee || !loggedInEmpId) return requests
    return requests.filter((r) => String(r.employee_id) === loggedInEmpId)
  }, [requests, isEmployee, loggedInEmpId])

  const baseFiltered = useMemo(() => {
    let list = visibleRequests
    if (deptFilter) list = list.filter((r) => r.department === deptFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          (r.full_name || '').toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q) ||
          (r.employee_code || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let va
      let vb
      switch (sortBy) {
        case 'name':
          va = a.full_name || ''
          vb = b.full_name || ''
          break
        case 'dept':
          va = a.department || ''
          vb = b.department || ''
          break
        case 'from_date':
          va = a.from_date || ''
          vb = b.from_date || ''
          break
        case 'days':
          va = a.leave_days || alDaysBetween(a.from_date, a.to_date)
          vb = b.leave_days || alDaysBetween(b.from_date, b.to_date)
          break
        case 'alternate':
          va = a.alternate_employee_full_name || ''
          vb = b.alternate_employee_full_name || ''
          break
        case 'status':
          va = a.effective_status || a.status
          vb = b.effective_status || b.status
          break
        case 'return_date':
          va = a.expected_return_date || ''
          vb = b.expected_return_date || ''
          break
        case 'updated_at':
          va = a.updated_at || ''
          vb = b.updated_at || ''
          break
        default:
          return 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [visibleRequests, deptFilter, search, sortBy, sortDir])

  const listForDisplay = useMemo(() => {
    if (!isAdmin || shopVisitFilter === 'All') return baseFiltered
    return baseFiltered.filter((r) => shopVisitFilterMatch(r, shopVisitFilter))
  }, [isAdmin, shopVisitFilter, baseFiltered])

  const filteredRequests = useMemo(() => {
    if (filterStatus === 'All') return listForDisplay
    return listForDisplay.filter((r) => queueMatches(r, filterStatus, { isAdmin }))
  }, [listForDisplay, filterStatus, isAdmin])

  const tabCounts = useMemo(() => {
    const counts = { All: 0 }
    listForDisplay.forEach((r) => {
      const es = r.effective_status || r.status
      counts[es] = (counts[es] || 0) + 1
      if (isNeedsAction(r, { isAdmin })) counts['queue:needsAction'] = (counts['queue:needsAction'] || 0) + 1
      if (hasOpenShopOrSalaryWork(r, { isAdmin })) counts['queue:shopSalary'] = (counts['queue:shopSalary'] || 0) + 1
    })
    counts.All = listForDisplay.length
    return counts
  }, [listForDisplay, isAdmin])

  const derivedStats = useMemo(() => ({
    needs_action: listForDisplay.filter((r) => isNeedsAction(r, { isAdmin })).length,
    shop_salary_pending: listForDisplay.filter((r) => hasOpenShopOrSalaryWork(r, { isAdmin })).length,
  }), [listForDisplay, isAdmin])

  const groupedRequests = useMemo(() => {
    const groups = {}
    filteredRequests.forEach((row) => {
      const key = groupKeyForRow(row, { isAdmin })
      groups[key] = groups[key] || []
      groups[key].push(row)
    })
    return groups
  }, [filteredRequests, isAdmin])

  const pagedRequests = useMemo(
    () => filteredRequests.slice(0, visibleLimit),
    [filteredRequests, visibleLimit]
  )

  const remainingFlatRows = Math.max(0, filteredRequests.length - pagedRequests.length)

  const toggleExpand = useCallback((id) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setEditingRow(null)
  }, [])

  const handleSetFilterStatus = useCallback((key) => {
    setFilterStatus(key)
    setVisibleLimit(PAGE_SIZE)
    setExpandedId(null)
  }, [])

  const onDelete = useCallback(
    async (id) => {
      if (!window.confirm('Delete this leave request?')) return
      try {
        await deleteRequest(id)
        showToast('Leave request deleted.', 'success')
      } catch (e) {
        showToast(e.message || 'Delete failed', 'error')
      }
    },
    [deleteRequest, showToast]
  )

  const onEditStart = useCallback((r) => {
    setEditingRow(r)
    setExpandedId(null)
  }, [])

  const handleEmployeeShopSubmit = useCallback(
    async (id, payload) => {
      await submitShopVisit(id, payload)
      showToast('Main shop visit saved.', 'success')
    },
    [submitShopVisit, showToast]
  )

  const handleOpenApplyCalc = useCallback((row) => {
    setShopApplyRow(row)
  }, [])

  const applyCalculatorToRequest = useCallback(
    async (id) => {
      await applyShopVisitCalculator(id)
      showToast('Salary applied to this handover.', 'success')
    },
    [applyShopVisitCalculator, showToast]
  )

  const handleDecision = useCallback(
    async (row, nextStatus) => {
      if (nextStatus === row.status) return
      try {
        await updateRequest(row.id, {
          employee_id: row.employee_id,
          alternate_employee_id: row.alternate_employee_id,
          from_date: fmtISO(row.from_date),
          to_date: fmtISO(row.to_date),
          reason: row.reason,
          status: nextStatus,
        })
        showToast(nextStatus === 'Approved' ? 'Request approved.' : 'Request rejected.', 'success')
      } catch (e) {
        showToast(e.message || 'Update failed', 'error')
        throw e
      }
    },
    [updateRequest, showToast]
  )

  const handleOpenMarkComplete = useCallback((row) => {
    setMarkCompleteErr('')
    setShopCompleteRow(row)
  }, [])

  const handleMarkCompleteSubmit = useCallback(
    async (id) => {
      setMarkCompleteErr('')
      setMarkCompleteSubmitting(true)
      try {
        await completeShopVisit(id)
        setShopCompleteRow(null)
        showToast('Shop visit marked completed.', 'success')
      } catch (e) {
        setMarkCompleteErr(e?.message || 'Failed')
        showToast(e?.message || 'Failed', 'error')
      } finally {
        setMarkCompleteSubmitting(false)
      }
    },
    [completeShopVisit, showToast]
  )

  const handleShopSaveAdminNote = useCallback(
    async (id, payload) => {
      await patchShopVisitAdminNote(id, payload)
      showToast('Internal handover note saved.', 'success')
    },
    [patchShopVisitAdminNote, showToast]
  )

  const tableRowProps = {
    isAdmin,
    isEmployee,
    canEmployeeEditPending,
    onConfirmReturn: (r) => setConfirmRow(r),
    onExtend: (r) => setExtendRow(r),
    onDelete,
    onEdit: onEditStart,
    onApprove: (r) => setDecisionModal({ row: r, type: 'approve' }),
    onReject: (r) => setDecisionModal({ row: r, type: 'reject' }),
    onOpenNote: (r) => setAdminNoteRow(r),
    onPreviewLeaveLetter: handlePreviewLeaveLetter,
    onDownloadLeaveLetter: handleDownloadLeaveLetter,
    onRegenerateLeaveLetter: handleRegenerateLeaveLetter,
    letterBusyId,
    onShopConfirmOpen: (r) => setShopConfirmRow(r),
    onShopRescheduleOpen: (r) => setShopRescheduleRow(r),
    onShopApplyOpen: handleOpenApplyCalc,
    onShopMarkCompleteOpen: handleOpenMarkComplete,
    onOpenEmployeeShop: (r) => setEmployeeShopRow(r),
  }

  const sectionProps = {
    ...tableRowProps,
    canEmployeeEditPending,
    showActionsColumn,
    sortBy,
    sortDir,
    onSort: handleSort,
    expandedId,
    onToggle: toggleExpand,
    editingRow,
    setEditingRow,
    employees,
    alternateCandidates: alternateOptions,
    empLoading,
    updateRequest,
  }

  return (
    <div className="page al-page">
      <AnnualLeaveHeader
        isAdmin={isAdmin}
        requestFormOpen={requestFormOpen}
        onNewRequest={() => setRequestFormOpen((o) => !o)}
      />

      <div className="al-tabs">
        <button
          type="button"
          className={`al-tab ${activeTab === 'requests' ? 'al-tab--active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Leave management
        </button>
        {isAdmin && (
          <button
            type="button"
            className={`al-tab ${activeTab === 'ceo' ? 'al-tab--active' : ''}`}
            onClick={() => setActiveTab('ceo')}
          >
            CEO view
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className={`al-tab ${activeTab === 'salary' ? 'al-tab--active' : ''}`}
            onClick={() => setActiveTab('salary')}
          >
            Leave salary calculator
          </button>
        )}
      </div>

      {activeTab === 'salary' && isAdmin && <AnnualLeaveSalaryPage embedded employees={employees} />}

      {activeTab === 'ceo' && isAdmin && (
        <>
          {error && <p className="page-error">{error}</p>}
          <AnnualLeaveFilters
            tabCounts={tabCounts}
            filterStatus={filterStatus}
            setFilterStatus={handleSetFilterStatus}
            search={search}
            setSearch={setSearch}
            deptFilter={deptFilter}
            setDeptFilter={setDeptFilter}
            departments={departments}
            isAdmin={isAdmin}
            shopVisitFilter={shopVisitFilter}
            setShopVisitFilter={setShopVisitFilter}
          />
          <AnnualLeaveCeoView rows={filteredRequests} allRequests={requests} loading={loading} />
        </>
      )}

      {activeTab === 'requests' && (
        <>
          {error && <p className="page-error">{error}</p>}

          <AnnualLeaveStats
            stats={dashboard}
            derivedStats={derivedStats}
            activeKey={filterStatus}
            isAdmin={isAdmin}
            onFilterClick={(key) => {
              handleSetFilterStatus(key)
              setSearch('')
              setShopVisitFilter('All')
            }}
          />

          <AnnualLeaveNewRequestForm
            employees={employees}
            alternateCandidates={alternateOptions}
            isAdmin={isAdmin}
            loggedInEmployeeId={loggedInEmpId}
            onSubmit={createRequest}
            empLoading={empLoading}
            open={requestFormOpen}
            setOpen={setRequestFormOpen}
          />

          {shopToast && (
            <div className={`al-toast al-toast--${shopToast.type}`} role="status">
              {shopToast.text}
            </div>
          )}

          <AnnualLeaveFilters
            tabCounts={tabCounts}
            filterStatus={filterStatus}
            setFilterStatus={handleSetFilterStatus}
            search={search}
            setSearch={setSearch}
            deptFilter={deptFilter}
            setDeptFilter={setDeptFilter}
            departments={departments}
            isAdmin={isAdmin}
            shopVisitFilter={shopVisitFilter}
            setShopVisitFilter={setShopVisitFilter}
          />

          {loading && <p className="page-loading">Loading…</p>}

          {!loading && filterStatus === 'All' && (
            <>
              {filteredRequests.length === 0 ? (
                <div className="al-empty-state">
                  <div className="al-empty-state__icon al-empty-state__icon--calm" />
                  <p>No leave requests match the current filters.</p>
                </div>
              ) : (
                ANNUAL_LEAVE_SECTIONS.map((sec) => (
                  <AnnualLeaveSectionGroup
                    key={sec.key}
                    sectionKey={sec.key}
                    rows={groupedRequests[sec.key] || []}
                    {...sectionProps}
                  />
                ))
              )}
            </>
          )}

          {!loading && filterStatus !== 'All' && (
            <>
              {filteredRequests.length === 0 ? (
                <div className="al-empty-state">
                  <div className="al-empty-state__icon al-empty-state__icon--calm" />
                  <p>No leave requests for this filter.</p>
                </div>
              ) : (
                <div className="al-table-wrap">
                  <table className="al-table">
                    <AnnualLeaveTableHead
                      showActions={showActionsColumn}
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <tbody>
                      {pagedRequests.map((row) =>
                        editingRow?.id === row.id ? (
                          <AnnualLeaveEditRowForm
                            key={row.id}
                            row={editingRow}
                            employees={employees}
                            alternateCandidates={alternateOptions}
                            onSave={updateRequest}
                            onCancel={() => setEditingRow(null)}
                            empLoading={empLoading}
                            isAdmin={isAdmin}
                          />
                        ) : (
                          <AnnualLeaveRow
                            key={row.id}
                            row={row}
                            {...tableRowProps}
                            expanded={expandedId === row.id}
                            onToggle={() => toggleExpand(row.id)}
                            onEdit={(r) => {
                              setEditingRow(r)
                              setExpandedId(null)
                            }}
                          />
                        )
                      )}
                    </tbody>
                  </table>
                  {remainingFlatRows > 0 && (
                    <div className="al-section__more">
                      <button
                        type="button"
                        className="al-btn al-btn--ghost"
                        onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                      >
                        Show {Math.min(PAGE_SIZE, remainingFlatRows)} more
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {confirmRow && (
        <ReturnFromLeaveModal
          row={confirmRow}
          onConfirm={confirmReturn}
          onClose={() => setConfirmRow(null)}
        />
      )}
      {extendRow && <ExtendLeaveModal row={extendRow} onExtend={extendLeave} onClose={() => setExtendRow(null)} />}
      {shopConfirmRow && (
        <ShopVisitConfirmModal
          row={shopConfirmRow}
          onSave={confirmShopVisit}
          onClose={() => setShopConfirmRow(null)}
        />
      )}
      {shopRescheduleRow && (
        <ShopVisitRescheduleModal
          row={shopRescheduleRow}
          onSave={rescheduleShopVisit}
          onClose={() => setShopRescheduleRow(null)}
        />
      )}
      {shopApplyRow && (
        <ApplySalaryModal
          row={shopApplyRow}
          onClose={() => setShopApplyRow(null)}
          onApply={applyCalculatorToRequest}
        />
      )}
      {decisionModal && (
        <LeavePendingDecisionModal
          row={decisionModal.row}
          type={decisionModal.type}
          onClose={() => setDecisionModal(null)}
          onConfirm={handleDecision}
        />
      )}
      {adminNoteRow && (
        <AdminShopNoteModal
          row={adminNoteRow}
          onClose={() => setAdminNoteRow(null)}
          onSave={handleShopSaveAdminNote}
        />
      )}
      {shopCompleteRow && (
        <ShopMarkCompleteModal
          row={shopCompleteRow}
          onComplete={handleMarkCompleteSubmit}
          onClose={() => {
            setShopCompleteRow(null)
            setMarkCompleteErr('')
          }}
          completing={markCompleteSubmitting}
          err={markCompleteErr}
        />
      )}
      {employeeShopRow && (
        <EmployeeShopVisitModal
          row={employeeShopRow}
          open
          onClose={() => setEmployeeShopRow(null)}
          onSubmit={handleEmployeeShopSubmit}
        />
      )}
    </div>
  )
}

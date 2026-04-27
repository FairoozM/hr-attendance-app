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
import './Page.css'
import './AnnualLeavePage.css'

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

  const handlePreviewLeaveLetter = useCallback(async (id) => {
    try {
      await openAnnualLeaveLetterPreview(id)
    } catch (e) {
      window.alert(e.message || 'Could not open the document.')
    }
  }, [])

  const handleDownloadLeaveLetter = useCallback(async (id) => {
    try {
      await downloadAnnualLeaveLetterPdf(id)
    } catch (e) {
      window.alert(e.message || 'Download failed.')
    }
  }, [])

  const handleRegenerateLeaveLetter = useCallback(
    async (id) => {
      if (!window.confirm('Regenerate the leave request PDF from current employee and leave data?')) return
      setLetterBusyId(id)
      try {
        await regenerateLeaveLetter(id)
      } catch (e) {
        window.alert(e.message || 'Regeneration failed.')
      } finally {
        setLetterBusyId(null)
      }
    },
    [regenerateLeaveLetter]
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
    return listForDisplay.filter((r) => (r.effective_status || r.status) === filterStatus)
  }, [listForDisplay, filterStatus])

  const tabCounts = useMemo(() => {
    const counts = { All: 0 }
    listForDisplay.forEach((r) => {
      const es = r.effective_status || r.status
      counts[es] = (counts[es] || 0) + 1
    })
    counts.All = listForDisplay.length
    return counts
  }, [listForDisplay])

  const toggleExpand = useCallback((id) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setEditingRow(null)
  }, [])

  const onDelete = useCallback(
    async (id) => {
      if (!window.confirm('Delete this leave request?')) return
      try {
        await deleteRequest(id)
      } catch (e) {
        window.alert(e.message || 'Delete failed')
      }
    },
    [deleteRequest]
  )

  const onEditStart = useCallback((r) => {
    setEditingRow(r)
    setExpandedId(null)
  }, [])

  const showToast = useCallback((t, type = 'success') => {
    setShopToast({ type, text: t })
    setTimeout(() => setShopToast(null), 5000)
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
        window.alert(e.message || 'Update failed')
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
    },
    [patchShopVisitAdminNote]
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
      <AnnualLeaveHeader />

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
            className={`al-tab ${activeTab === 'salary' ? 'al-tab--active' : ''}`}
            onClick={() => setActiveTab('salary')}
          >
            Leave salary calculator
          </button>
        )}
      </div>

      {activeTab === 'salary' && isAdmin && <AnnualLeaveSalaryPage embedded employees={employees} />}

      {activeTab === 'requests' && (
        <>
          {error && <p className="page-error">{error}</p>}

          <AnnualLeaveStats
            stats={dashboard}
            isAdmin={isAdmin}
            onFilterClick={(key) => {
              setFilterStatus(key)
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
          />

          {shopToast && (
            <div className={`al-toast al-toast--${shopToast.type}`} role="status">
              {shopToast.text}
            </div>
          )}

          <AnnualLeaveFilters
            tabCounts={tabCounts}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
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
                    rows={filteredRequests.filter((r) => (r.effective_status || r.status) === sec.key)}
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
                      {filteredRequests.map((row) =>
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

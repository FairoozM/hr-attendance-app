import { useState, useMemo, useEffect, useCallback } from 'react'
import { Modal } from './Modal'
import { EmployeeForm } from './EmployeeForm'
import { useSettings } from '../contexts/SettingsContext'
import { DEFAULT_DEPARTMENTS } from '../constants/employees'
import { EmployeeSummaryCards } from './employees/EmployeeSummaryCards'
import { EmployeesToolbar } from './employees/EmployeesToolbar'
import { EmployeesDataTable } from './employees/EmployeesDataTable'
import {
  displayOrDash,
  formatJoiningDate,
  employmentStatusLabel,
  effectiveJoiningDate,
} from './employees/employeeUtils'
import './EmployeeList.css'

const PAGE_SIZE = 10

function compareRows(a, b, sortKey, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1
  let va
  let vb
  switch (sortKey) {
    case 'name':
      va = (a.name || '').toLowerCase()
      vb = (b.name || '').toLowerCase()
      break
    case 'department':
      va = (a.department || '').toLowerCase()
      vb = (b.department || '').toLowerCase()
      break
    case 'joiningDate':
      va = effectiveJoiningDate(a) ? new Date(effectiveJoiningDate(a)).getTime() : 0
      vb = effectiveJoiningDate(b) ? new Date(effectiveJoiningDate(b)).getTime() : 0
      break
    case 'employmentStatus':
      va = a.employmentStatus || ''
      vb = b.employmentStatus || ''
      break
    default:
      return 0
  }
  if (va < vb) return -1 * mul
  if (va > vb) return 1 * mul
  return 0
}

function EmployeeViewModal({ employee, open, onClose }) {
  if (!open || !employee) return null
  return (
    <Modal title="Employee details" open={open} onClose={onClose} panelClassName="modal-panel--wide">
      <dl className="employee-view-dl">
        <dt>Full name</dt>
        <dd>{displayOrDash(employee.name)}</dd>
        <dt>Employee ID</dt>
        <dd className="employee-view-dl__mono">{displayOrDash(employee.employeeId)}</dd>
        <dt>Department</dt>
        <dd>{displayOrDash(employee.department)}</dd>
        <dt>Designation</dt>
        <dd>{displayOrDash(employee.designation)}</dd>
        <dt>Contact number</dt>
        <dd>{displayOrDash(employee.phone)}</dd>
        <dt>Email</dt>
        <dd>{displayOrDash(employee.email)}</dd>
        <dt>Joining date</dt>
        <dd>{formatJoiningDate(effectiveJoiningDate(employee)) || '—'}</dd>
        <dt>Passport number</dt>
        <dd>{displayOrDash(employee.passportNumber)}</dd>
        <dt>Emirates ID</dt>
        <dd>{displayOrDash(employee.emiratesId)}</dd>
        <dt>Status</dt>
        <dd>
          <span className="employee-view-dl__status">{employmentStatusLabel(employee.employmentStatus)}</span>
        </dd>
      </dl>
      <div className="employee-view-actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

export function EmployeeList({ employees, onAdd, onEdit, onDelete }) {
  const { departments: settingsDepartments } = useSettings()
  const baseDepartments =
    settingsDepartments?.length > 0 ? settingsDepartments : DEFAULT_DEPARTMENTS

  const [modalMode, setModalMode] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [viewEmployee, setViewEmployee] = useState(null)

  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [designation, setDesignation] = useState('all')
  const [status, setStatus] = useState('all')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)

  const editingEmployee = useMemo(
    () => employees.find((e) => e.id === editingId) ?? null,
    [employees, editingId]
  )

  const departmentOptions = useMemo(() => {
    const set = new Set(baseDepartments)
    employees.forEach((e) => {
      if (e.department) set.add(e.department)
    })
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b))
    return [{ value: 'all', label: 'All departments' }, ...sorted.map((d) => ({ value: d, label: d }))]
  }, [employees, baseDepartments])

  const designationOptions = useMemo(() => {
    const set = new Set()
    employees.forEach((e) => {
      if (e.designation && String(e.designation).trim()) set.add(e.designation.trim())
    })
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b))
    return [
      { value: 'all', label: 'All designations' },
      ...sorted.map((d) => ({ value: d, label: d })),
    ]
  }, [employees])

  const stats = useMemo(() => {
    const total = employees.length
    const activeCount = employees.filter((e) => e.employmentStatus === 'active').length
    const inactiveCount = employees.filter((e) => e.employmentStatus === 'inactive').length
    const onLeaveCount = employees.filter((e) => e.employmentStatus === 'on_leave').length
    return { total, activeCount, inactiveCount, onLeaveCount }
  }, [employees])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((emp) => {
      if (department !== 'all' && emp.department !== department) return false
      if (designation !== 'all' && (emp.designation || '') !== designation) return false
      if (status !== 'all' && emp.employmentStatus !== status) return false
      if (!q) return true
      const blob = [emp.name, emp.employeeId, emp.phone, emp.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [employees, search, department, designation, status])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => compareRows(a, b, sortKey, sortDir))
    return copy
  }, [filtered, sortKey, sortDir])

  const totalFiltered = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE) || 1)

  useEffect(() => {
    setPage(1)
  }, [search, department, designation, status])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return sorted.slice(start, start + PAGE_SIZE)
  }, [sorted, page])

  const hasActiveFilters =
    search.trim() !== '' ||
    department !== 'all' ||
    designation !== 'all' ||
    status !== 'all'

  const clearFilters = useCallback(() => {
    setSearch('')
    setDepartment('all')
    setDesignation('all')
    setStatus('all')
  }, [])

  const handleSort = useCallback(
    (key) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('asc')
      }
    },
    [sortKey]
  )

  const openAdd = () => {
    setEditingId(null)
    setModalMode('add')
  }
  const openEdit = (id) => {
    setEditingId(id)
    setModalMode('edit')
  }
  const closeModal = () => {
    setModalMode(null)
    setEditingId(null)
  }

  const handleSaveAdd = async (data) => {
    try {
      await onAdd(data)
      closeModal()
    } catch (_) {}
  }
  const handleSaveEdit = async (data) => {
    if (!editingId) return
    try {
      await onEdit(editingId, data)
      closeModal()
    } catch (_) {}
  }

  const existingEmployeeIds = useMemo(
    () => employees.map((e) => (e.employeeId ?? '').toLowerCase().trim()),
    [employees]
  )
  const excludeEmployeeId =
    modalMode === 'edit' && editingEmployee
      ? (editingEmployee.employeeId ?? '').trim().toLowerCase()
      : null

  const handleDeleteClick = (id) => setDeleteConfirmId(id)
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return
    try {
      await onDelete(deleteConfirmId)
      setDeleteConfirmId(null)
    } catch (_) {}
  }
  const handleDeleteCancel = () => setDeleteConfirmId(null)

  const startIndex = (page - 1) * PAGE_SIZE

  return (
    <div className="employee-directory">
      <header className="employee-directory__hero">
        <div className="employee-directory__hero-text">
          <h1 className="employee-directory__title">Employees</h1>
          <p className="employee-directory__subtitle">
            Manage employee records, contact details, job information, and identity details.
          </p>
        </div>
        <button type="button" className="btn btn--primary employee-directory__cta" onClick={openAdd}>
          Add Employee
        </button>
      </header>

      <EmployeeSummaryCards
        total={stats.total}
        activeCount={stats.activeCount}
        inactiveCount={stats.inactiveCount}
        onLeaveCount={stats.onLeaveCount}
      />

      <EmployeesToolbar
        search={search}
        onSearchChange={setSearch}
        department={department}
        onDepartmentChange={setDepartment}
        departmentOptions={departmentOptions}
        status={status}
        onStatusChange={setStatus}
        designation={designation}
        onDesignationChange={setDesignation}
        designationOptions={designationOptions}
        onClearFilters={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {employees.length === 0 ? (
        <div className="employee-directory__empty employee-directory__empty--global">
          <h2 className="employee-directory__empty-title">No employees yet</h2>
          <p className="employee-directory__empty-text">
            Start by adding your first employee. You can track ID, department, and more as your HR data
            grows.
          </p>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Employee
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="employee-directory__empty employee-directory__empty--filter">
          <h2 className="employee-directory__empty-title">No employees found</h2>
          <p className="employee-directory__empty-text">
            Try adjusting your search or filters, or add a new employee.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <EmployeesDataTable
          rows={pageRows}
          startIndex={startIndex}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onView={setViewEmployee}
          onEdit={openEdit}
          onDelete={handleDeleteClick}
          page={page}
          pageSize={PAGE_SIZE}
          totalFiltered={totalFiltered}
          onPageChange={setPage}
        />
      )}

      <Modal
        title={modalMode === 'add' ? 'Add Employee' : 'Edit Employee'}
        open={modalMode === 'add' || modalMode === 'edit'}
        onClose={closeModal}
        panelClassName="modal-panel--wide"
      >
        <EmployeeForm
          key={modalMode === 'edit' ? editingId : 'add'}
          initial={
            modalMode === 'edit' && editingEmployee
              ? {
                  employeeId: editingEmployee.employeeId,
                  name: editingEmployee.name,
                  department: editingEmployee.department,
                  joiningDate: editingEmployee.joiningDate ?? '',
                  photoUrl: editingEmployee.photoUrl ?? '',
                  phone: editingEmployee.phone ?? '',
                  emiratesId: editingEmployee.emiratesId ?? '',
                  passportNumber: editingEmployee.passportNumber ?? '',
                }
              : undefined
          }
          onSave={modalMode === 'add' ? handleSaveAdd : handleSaveEdit}
          onCancel={closeModal}
          submitLabel={modalMode === 'add' ? 'Add Employee' : 'Save'}
          existingEmployeeIds={existingEmployeeIds}
          excludeEmployeeId={excludeEmployeeId}
        />
      </Modal>

      <EmployeeViewModal
        employee={viewEmployee}
        open={Boolean(viewEmployee)}
        onClose={() => setViewEmployee(null)}
      />

      <DeleteConfirmModal
        open={Boolean(deleteConfirmId)}
        employeeName={
          deleteConfirmId ? employees.find((e) => e.id === deleteConfirmId)?.name ?? '' : ''
        }
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  )
}

function DeleteConfirmModal({ open, employeeName, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <Modal title="Delete employee?" open={open} onClose={onCancel}>
      <p className="delete-confirm-text">
        Are you sure you want to remove <strong>{employeeName}</strong>? This cannot be undone.
      </p>
      <div className="employee-form__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger-solid btn--sm" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </Modal>
  )
}

import { useState, useMemo } from 'react'
import { Modal } from './Modal'
import { EmployeeForm } from './EmployeeForm'
import './EmployeeList.css'

export function EmployeeList({ employees, onAdd, onEdit, onDelete }) {
  const [modalMode, setModalMode] = useState(null) // 'add' | 'edit'
  const [editingId, setEditingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const editingEmployee = useMemo(
    () => employees.find((e) => e.id === editingId) ?? null,
    [employees, editingId]
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
    } catch (_) {
      // Error shown via parent error state
    }
  }
  const handleSaveEdit = async (data) => {
    if (!editingId) return
    try {
      await onEdit(editingId, data)
      closeModal()
    } catch (_) {
      // Error shown via parent error state
    }
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
    } catch (_) {
      // Error shown via parent error state
    }
  }
  const handleDeleteCancel = () => setDeleteConfirmId(null)

  return (
    <div className="employee-list">
      <div className="employee-list__header">
        <h2 className="employee-list__title">Employees</h2>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={openAdd}
        >
          Add Employee
        </button>
      </div>

      <Modal
        title={modalMode === 'add' ? 'Add Employee' : 'Edit Employee'}
        open={modalMode === 'add' || modalMode === 'edit'}
        onClose={closeModal}
      >
        <EmployeeForm
          key={modalMode === 'edit' ? editingId : 'add'}
          initial={
            modalMode === 'edit' && editingEmployee
              ? {
                  employeeId: editingEmployee.employeeId,
                  name: editingEmployee.name,
                  department: editingEmployee.department,
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

      <DeleteConfirmModal
        open={Boolean(deleteConfirmId)}
        employeeName={
          deleteConfirmId
            ? employees.find((e) => e.id === deleteConfirmId)?.name ?? ''
            : ''
        }
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <ul className="employee-list__items" role="list">
        {employees.map((emp) => (
          <li key={emp.id} className="employee-list__item">
            <div className="employee-list__item-info">
              <span className="employee-list__item-id">{emp.employeeId}</span>
              <span className="employee-list__item-name">{emp.name}</span>
              <span className="employee-list__item-dept">{emp.department}</span>
            </div>
            <div className="employee-list__item-actions">
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                onClick={() => openEdit(emp.id)}
                aria-label={`Edit ${emp.name}`}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--danger"
                onClick={() => handleDeleteClick(emp.id)}
                aria-label={`Delete ${emp.name}`}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {employees.length === 0 && (
        <p className="employee-list__empty">No employees. Click &quot;Add Employee&quot; to create one.</p>
      )}
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
        <button
          type="button"
          className="btn btn--danger-solid btn--sm"
          onClick={onConfirm}
        >
          Delete
        </button>
      </div>
    </Modal>
  )
}

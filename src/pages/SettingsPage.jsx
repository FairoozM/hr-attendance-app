import { useState, useEffect } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { STATUSES, STATUS_KEYS } from '../constants/attendance'
import { Modal } from '../components/Modal'
import './Page.css'
import './SettingsPage.css'

const DEFAULT_APP_TITLE = 'Business Intelligence (BI) - Life Smile'

export function SettingsPage({ onResetDemoData }) {
  const {
    companyName,
    appTitle,
    departments,
    setCompanyName,
    setAppTitle,
    addDepartment,
    updateDepartment,
    deleteDepartment,
  } = useSettings()

  const [generalCompany, setGeneralCompany] = useState(companyName)
  const [generalTitle, setGeneralTitle] = useState(appTitle)
  useEffect(() => {
    setGeneralCompany(companyName)
    setGeneralTitle(appTitle ?? '')
  }, [companyName, appTitle])

  const [deptModalOpen, setDeptModalOpen] = useState(false)
  const [deptEditIndex, setDeptEditIndex] = useState(null)
  const [deptValue, setDeptValue] = useState('')
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const handleSaveGeneral = () => {
    setCompanyName(generalCompany)
    setAppTitle(generalTitle || DEFAULT_APP_TITLE)
  }

  const openAddDept = () => {
    setDeptEditIndex(null)
    setDeptValue('')
    setDeptModalOpen(true)
  }
  const openEditDept = (index) => {
    setDeptEditIndex(index)
    setDeptValue(departments[index] ?? '')
    setDeptModalOpen(true)
  }
  const saveDept = () => {
    const trimmed = deptValue.trim()
    if (!trimmed) return
    if (deptEditIndex !== null) {
      updateDepartment(deptEditIndex, trimmed)
    } else {
      addDepartment(trimmed)
    }
    setDeptModalOpen(false)
  }
  const handleDeleteDept = (index) => {
    if (window.confirm(`Remove department "${departments[index]}"?`)) {
      deleteDepartment(index)
    }
  }

  const handleResetDemo = () => {
    setResetConfirmOpen(false)
    onResetDemoData?.()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="ui-page-subtitle">
          Configure global workspace labels, reusable department options, attendance status references, and demo data controls.
        </p>
      </div>

      <section className="settings-section">
        <h2 className="settings-section__title">General</h2>
        <div className="settings-card">
          <label className="settings-field">
            <span className="settings-field__label">Company Name</span>
            <input
              type="text"
              className="settings-field__input"
              value={generalCompany}
              onChange={(e) => setGeneralCompany(e.target.value)}
              placeholder="Your company name"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">App Title (optional)</span>
            <input
              type="text"
              className="settings-field__input"
              value={generalTitle}
              onChange={(e) => setGeneralTitle(e.target.value)}
              placeholder={DEFAULT_APP_TITLE}
            />
          </label>
          <div className="settings-card__actions">
            <button type="button" className="btn btn--primary" onClick={handleSaveGeneral}>
              Save changes
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Departments</h2>
        <div className="settings-card">
          <p className="settings-section__desc">
            Departments used when adding or editing employees.
          </p>
          <ul className="settings-list">
            {departments.map((name, index) => (
              <li key={`${name}-${index}`} className="settings-list__item">
                <span className="settings-list__label">{name}</span>
                <div className="settings-list__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => openEditDept(index)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => handleDeleteDept(index)}
                    disabled={departments.length <= 1}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="settings-card__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={openAddDept}>
              Add department
            </button>
          </div>
        </div>
      </section>

      <Modal
        title={deptEditIndex !== null ? 'Edit department' : 'Add department'}
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
      >
        <label className="settings-field">
          <span className="settings-field__label">Name</span>
          <input
            type="text"
            className="settings-field__input"
            value={deptValue}
            onChange={(e) => setDeptValue(e.target.value)}
            placeholder="Department name"
            autoFocus
          />
        </label>
        <div className="settings-card__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setDeptModalOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={saveDept}>
            {deptEditIndex !== null ? 'Save' : 'Add'}
          </button>
        </div>
      </Modal>

      <section className="settings-section">
        <h2 className="settings-section__title">Attendance Statuses</h2>
        <div className="settings-card">
          <p className="settings-section__desc">
            Codes used in the attendance grid. Colors are fixed.
          </p>
          <ul className="settings-status-list">
            {STATUS_KEYS.map((key) => (
              <li key={key} className={`settings-status-item settings-status-item--${STATUSES[key].color}`}>
                <span className="settings-status-item__code">{key}</span>
                <span className="settings-status-item__label">{STATUSES[key].label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Data Management</h2>
        <div className="settings-card">
          <p className="settings-section__desc">
            Reset employees and all attendance data to demo defaults. This cannot be undone.
          </p>
          <div className="settings-card__actions">
            <button
              type="button"
              className="btn btn--danger-solid"
              onClick={() => setResetConfirmOpen(true)}
            >
              Reset demo data
            </button>
          </div>
        </div>
      </section>

      <Modal
        title="Reset demo data?"
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
      >
        <p className="settings-reset-text">
          This will restore default employees and clear all attendance records. Continue?
        </p>
        <div className="settings-card__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setResetConfirmOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger-solid" onClick={handleResetDemo}>
            Reset
          </button>
        </div>
      </Modal>
    </div>
  )
}

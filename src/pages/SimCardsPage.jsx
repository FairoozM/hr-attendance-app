import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { useSimCards } from '../hooks/useSimCards'
import { useAuth, hasPermission } from '../contexts/AuthContext'
import './Page.css'
import './SimCardsPage.css'

const EMPTY_FORM = {
  number: '',
  remarks: '',
  person: '',
  imeiNumber: '',
  mobileNumber: '',
  monthlyChargesAed: '',
  usage: 'Yes',
  type: '',
  issued: '',
}

function buildError(form) {
  if (!String(form.number || '').trim()) return 'number is required'
  if (!String(form.person || '').trim()) return 'Person is required'
  if (!String(form.type || '').trim()) return 'Type is required'
  if (!String(form.issued || '').trim()) return 'issued is required'
  const monthly = Number(form.monthlyChargesAed)
  if (!Number.isFinite(monthly)) return 'Monthly Charges (AED) must be a valid number'
  if (monthly < 0) return 'Monthly Charges (AED) cannot be negative'
  const usage = String(form.usage || '').trim()
  if (usage !== 'Yes' && usage !== 'No') return 'Usage must be Yes or No'
  return ''
}

function SimCardFormModal({ open, mode, initialValue, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(initialValue || EMPTY_FORM)

  useEffect(() => {
    if (!open) return
    setForm(initialValue || EMPTY_FORM)
  }, [open, initialValue])

  const setField = (key) => (e) => {
    const value = e?.target?.value ?? ''
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const submit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Sim Card' : 'Add Sim Card'}
      open={open}
      onClose={onClose}
      panelClassName="modal-panel--wide"
    >
      <form className="sim-form" onSubmit={submit}>
        <div className="sim-form__grid">
          <label>
            number *
            <input value={form.number} onChange={setField('number')} required />
          </label>
          <label>
            Person *
            <input value={form.person} onChange={setField('person')} required />
          </label>
          <label>
            IMEI NUMBER
            <input value={form.imeiNumber} onChange={setField('imeiNumber')} />
          </label>
          <label>
            Mobile Number
            <input value={form.mobileNumber} onChange={setField('mobileNumber')} />
          </label>
          <label>
            Monthly Charges (AED) *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.monthlyChargesAed}
              onChange={setField('monthlyChargesAed')}
              required
            />
          </label>
          <label>
            Usage *
            <select value={form.usage} onChange={setField('usage')} required>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </label>
          <label>
            Type *
            <input value={form.type} onChange={setField('type')} required />
          </label>
          <label>
            issued *
            <input value={form.issued} onChange={setField('issued')} required />
          </label>
          <label className="sim-form__full">
            Remarks
            <textarea rows={3} value={form.remarks} onChange={setField('remarks')} />
          </label>
        </div>
        {error ? <p className="sim-form__err">{error}</p> : null}
        <div className="sim-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Add Sim Card'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function SimCardsPage() {
  const { user } = useAuth()
  const { items, loading, error, createItem, updateItem, deleteItem } = useSimCards()
  const canAdd = hasPermission(user, 'sim_cards', 'add')
  const canEdit = hasPermission(user, 'sim_cards', 'edit')
  const canDelete = hasPermission(user, 'sim_cards', 'delete')

  const [search, setSearch] = useState('')
  const [usage, setUsage] = useState('All')
  const [type, setType] = useState('All')
  const [issued, setIssued] = useState('All')
  const [monthly, setMonthly] = useState('All')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [modalError, setModalError] = useState('')
  const [modalSaving, setModalSaving] = useState(false)
  const [editing, setEditing] = useState(EMPTY_FORM)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const typeOptions = useMemo(
    () => ['All', ...Array.from(new Set(items.map((x) => x.type).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [items]
  )
  const issuedOptions = useMemo(
    () => ['All', ...Array.from(new Set(items.map((x) => x.issued).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [items]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((row) => {
      if (usage !== 'All' && row.usage !== usage) return false
      if (type !== 'All' && row.type !== type) return false
      if (issued !== 'All' && row.issued !== issued) return false
      if (monthly === '0' && row.monthlyChargesAed !== 0) return false
      if (monthly === '1-100' && !(row.monthlyChargesAed >= 1 && row.monthlyChargesAed <= 100)) return false
      if (monthly === '101-500' && !(row.monthlyChargesAed >= 101 && row.monthlyChargesAed <= 500)) return false
      if (monthly === '>500' && !(row.monthlyChargesAed > 500)) return false
      if (!q) return true
      const blob = [
        row.number,
        row.person,
        row.remarks,
        row.mobileNumber,
        row.type,
        row.issued,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [items, search, usage, type, issued, monthly])

  const openCreate = () => {
    setModalMode('create')
    setEditing({ ...EMPTY_FORM, __id: 'new' })
    setModalError('')
    setModalOpen(true)
  }

  const openEdit = (row) => {
    setModalMode('edit')
    setEditing({
      __id: row.id,
      number: row.number || '',
      remarks: row.remarks || '',
      person: row.person || '',
      imeiNumber: row.imeiNumber || '',
      mobileNumber: row.mobileNumber || '',
      monthlyChargesAed: String(row.monthlyChargesAed ?? ''),
      usage: row.usage || 'Yes',
      type: row.type || '',
      issued: row.issued || '',
    })
    setModalError('')
    setModalOpen(true)
  }

  const saveModal = async (form) => {
    const e = buildError(form)
    if (e) return setModalError(e)
    setModalSaving(true)
    setModalError('')
    try {
      if (modalMode === 'edit') await updateItem(editing.__id, form)
      else await createItem(form)
      setModalOpen(false)
    } catch (err) {
      setModalError(err.message || 'Failed to save')
    } finally {
      setModalSaving(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setUsage('All')
    setType('All')
    setIssued('All')
    setMonthly('All')
  }

  const confirmDelete = async () => {
    if (!deletingId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteItem(deletingId)
      setDeletingId(null)
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="sim-page">
        <div className="sim-page__hero">
          <div>
            <h1 className="sim-page__title">Sim Cards List</h1>
            <p className="sim-page__subtitle">Manage company SIM cards, charges, usage, and ownership records.</p>
          </div>
          {canAdd && (
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              Add Sim Card
            </button>
          )}
        </div>

        <div className="sim-filters">
          <div className="sim-filters__search">
            <input
              type="search"
              placeholder="Search number, person, remarks, mobile, type, issued..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={usage} onChange={(e) => setUsage(e.target.value)}>
            <option value="All">Usage: All</option>
            <option value="Yes">Usage: Yes</option>
            <option value="No">Usage: No</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {typeOptions.map((x) => (
              <option key={x} value={x}>
                Type: {x}
              </option>
            ))}
          </select>
          <select value={issued} onChange={(e) => setIssued(e.target.value)}>
            {issuedOptions.map((x) => (
              <option key={x} value={x}>
                issued: {x}
              </option>
            ))}
          </select>
          <select value={monthly} onChange={(e) => setMonthly(e.target.value)}>
            <option value="All">Monthly Charges: All</option>
            <option value="0">Monthly Charges: 0</option>
            <option value="1-100">Monthly Charges: 1-100</option>
            <option value="101-500">Monthly Charges: 101-500</option>
            <option value=">500">Monthly Charges: &gt;500</option>
          </select>
          <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
            Clear Filters
          </button>
        </div>

        {error ? <p className="page-error">{error}</p> : null}

        <div className="sim-table-wrap">
          {loading ? (
            <div className="sim-empty">Loading sim cards...</div>
          ) : filtered.length === 0 ? (
            <div className="sim-empty">No records found.</div>
          ) : (
            <table className="sim-table">
              <thead>
                <tr>
                  <th>number</th>
                  <th>Remarks</th>
                  <th>Person</th>
                  <th>IMEI NUMBER</th>
                  <th>Mobile Number</th>
                  <th>Monthly Charges (AED)</th>
                  <th>Usage</th>
                  <th>Type</th>
                  <th>issued</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.number || '—'}</td>
                    <td>{row.remarks || '—'}</td>
                    <td>{row.person || '—'}</td>
                    <td>{row.imeiNumber || '—'}</td>
                    <td>{row.mobileNumber || '—'}</td>
                    <td>AED {Number(row.monthlyChargesAed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>
                      <span className={`sim-usage ${row.usage === 'Yes' ? 'sim-usage--yes' : 'sim-usage--no'}`}>{row.usage}</span>
                    </td>
                    <td>{row.type || '—'}</td>
                    <td>{row.issued || '—'}</td>
                    <td>
                      <div className="sim-actions">
                        {canEdit ? (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(row)}>
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button type="button" className="btn btn--danger btn--sm" onClick={() => setDeletingId(row.id)}>
                            Delete
                          </button>
                        ) : null}
                        {!canEdit && !canDelete ? '—' : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <SimCardFormModal
        open={modalOpen}
        mode={modalMode}
        initialValue={editing}
        saving={modalSaving}
        error={modalError}
        onClose={() => setModalOpen(false)}
        onSave={saveModal}
      />

      <Modal title="Delete Sim Card" open={Boolean(deletingId)} onClose={() => setDeletingId(null)}>
        <p className="delete-confirm-text">Are you sure you want to delete this sim card record? This action cannot be undone.</p>
        {deleteError ? <p className="sim-form__err">{deleteError}</p> : null}
        <div className="sim-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setDeletingId(null)} disabled={deleteBusy}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

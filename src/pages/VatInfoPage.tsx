import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { useVatInfo, type VatCountry, type VatInfoForm, type VatInfoItem } from '../hooks/useVatInfo'
import { useAuth, hasPermission } from '../contexts/AuthContext'
import {
  useUrlSearchParamState,
  useUrlStringParamState,
} from '../hooks/useUrlSearchParamState'
import { ModernSearchInput } from '../components/ui/ModernSearchInput'
import { ModernSelect } from '../components/ui/ModernSelect'
import './Page.css'
import './VatInfoPage.css'

const EMPTY_FORM: VatInfoForm = {
  companyName: '',
  vatNumber: '',
  country: 'UAE',
  dateFirstRegistered: '',
  vatPct: '5',
  vatFilings: 'Quarterly',
  agent: '',
  chargesOfFiling: '',
}

type EditingForm = VatInfoForm & { __id: string }

function buildError(form: VatInfoForm): string {
  if (!String(form.companyName || '').trim()) return 'Company Name is required'
  if (!String(form.vatNumber || '').trim()) return 'VAT Number is required'
  if (form.country !== 'UAE' && form.country !== 'KSA') return 'Country must be UAE or KSA'
  const date = String(form.dateFirstRegistered || '').trim()
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date First Registered must be a valid date'
  const vatPct = Number(form.vatPct)
  if (!Number.isFinite(vatPct) || vatPct < 0) return 'VAT % must be a valid non-negative number'
  if (!String(form.vatFilings || '').trim()) return 'VAT Filings is required'
  const charges = Number(form.chargesOfFiling)
  if (!Number.isFinite(charges) || charges < 0) return 'Charges of Filing must be a valid non-negative number'
  return ''
}

function defaultVatPctForCountry(country: VatCountry): string {
  return country === 'KSA' ? '15' : '5'
}

type VatInfoFormModalProps = {
  open: boolean
  mode: 'create' | 'edit'
  initialValue: EditingForm | VatInfoForm
  saving: boolean
  error: string
  onClose: () => void
  onSave: (form: VatInfoForm) => void
}

function VatInfoFormModal({
  open,
  mode,
  initialValue,
  saving,
  error,
  onClose,
  onSave,
}: VatInfoFormModalProps) {
  const [form, setForm] = useState<VatInfoForm>(initialValue || EMPTY_FORM)

  useEffect(() => {
    if (!open) return
    setForm(initialValue || EMPTY_FORM)
  }, [open, initialValue])

  const setField =
    (key: keyof VatInfoForm) =>
    (e: { target: { value: string } }) => {
      const value = e?.target?.value ?? ''
      setForm((prev) => {
        if (key === 'country') {
          const country = (value === 'KSA' ? 'KSA' : 'UAE') as VatCountry
          const next = { ...prev, country }
          if (mode === 'create') {
            next.vatPct = defaultVatPctForCountry(country)
          }
          return next
        }
        return { ...prev, [key]: value }
      })
    }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <Modal
      title={mode === 'edit' ? 'Edit VAT Info' : 'Add VAT Info'}
      open={open}
      onClose={onClose}
      panelClassName="modal-panel--wide"
    >
      <form className="vat-form" onSubmit={submit}>
        <div className="vat-form__grid">
          <label>
            Company Name *
            <input value={form.companyName} onChange={setField('companyName')} required />
          </label>
          <label>
            VAT Number *
            <input value={form.vatNumber} onChange={setField('vatNumber')} required />
          </label>
          <label>
            Country *
            <select value={form.country} onChange={setField('country')} required>
              <option value="UAE">UAE</option>
              <option value="KSA">KSA</option>
            </select>
          </label>
          <label>
            Date First Registered
            <input
              type="date"
              value={form.dateFirstRegistered}
              onChange={setField('dateFirstRegistered')}
            />
          </label>
          <label>
            VAT % *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.vatPct}
              onChange={setField('vatPct')}
              required
            />
          </label>
          <label>
            VAT Filings *
            <input value={form.vatFilings} onChange={setField('vatFilings')} required />
          </label>
          <label>
            Agent
            <input value={form.agent} onChange={setField('agent')} />
          </label>
          <label>
            Charges of Filing *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.chargesOfFiling}
              onChange={setField('chargesOfFiling')}
              required
            />
          </label>
        </div>
        {error ? <p className="vat-form__err">{error}</p> : null}
        <div className="vat-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Add VAT Info'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function formatMoney(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return value
}

export function VatInfoPage() {
  const { user } = useAuth()
  const { items, loading, error, createItem, updateItem, deleteItem } = useVatInfo()
  const canAdd = hasPermission(user, 'vat_info', 'add')
  const canEdit = hasPermission(user, 'vat_info', 'edit')
  const canDelete = hasPermission(user, 'vat_info', 'delete')

  const [search, setSearch] = useUrlStringParamState('q')
  const [country, setCountry] = useUrlSearchParamState('country', {
    defaultValue: 'All',
    allowed: ['All', 'UAE', 'KSA'],
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [modalError, setModalError] = useState('')
  const [modalSaving, setModalSaving] = useState(false)
  const [editing, setEditing] = useState<EditingForm>({ ...EMPTY_FORM, __id: 'new' })
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((row) => {
      if (country !== 'All' && row.country !== country) return false
      if (!q) return true
      const blob = [
        row.companyName,
        row.vatNumber,
        row.country,
        row.dateFirstRegistered,
        row.vatPct,
        row.vatFilings,
        row.agent,
        row.chargesOfFiling,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [items, search, country])

  const openCreate = () => {
    setModalMode('create')
    setEditing({ ...EMPTY_FORM, __id: 'new' })
    setModalError('')
    setModalOpen(true)
  }

  const openEdit = (row: VatInfoItem) => {
    setModalMode('edit')
    setEditing({
      __id: row.id,
      companyName: row.companyName || '',
      vatNumber: row.vatNumber || '',
      country: row.country || 'UAE',
      dateFirstRegistered: row.dateFirstRegistered || '',
      vatPct: String(row.vatPct ?? ''),
      vatFilings: row.vatFilings || 'Quarterly',
      agent: row.agent || '',
      chargesOfFiling: String(row.chargesOfFiling ?? ''),
    })
    setModalError('')
    setModalOpen(true)
  }

  const saveModal = async (form: VatInfoForm) => {
    const e = buildError(form)
    if (e) {
      setModalError(e)
      return
    }
    setModalSaving(true)
    setModalError('')
    try {
      if (modalMode === 'edit') await updateItem(editing.__id, form)
      else await createItem(form)
      setModalOpen(false)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setModalSaving(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setCountry('All')
  }

  const confirmDelete = async () => {
    if (!deletingId) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteItem(deletingId)
      setDeletingId(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="vat-page">
        <div className="vat-page__hero">
          <div>
            <h1 className="vat-page__title">VAT Info</h1>
            <p className="vat-page__subtitle">
              UAE and KSA company VAT registration details, filings, and agent charges.
            </p>
          </div>
          {canAdd ? (
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              Add VAT Info
            </button>
          ) : null}
        </div>

        <div className="vat-filters">
          <ModernSearchInput
            placeholder="Search company, VAT number, agent, filings..."
            value={search}
            onChange={setSearch}
          />
          <ModernSelect
            value={country}
            options={[
              { value: 'All', label: 'Country: All' },
              { value: 'UAE', label: 'Country: UAE' },
              { value: 'KSA', label: 'Country: KSA' },
            ]}
            onChange={setCountry}
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
            Clear Filters
          </button>
        </div>

        {error ? <p className="page-error">{error}</p> : null}

        <div className="vat-table-wrap">
          {loading ? (
            <div className="vat-empty">Loading VAT info...</div>
          ) : filtered.length === 0 ? (
            <div className="vat-empty">No records found.</div>
          ) : (
            <table className="vat-table">
              <thead>
                <tr>
                  <th>Company Name</th>
                  <th>VAT Number</th>
                  <th>Country</th>
                  <th>Date First Registered</th>
                  <th>VAT %</th>
                  <th>VAT Filings</th>
                  <th>Agent</th>
                  <th>Charges of Filing</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.companyName || '—'}</td>
                    <td>{row.vatNumber || '—'}</td>
                    <td>
                      <span
                        className={`vat-country ${
                          row.country === 'KSA' ? 'vat-country--ksa' : 'vat-country--uae'
                        }`}
                      >
                        {row.country}
                      </span>
                    </td>
                    <td>{formatDate(row.dateFirstRegistered)}</td>
                    <td>{Number(row.vatPct || 0).toLocaleString('en-US')}%</td>
                    <td>{row.vatFilings || '—'}</td>
                    <td>{row.agent || '—'}</td>
                    <td>{formatMoney(row.chargesOfFiling)}</td>
                    <td>
                      <div className="vat-actions">
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => setDeletingId(row.id)}
                          >
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

      <VatInfoFormModal
        open={modalOpen}
        mode={modalMode}
        initialValue={editing}
        saving={modalSaving}
        error={modalError}
        onClose={() => setModalOpen(false)}
        onSave={(form) => {
          void saveModal(form)
        }}
      />

      <Modal
        title="Delete VAT Info"
        open={Boolean(deletingId)}
        onClose={() => setDeletingId(null)}
      >
        <p className="delete-confirm-text">
          Are you sure you want to delete this VAT info record? This action cannot be undone.
        </p>
        {deleteError ? <p className="vat-form__err">{deleteError}</p> : null}
        <div className="vat-form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setDeletingId(null)}
            disabled={deleteBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              void confirmDelete()
            }}
            disabled={deleteBusy}
          >
            {deleteBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

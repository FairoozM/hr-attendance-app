import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, Loader2, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../components/Modal'
import {
  useVatInfo,
  type VatCertificate,
  type VatCountry,
  type VatInfoForm,
  type VatInfoItem,
} from '../hooks/useVatInfo'
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

const ALLOWED_CERT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/gif'])
const ALLOWED_CERT_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.gif'])
const MAX_CERT_BYTES = 10 * 1024 * 1024

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

function isAllowedCertificate(file: File): string {
  const type = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : ''
  if (!ALLOWED_CERT_TYPES.has(type) && !ALLOWED_CERT_EXTS.has(ext)) {
    return 'Only PDF, JPEG, and GIF files are allowed'
  }
  if (file.size > MAX_CERT_BYTES) return 'File must be 10 MB or smaller'
  return ''
}

function isImageCertificate(fileType: string, fileName: string): boolean {
  const type = String(fileType || '').toLowerCase()
  if (type.startsWith('image/')) return true
  const name = String(fileName || '').toLowerCase()
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif')
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

type CertificatesCellProps = {
  row: VatInfoItem
  canEdit: boolean
  busyCertId: string | null
  uploading: boolean
  onUpload: (vatInfoId: string, file: File) => Promise<void>
  onView: (vatInfoId: string, cert: VatCertificate) => Promise<void>
  onDownload: (vatInfoId: string, cert: VatCertificate) => Promise<void>
  onDelete: (vatInfoId: string, cert: VatCertificate) => void
}

function CertificatesCell({
  row,
  canEdit,
  busyCertId,
  uploading,
  onUpload,
  onView,
  onDownload,
  onDelete,
}: CertificatesCellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [localError, setLocalError] = useState('')

  const pickFile = () => {
    setLocalError('')
    inputRef.current?.click()
  }

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = isAllowedCertificate(file)
    if (err) {
      setLocalError(err)
      return
    }
    setLocalError('')
    try {
      await onUpload(row.id, file)
    } catch (uploadErr) {
      setLocalError(uploadErr instanceof Error ? uploadErr.message : 'Upload failed')
    }
  }

  return (
    <div className="vat-certs">
      {row.certificates.length === 0 ? (
        <span className="vat-certs__empty">No files</span>
      ) : (
        <ul className="vat-certs__list">
          {row.certificates.map((cert) => {
            const busy = busyCertId === cert.id
            return (
              <li key={cert.id} className="vat-certs__item">
                <span className="vat-certs__name" title={cert.fileName}>
                  {cert.fileName || 'certificate'}
                </span>
                <div className="vat-certs__icons">
                  <button
                    type="button"
                    className="vat-icon-btn"
                    title="View"
                    aria-label={`View ${cert.fileName}`}
                    disabled={busy}
                    onClick={() => {
                      void onView(row.id, cert)
                    }}
                  >
                    {busy ? <Loader2 size={13} className="vat-icon-spin" /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    className="vat-icon-btn"
                    title="Download"
                    aria-label={`Download ${cert.fileName}`}
                    disabled={busy}
                    onClick={() => {
                      void onDownload(row.id, cert)
                    }}
                  >
                    <Download size={13} />
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className="vat-icon-btn vat-icon-btn--danger"
                      title="Delete"
                      aria-label={`Delete ${cert.fileName}`}
                      disabled={busy}
                      onClick={() => onDelete(row.id, cert)}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit ? (
        <>
          <button
            type="button"
            className="vat-icon-btn vat-icon-btn--add"
            title="Add certificate (PDF, JPEG, GIF)"
            aria-label="Add certificate"
            disabled={uploading}
            onClick={pickFile}
          >
            {uploading ? <Loader2 size={13} className="vat-icon-spin" /> : <Plus size={13} />}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="vat-certs__file"
            accept=".pdf,.jpg,.jpeg,.gif,application/pdf,image/jpeg,image/gif"
            onChange={(e) => {
              void handleChange(e)
            }}
          />
        </>
      ) : null}

      {localError ? <p className="vat-certs__err">{localError}</p> : null}
    </div>
  )
}

export function VatInfoPage() {
  const { user } = useAuth()
  const {
    items,
    loading,
    error,
    createItem,
    updateItem,
    deleteItem,
    uploadCertificate,
    getCertificateDownloadUrl,
    deleteCertificate,
  } = useVatInfo()
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

  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [busyCertId, setBusyCertId] = useState<string | null>(null)
  const [certDeleteTarget, setCertDeleteTarget] = useState<{
    vatInfoId: string
    cert: VatCertificate
  } | null>(null)
  const [certDeleteBusy, setCertDeleteBusy] = useState(false)
  const [certDeleteError, setCertDeleteError] = useState('')
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)

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
        ...row.certificates.map((c) => c.fileName),
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

  const handleUploadCertificate = async (vatInfoId: string, file: File) => {
    setUploadingId(vatInfoId)
    try {
      await uploadCertificate(vatInfoId, file)
    } finally {
      setUploadingId(null)
    }
  }

  const handleViewCertificate = async (vatInfoId: string, cert: VatCertificate) => {
    setBusyCertId(cert.id)
    try {
      const { downloadUrl, fileName } = await getCertificateDownloadUrl(vatInfoId, cert.id)
      if (isImageCertificate(cert.fileType, cert.fileName)) {
        setPreview({ url: downloadUrl, name: fileName || cert.fileName })
      } else {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer')
      }
    } finally {
      setBusyCertId(null)
    }
  }

  const handleDownloadCertificate = async (vatInfoId: string, cert: VatCertificate) => {
    setBusyCertId(cert.id)
    try {
      const { downloadUrl, fileName } = await getCertificateDownloadUrl(vatInfoId, cert.id)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = fileName || cert.fileName || 'certificate'
      a.rel = 'noopener noreferrer'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setBusyCertId(null)
    }
  }

  const confirmDeleteCertificate = async () => {
    if (!certDeleteTarget) return
    setCertDeleteBusy(true)
    setCertDeleteError('')
    try {
      await deleteCertificate(certDeleteTarget.vatInfoId, certDeleteTarget.cert.id)
      setCertDeleteTarget(null)
    } catch (err) {
      setCertDeleteError(err instanceof Error ? err.message : 'Failed to delete certificate')
    } finally {
      setCertDeleteBusy(false)
    }
  }

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [preview])

  return (
    <div className="page">
      <div className="vat-page">
        <div className="vat-page__hero">
          <div>
            <h1 className="vat-page__title">VAT Info</h1>
            <p className="vat-page__subtitle">
              UAE and KSA company VAT registration details, filings, certificates, and agent charges.
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
            placeholder="Search company, VAT number, agent, filings, certificates..."
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
                  <th>Certificates</th>
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
                      <CertificatesCell
                        row={row}
                        canEdit={canEdit}
                        busyCertId={busyCertId}
                        uploading={uploadingId === row.id}
                        onUpload={handleUploadCertificate}
                        onView={handleViewCertificate}
                        onDownload={handleDownloadCertificate}
                        onDelete={(vatInfoId, cert) => {
                          setCertDeleteError('')
                          setCertDeleteTarget({ vatInfoId, cert })
                        }}
                      />
                    </td>
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
          Are you sure you want to delete this VAT info record? Attached certificates will also be
          removed. This action cannot be undone.
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

      <Modal
        title="Delete Certificate"
        open={Boolean(certDeleteTarget)}
        onClose={() => setCertDeleteTarget(null)}
      >
        <p className="delete-confirm-text">
          Delete certificate{' '}
          <strong>{certDeleteTarget?.cert.fileName || 'this file'}</strong>? This cannot be undone.
        </p>
        {certDeleteError ? <p className="vat-form__err">{certDeleteError}</p> : null}
        <div className="vat-form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setCertDeleteTarget(null)}
            disabled={certDeleteBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              void confirmDeleteCertificate()
            }}
            disabled={certDeleteBusy}
          >
            {certDeleteBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>

      {preview ? (
        <div
          className="vat-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
          onClick={() => setPreview(null)}
        >
          <div className="vat-lightbox__panel" onClick={(e) => e.stopPropagation()}>
            <div className="vat-lightbox__bar">
              <span>{preview.name}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <img src={preview.url} alt={preview.name} className="vat-lightbox__img" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

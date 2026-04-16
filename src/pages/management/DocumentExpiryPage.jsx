import { useState, useMemo, useCallback } from 'react'
import { Modal } from '../../components/Modal'
import { DocSummaryCards } from './components/DocSummaryCards'
import { DocFiltersBar } from './components/DocFiltersBar'
import { DocForm } from './components/DocForm'
import { DocTable } from './components/DocTable'
import { getSmartStatus, STATUS } from './utils/docExpiryUtils'
import { useDocumentExpiry } from '../../hooks/useDocumentExpiry'
import './DocumentExpiryPage.css'

const EMPTY_FILTERS = {
  search: '',
  docType: '',
  company: '',
  status: '',
}

export function DocumentExpiryPage() {
  const { items: documents, loading, error, createItem, updateItem, deleteItem } = useDocumentExpiry()

  const [filters, setFilters]       = useState(EMPTY_FILTERS)
  const [activeQuick, setActiveQuick] = useState('all')

  const [formOpen, setFormOpen]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError]   = useState('')
  const [deleteId, setDeleteId]     = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return documents.filter(doc => {
      if (activeQuick === 'vat'      && doc.documentType !== 'VAT Filing')                  return false
      if (activeQuick === 'expired'  && getSmartStatus(doc.expiryDate) !== STATUS.EXPIRED)  return false
      if (activeQuick === 'due-soon' && getSmartStatus(doc.expiryDate) !== STATUS.DUE_SOON) return false
      if (activeQuick === 'urgent'   && getSmartStatus(doc.expiryDate) !== STATUS.URGENT)   return false
      if (filters.docType && doc.documentType !== filters.docType) return false
      if (filters.company && doc.company      !== filters.company) return false
      if (filters.status  && getSmartStatus(doc.expiryDate) !== filters.status) return false
      if (q) {
        const blob = [doc.name, doc.documentType, doc.company, doc.periodCovered]
          .join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [documents, filters, activeQuick])

  const openAdd = useCallback(() => {
    setEditTarget(null)
    setFormError('')
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((doc) => {
    setEditTarget(doc)
    setFormError('')
    setFormOpen(true)
  }, [])

  const handleSave = useCallback(async (form) => {
    setFormSaving(true)
    setFormError('')
    try {
      if (editTarget) {
        await updateItem(editTarget.id, form)
      } else {
        await createItem(form)
      }
      setFormOpen(false)
    } catch (err) {
      setFormError(err.message || 'Failed to save document')
    } finally {
      setFormSaving(false)
    }
  }, [editTarget, createItem, updateItem])

  const handleDelete = useCallback(async () => {
    if (!deleteId) return
    setDeleteLoading(true)
    try {
      await deleteItem(deleteId)
      setDeleteId(null)
    } catch (err) {
      console.error('[doc-expiry] delete failed:', err)
    } finally {
      setDeleteLoading(false)
    }
  }, [deleteId, deleteItem])

  const handleFiltersChange = useCallback((f) => setFilters(f), [])
  const handleQuickFilter   = useCallback((id) => {
    setActiveQuick(id)
    setFilters(EMPTY_FILTERS)
  }, [])

  return (
    <div className="page">
      <div className="doc-expiry-page">

        <div className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">Document Expiry Tracker</h1>
            <p className="doc-page-subtitle">
              Track compliance deadlines, renewals, trade licenses, subscriptions, and
              VAT filings for UAE &amp; KSA operations.
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            + Add Document
          </button>
        </div>

        {error && (
          <div className="doc-error-banner">
            ⚠ {error}
          </div>
        )}

        <DocSummaryCards documents={documents} />

        <DocFiltersBar
          filters={filters}
          onChange={handleFiltersChange}
          onQuickFilter={handleQuickFilter}
          activeQuick={activeQuick}
        />

        {loading ? (
          <div className="doc-loading">Loading documents…</div>
        ) : (
          <DocTable
            documents={filtered}
            onEdit={openEdit}
            onDelete={(id) => setDeleteId(id)}
          />
        )}
      </div>

      <Modal
        title={editTarget ? 'Edit Document' : 'Add New Document'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        panelClassName="modal-panel--wide"
      >
        {formError && <p className="doc-form-error">{formError}</p>}
        <DocForm
          initialValue={editTarget}
          onSave={handleSave}
          onCancel={() => setFormOpen(false)}
          saving={formSaving}
        />
      </Modal>

      <Modal
        title="Delete Document"
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
      >
        <p className="delete-confirm-text">
          Are you sure you want to delete this document record? This action cannot be undone.
        </p>
        <div className="doc-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setDeleteId(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={handleDelete}
            disabled={deleteLoading}
          >
            {deleteLoading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

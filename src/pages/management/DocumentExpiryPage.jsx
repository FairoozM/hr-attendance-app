import { useState, useMemo, useCallback, useEffect } from 'react'
import { Modal } from '../../components/Modal'
import { DocSummaryCards } from './components/DocSummaryCards'
import { DocFiltersBar } from './components/DocFiltersBar'
import { DocForm } from './components/DocForm'
import { DocTable } from './components/DocTable'
import { getSmartStatus, STATUS } from './utils/docExpiryUtils'
import { SEED_DOCUMENTS } from './data/seedDocuments'
import './DocumentExpiryPage.css'

// ── API integration point ─────────────────────────────────────────────────────
// Replace the localStorage init + useEffect persistence with a useEffect + API
// fetch/save when a backend is ready.
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = 'doc_expiry_documents'
const LS_ID_KEY = 'doc_expiry_next_id'

function loadDocuments() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return SEED_DOCUMENTS
}

function loadNextId() {
  try {
    const raw = localStorage.getItem(LS_ID_KEY)
    if (raw) return Number(raw)
  } catch { /* ignore */ }
  return SEED_DOCUMENTS.length + 1
}

let _nextId = loadNextId()

const EMPTY_FILTERS = {
  search: '',
  docType: '',
  company: '',
  status: '',
}

export function DocumentExpiryPage() {
  const [documents, setDocuments] = useState(loadDocuments)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [activeQuick, setActiveQuick] = useState('all')

  // Persist to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(documents)) } catch { /* ignore */ }
  }, [documents])

  const [formOpen, setFormOpen]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [formSaving, setFormSaving] = useState(false)
  const [deleteId, setDeleteId]     = useState(null)

  // Compose quick-filter + field filters
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return documents.filter(doc => {
      if (activeQuick === 'vat'      && doc.documentType !== 'VAT Filing')                   return false
      if (activeQuick === 'expired'  && getSmartStatus(doc.expiryDate) !== STATUS.EXPIRED)   return false
      if (activeQuick === 'due-soon' && getSmartStatus(doc.expiryDate) !== STATUS.DUE_SOON)  return false
      if (activeQuick === 'urgent'   && getSmartStatus(doc.expiryDate) !== STATUS.URGENT)    return false

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
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((doc) => {
    setEditTarget(doc)
    setFormOpen(true)
  }, [])

  const handleSave = useCallback((form) => {
    setFormSaving(true)
    // ── API swap: replace with await api.post/put(...) ──
    const now = new Date().toISOString().slice(0, 10)
    if (editTarget) {
      setDocuments(prev =>
        prev.map(d => d.id === editTarget.id ? { ...d, ...form, updatedAt: now } : d)
      )
    } else {
      const id = String(_nextId++)
      try { localStorage.setItem(LS_ID_KEY, String(_nextId)) } catch { /* ignore */ }
      setDocuments(prev => [...prev, { ...form, id, attachment: null, createdAt: now, updatedAt: now }])
    }
    setFormSaving(false)
    setFormOpen(false)
  }, [editTarget])

  const handleDelete = useCallback(() => {
    if (!deleteId) return
    // ── API swap: replace with await api.delete(`/documents/${deleteId}`) ──
    setDocuments(prev => prev.filter(d => d.id !== deleteId))
    setDeleteId(null)
  }, [deleteId])

  const handleFiltersChange = useCallback((f) => {
    setFilters(f)
  }, [])

  const handleQuickFilter = useCallback((id) => {
    setActiveQuick(id)
    setFilters(EMPTY_FILTERS)
  }, [])

  return (
    <div className="page">
      <div className="doc-expiry-page">

        {/* Page header */}
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

        {/* Summary cards — always from full dataset, not filtered */}
        <DocSummaryCards documents={documents} />

        {/* Filters */}
        <DocFiltersBar
          filters={filters}
          onChange={handleFiltersChange}
          onQuickFilter={handleQuickFilter}
          activeQuick={activeQuick}
        />

        {/* Table / empty state */}
        <DocTable
          documents={filtered}
          onEdit={openEdit}
          onDelete={(id) => setDeleteId(id)}
        />
      </div>

      {/* Add / Edit modal */}
      <Modal
        title={editTarget ? 'Edit Document' : 'Add New Document'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        panelClassName="modal-panel--wide"
      >
        <DocForm
          initialValue={editTarget}
          onSave={handleSave}
          onCancel={() => setFormOpen(false)}
          saving={formSaving}
        />
      </Modal>

      {/* Delete confirmation modal */}
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
          <button type="button" className="btn btn--danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}

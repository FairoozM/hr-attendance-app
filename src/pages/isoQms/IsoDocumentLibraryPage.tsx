import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import {
  approveIsoDocument,
  markIsoDocumentObsolete,
  rejectIsoDocument,
  setIsoDocumentAuditorPublish,
  submitIsoDocumentReview,
  uploadIsoRevision,
  confirmIsoUpload,
  presignIsoUpload,
  putFileToPresignedUrl,
} from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoDocumentTable } from './components/IsoDocumentTable'
import { IsoLoadingState } from './components/IsoEmptyState'
import { IsoBulkUploadModal } from './components/IsoBulkUploadModal'
import { IsoFilePreview } from './components/IsoFilePreview'
import { useIsoDocuments } from './hooks/useIsoDocuments'
import type { IsoDocument } from './types'
import './isoQms.css'

const STATUS_OPTIONS = [
  'Draft',
  'Under Review',
  'Approved',
  'Current',
  'Superseded',
  'Obsolete',
  'Archived',
  'Expired',
].map((v) => ({ value: v, label: v }))

export function IsoDocumentLibraryPage() {
  const { user } = useAuth()
  const canAdd = hasPermission(user, 'iso_qms', 'add')
  const canEdit = hasPermission(user, 'iso_qms', 'edit')
  const canApprove = hasPermission(user, 'iso_qms', 'approve')
  const [searchParams, setSearchParams] = useSearchParams()

  const initial = useMemo(
    () => ({
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
      documentType: searchParams.get('documentType') || '',
      department: searchParams.get('department') || '',
      reviewDue: searchParams.get('reviewDue') || '',
    }),
    [searchParams]
  )

  const { items, total, loading, error, filters, setFilters, refresh } = useIsoDocuments(initial)
  const [filterUi, setFilterUi] = useState({
    search: initial.search || '',
    status: initial.status || '',
    documentType: initial.documentType || '',
    department: initial.department || '',
  })
  const [bulkOpen, setBulkOpen] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<IsoDocument | null>(null)
  const [rejectDoc, setRejectDoc] = useState<IsoDocument | null>(null)
  const [rejectComments, setRejectComments] = useState('')
  const [revisionDoc, setRevisionDoc] = useState<IsoDocument | null>(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setFilters({
      search: filterUi.search || undefined,
      status: filterUi.status || undefined,
      documentType: filterUi.documentType || undefined,
      department: filterUi.department || undefined,
      reviewDue: initial.reviewDue || undefined,
    })
  }, [filterUi, initial.reviewDue, setFilters])

  const run = async (fn: () => Promise<unknown>) => {
    setActionError('')
    try {
      await fn()
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  const onRevisionFile = async (file: File | null) => {
    if (!file || !revisionDoc) return
    setActionError('')
    try {
      const presign = await presignIsoUpload({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
      })
      await putFileToPresignedUrl(presign.uploadUrl, file, presign.headers)
      try {
        await uploadIsoRevision(revisionDoc.id, {
          storageKey: presign.storageKey,
          originalFilename: file.name,
          contentType: file.type || 'application/octet-stream',
          fileSize: file.size,
          publishToAuditorRoom: false,
          auditorDownloadAllowed: false,
        })
      } catch {
        await confirmIsoUpload({
          storageKey: presign.storageKey,
          originalFilename: file.name,
          contentType: file.type || 'application/octet-stream',
          fileSize: file.size,
          documentId: revisionDoc.id,
          publishToAuditorRoom: false,
          auditorDownloadAllowed: false,
        })
      }
      setRevisionDoc(null)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Revision upload failed')
    }
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Document Library"
          subtitle="Controlled document register with revision history, approval workflow, and Auditor Room publish controls."
          actions={
            canAdd ? (
              <button type="button" className="btn btn--primary" onClick={() => setBulkOpen(true)}>
                Bulk upload
              </button>
            ) : null
          }
        />

        {(error || actionError) && <div className="iso-error">{error || actionError}</div>}

        <IsoFiltersBar
          fields={[
            { key: 'search', placeholder: 'Search title, code, filename…' },
            { key: 'status', type: 'select', placeholder: 'All statuses', options: STATUS_OPTIONS },
            { key: 'documentType', placeholder: 'Document type' },
            { key: 'department', placeholder: 'Department' },
          ]}
          values={filterUi}
          onChange={(next) => {
            setFilterUi(next)
            const sp = new URLSearchParams()
            Object.entries(next).forEach(([k, v]) => {
              if (v) sp.set(k, v)
            })
            if (initial.reviewDue) sp.set('reviewDue', initial.reviewDue)
            setSearchParams(sp)
          }}
          trailing={
            <span className="iso-muted">
              {total} document{total === 1 ? '' : 's'}
            </span>
          }
        />

        {loading ? (
          <IsoLoadingState message="Loading document library…" />
        ) : (
          <IsoDocumentTable
            documents={items}
            onPreview={setPreviewDoc}
            getActions={(doc) => {
              const actions = []
              if (canEdit && (doc.status === 'Draft' || doc.status === 'Under Review')) {
                actions.push({
                  key: 'submit',
                  label: 'Submit for review',
                  onClick: () => run(() => submitIsoDocumentReview(doc.id)),
                })
              }
              if (canApprove && (doc.status === 'Under Review' || doc.status === 'Draft')) {
                actions.push({
                  key: 'approve',
                  label: 'Approve',
                  onClick: () => run(() => approveIsoDocument(doc.id)),
                })
                actions.push({
                  key: 'reject',
                  label: 'Reject…',
                  danger: true,
                  onClick: () => {
                    setRejectDoc(doc)
                    setRejectComments('')
                  },
                })
              }
              if (canAdd) {
                actions.push({
                  key: 'revision',
                  label: 'Upload new revision',
                  onClick: () => setRevisionDoc(doc),
                })
              }
              if (canEdit) {
                actions.push({
                  key: 'publish',
                  label: doc.publishToAuditorRoom
                    ? 'Unpublish from Auditor Room'
                    : 'Publish to Auditor Room',
                  onClick: () =>
                    run(() =>
                      setIsoDocumentAuditorPublish(doc.id, {
                        publishToAuditorRoom: !doc.publishToAuditorRoom,
                        auditorDownloadAllowed: doc.auditorDownloadAllowed,
                      })
                    ),
                })
                actions.push({
                  key: 'download-toggle',
                  label: doc.auditorDownloadAllowed
                    ? 'Disallow auditor download'
                    : 'Allow auditor download',
                  onClick: () =>
                    run(() =>
                      setIsoDocumentAuditorPublish(doc.id, {
                        publishToAuditorRoom: Boolean(doc.publishToAuditorRoom),
                        auditorDownloadAllowed: !doc.auditorDownloadAllowed,
                      })
                    ),
                })
                actions.push({
                  key: 'obsolete',
                  label: 'Mark obsolete',
                  danger: true,
                  onClick: () => run(() => markIsoDocumentObsolete(doc.id, {})),
                })
              }
              return actions
            }}
          />
        )}
      </div>

      <IsoBulkUploadModal open={bulkOpen} onClose={() => setBulkOpen(false)} onCompleted={refresh} />

      <Modal
        title={previewDoc?.title || 'Preview'}
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        panelClassName="modal-panel--wide"
      >
        {previewDoc ? (
          <IsoFilePreview
            versionId={previewDoc.currentVersionId || previewDoc.currentVersion?.id}
            filename={previewDoc.originalFilename || previewDoc.currentVersion?.originalFilename}
            contentTypeHint={previewDoc.fileType || previewDoc.currentVersion?.fileType}
          />
        ) : null}
      </Modal>

      <Modal title="Reject document" open={Boolean(rejectDoc)} onClose={() => setRejectDoc(null)}>
        <textarea
          className="iso-filters__input"
          rows={4}
          placeholder="Rejection comments"
          value={rejectComments}
          onChange={(e) => setRejectComments(e.target.value)}
        />
        <div className="iso-inline-actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (!rejectDoc) return
              run(() => rejectIsoDocument(rejectDoc.id, { comments: rejectComments })).then(() =>
                setRejectDoc(null)
              )
            }}
          >
            Reject
          </button>
        </div>
      </Modal>

      <Modal
        title={`Upload revision — ${revisionDoc?.documentCode || ''}`}
        open={Boolean(revisionDoc)}
        onClose={() => setRevisionDoc(null)}
      >
        <p className="iso-muted">
          Previous versions are preserved. New revisions start as draft and require approval before
          becoming current.
        </p>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
          onChange={(e) => onRevisionFile(e.target.files?.[0] || null)}
        />
      </Modal>
    </div>
  )
}

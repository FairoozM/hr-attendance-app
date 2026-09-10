import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { fetchAuditorRoom, fetchAuditorRoomSection } from '../../api/isoQms'
import { hasPermission, isAuditorUser, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoDocumentTable } from './components/IsoDocumentTable'
import { IsoFilePreview } from './components/IsoFilePreview'
import type { IsoAuditorRoomSection, IsoDocument } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoAuditorRoomPage() {
  const { user } = useAuth()
  const isAuditor = isAuditorUser(user)
  const canToggleView =
    !isAuditor &&
    (user?.role === 'admin' ||
      hasPermission(user, 'iso_qms', 'settings') ||
      hasPermission(user, 'iso_qms', 'approve'))

  const [auditorView, setAuditorView] = useState(isAuditor)
  const [sections, setSections] = useState<IsoAuditorRoomSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceDocs, setEvidenceDocs] = useState<IsoDocument[]>([])
  const [evidenceTitle, setEvidenceTitle] = useState('')
  const [previewDoc, setPreviewDoc] = useState<IsoDocument | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAuditorRoom({ auditorView: canToggleView ? auditorView : undefined })
      setSections(data.sections || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Auditor Room')
      setSections([])
    } finally {
      setLoading(false)
    }
  }, [auditorView, canToggleView])

  useEffect(() => {
    load()
  }, [load])

  const openEvidence = async (section: IsoAuditorRoomSection) => {
    setEvidenceTitle(section.title)
    setEvidenceOpen(true)
    setEvidenceDocs([])
    try {
      const data = await fetchAuditorRoomSection(section.key, {
        auditorView: canToggleView ? auditorView : undefined,
      })
      setEvidenceDocs(data.documents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence')
    }
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Auditor Room"
          subtitle="Guided evidence pack for external ISO auditors. Only documents explicitly published to the Auditor Room are shown in auditor view."
          actions={
            <div className="iso-inline-actions">
              {canToggleView ? (
                <label className="iso-switch">
                  <input
                    type="checkbox"
                    checked={auditorView}
                    onChange={(e) => setAuditorView(e.target.checked)}
                  />
                  Auditor View
                </label>
              ) : null}
              <Link className="btn btn--secondary" to="/iso-qms/search">
                ISO Search
              </Link>
              <Link className="btn btn--secondary" to="/iso-qms/clause-matrix">
                Clause matrix
              </Link>
            </div>
          }
        />

        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState message="Preparing Auditor Room…" /> : null}

        {!loading && sections.length === 0 ? (
          <IsoEmptyState
            title="No published evidence yet"
            message="Publish approved controlled documents to the Auditor Room from the Document Library."
          />
        ) : null}

        <div className="iso-auditor-sections">
          {sections.map((section) => (
            <article key={section.key} className="iso-auditor-section">
              <div>
                <h2 className="iso-auditor-section__title">{section.title}</h2>
                <p className="iso-auditor-section__meta">
                  Clause {section.clauseNumber || '—'}
                  {section.procedureCode
                    ? ` · Procedure ${section.procedureCode}${
                        section.procedureTitle ? ` (${section.procedureTitle})` : ''
                      }`
                    : ''}
                </p>
              </div>
              <div>
                <div className="iso-muted">Evidence count</div>
                <strong>{section.evidenceCount || 0}</strong>
                <div className="iso-muted" style={{ marginTop: '0.35rem' }}>
                  Latest:{' '}
                  {section.latestDocument
                    ? `${section.latestDocument.documentCode || section.latestDocument.title} · Rev ${
                        section.latestDocument.revision || '—'
                      } · ${formatIsoDate(section.latestDocument.revisionDate || section.latestDocument.issueDate)}`
                    : '—'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => openEvidence(section)}
                disabled={!section.evidenceCount}
              >
                View Evidence
              </button>
            </article>
          ))}
        </div>
      </div>

      <Modal title={evidenceTitle || 'Evidence'} open={evidenceOpen} onClose={() => setEvidenceOpen(false)}>
        <IsoDocumentTable
          documents={evidenceDocs}
          onPreview={(doc) => setPreviewDoc(doc)}
          emptyMessage="No published evidence in this section."
        />
      </Modal>

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
    </div>
  )
}
